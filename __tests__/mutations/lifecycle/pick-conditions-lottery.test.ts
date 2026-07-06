import { adminClient, serverInvoke, signInAsBot } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';
import {
  bootstrapLifecycleLeague,
  resetToSeasonComplete,
  clearRateLimits,
  LifecycleBootstrap,
} from '../helpers/lifecycle';
import { createAcceptedTrade } from '../helpers/seed';

const TIMEOUT = 60_000;
const NEW_SEASON = '2027-28';

/**
 * Exercises pick PROTECTIONS and pick SWAPS through the real offseason chain:
 *   advance-season → start-lottery → create-rookie-draft
 *
 * Determinism notes (4-team lifecycle league, standings bot1 best … bot4 worst):
 * - Round 1: lottery randomizes bot3/bot4 across slots 1-2; bot2 = slot 3,
 *   bot1 = slot 4 (playoff teams, worst-first).
 * - Round 2+: straight reverse standings — bot4=1, bot3=2, bot2=3, bot1=4.
 *   All round-2 scenarios below are fully deterministic.
 *
 * Some scenarios (mutual swaps, swap chains) intentionally probe ORDER-DEPENDENT
 * resolution: start-lottery resolves pick_swaps sequentially in whatever order
 * the DB returns them (no ORDER BY). Those tests assert the set of valid
 * outcomes and log which one occurred.
 */
describe('Pick protections + swaps through the lottery', () => {
  let league: LifecycleBootstrap;
  let bot1: string, bot2: string, bot3: string, bot4: string;

  const teamId = (botIndex: number) =>
    league.teams.find((t) => t.botIndex === botIndex)!.id;

  beforeAll(async () => {
    league = await bootstrapLifecycleLeague('dynasty');
    bot1 = teamId(1);
    bot2 = teamId(2);
    bot3 = teamId(3);
    bot4 = teamId(4);
  }, TIMEOUT);

  beforeEach(async () => {
    // Trade artifacts must go BEFORE resetToSeasonComplete: trade_proposal_items
    // FK-references draft_picks (NO ACTION), which silently blocks the helper's
    // draft_picks delete and leaves duplicate picks behind. pick_swaps goes
    // first (FK to trade_proposals via created_by_proposal_id).
    const admin = adminClient();
    await admin.from('pick_swaps').delete().eq('league_id', league.leagueId);
    const { data: props } = await admin
      .from('trade_proposals')
      .select('id')
      .eq('league_id', league.leagueId);
    const propIds = (props ?? []).map((p) => p.id);
    if (propIds.length > 0) {
      await admin.from('trade_proposal_items').delete().in('proposal_id', propIds);
      await admin.from('trade_proposal_teams').delete().in('proposal_id', propIds);
      await admin.from('trade_proposals').delete().in('id', propIds);
    }
    await resetToSeasonComplete(league);
    await clearRateLimits(league.commissionerUserId, [
      'advance-season',
      'start-lottery',
      'create-rookie-draft',
      'reverse-trade',
    ]);
  }, TIMEOUT);

  /** Fetch the 2027-28 pick for (round, original team). */
  async function getPick(round: number, originalTeamId: string) {
    const { data } = await adminClient()
      .from('draft_picks')
      .select('id, round, slot_number, current_team_id, original_team_id, protection_threshold, protection_owner_id')
      .eq('league_id', league.leagueId)
      .eq('season', NEW_SEASON)
      .eq('round', round)
      .eq('original_team_id', originalTeamId)
      .single();
    if (!data) throw new Error(`No ${NEW_SEASON} R${round} pick for team ${originalTeamId}`);
    return data;
  }

  async function setPickState(
    round: number,
    originalTeamId: string,
    state: { currentTeamId?: string; threshold?: number | null; owner?: string | null },
  ) {
    const pick = await getPick(round, originalTeamId);
    const { error } = await adminClient()
      .from('draft_picks')
      .update({
        ...(state.currentTeamId ? { current_team_id: state.currentTeamId } : {}),
        ...(state.threshold !== undefined ? { protection_threshold: state.threshold } : {}),
        ...(state.owner !== undefined ? { protection_owner_id: state.owner } : {}),
      })
      .eq('id', pick.id);
    if (error) throw new Error(`setPickState failed: ${error.message}`);
    return pick.id;
  }

  // Fixed epoch base so swap ordering in tests is explicit, not dependent on
  // insert timing. Higher orderIdx = created later = resolves later (oldest-first).
  const SWAP_EPOCH = Date.parse('2026-01-01T00:00:00Z');
  async function insertSwap(
    round: number,
    beneficiary: string,
    counterparty: string,
    orderIdx = 0,
  ) {
    const { data, error } = await adminClient()
      .from('pick_swaps')
      .insert({
        league_id: league.leagueId,
        season: NEW_SEASON,
        round,
        beneficiary_team_id: beneficiary,
        counterparty_team_id: counterparty,
        resolved: false,
        created_at: new Date(SWAP_EPOCH + orderIdx * 60_000).toISOString(),
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`insertSwap failed: ${error?.message}`);
    return data.id;
  }

  /** Run the full chain and return resolution events + committed picks. */
  async function runOffseasonChain() {
    const client = await signInAsBot(1);
    const advance = await client.functions.invoke('advance-season', {
      body: { league_id: league.leagueId },
    });
    expect(advance.error).toBeNull();
    const lottery = await client.functions.invoke('start-lottery', {
      body: { league_id: league.leagueId },
    });
    expect(lottery.error).toBeNull();
    const rookie = await client.functions.invoke('create-rookie-draft', {
      body: { league_id: league.leagueId },
    });
    expect(rookie.error).toBeNull();

    const admin = adminClient();
    const [{ data: resultRow }, { data: picks }, { data: swaps }] = await Promise.all([
      admin
        .from('lottery_results')
        .select('pick_resolution')
        .eq('league_id', league.leagueId)
        .eq('season', NEW_SEASON)
        .single(),
      admin
        .from('draft_picks')
        .select('id, round, slot_number, current_team_id, original_team_id, protection_threshold, protection_owner_id')
        .eq('league_id', league.leagueId)
        .eq('season', NEW_SEASON)
        .order('round')
        .order('slot_number'),
      admin.from('pick_swaps').select('id, resolved').eq('league_id', league.leagueId),
    ]);
    return {
      events: ((resultRow?.pick_resolution as any[]) ?? []),
      picks: picks ?? [],
      swaps: swaps ?? [],
      swapWarnings: (lottery.data?.swap_warnings as string[]) ?? [],
    };
  }

  const ownerOf = (picks: any[], round: number, originalTeamId: string) =>
    picks.find((p) => p.round === round && p.original_team_id === originalTeamId)
      ?.current_team_id;

  // ── Protections ────────────────────────────────────────────────────────────

  it(
    'protection within threshold reverts the pick to the protection owner',
    async () => {
      // bot4's R2 pick (deterministic slot 1) sits with bot2, top-2 protected.
      await setPickState(2, bot4, { currentTeamId: bot2, threshold: 2, owner: bot4 });

      const { events, picks } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot4)).toBe(bot4); // reverted
      const pick = picks.find((p) => p.round === 2 && p.original_team_id === bot4)!;
      expect(pick.protection_threshold).toBeNull(); // condition consumed
      expect(pick.protection_owner_id).toBeNull();
      expect(events).toContainEqual(
        expect.objectContaining({ kind: 'protected', round: 2, slot: 1, threshold: 2 }),
      );
    },
    TIMEOUT,
  );

  it(
    'protection outside threshold conveys the pick to the holder',
    async () => {
      // bot1's R2 pick (deterministic slot 4) sits with bot2, top-3 protected.
      await setPickState(2, bot1, { currentTeamId: bot2, threshold: 3, owner: bot1 });

      const { events, picks } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot1)).toBe(bot2); // conveyed
      expect(events).toContainEqual(
        expect.objectContaining({ kind: 'conveyed', round: 2, slot: 4, threshold: 3 }),
      );
    },
    TIMEOUT,
  );

  // ── Swaps ──────────────────────────────────────────────────────────────────

  it(
    'swap executes when the counterparty drew the better slot',
    async () => {
      // bot1 (slot 4) holds swap rights against bot4 (slot 1).
      await insertSwap(2, bot1, bot4);

      const { events, picks, swaps } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot4)).toBe(bot1); // bot1 takes slot 1
      expect(ownerOf(picks, 2, bot1)).toBe(bot4); // bot4 gets slot 4
      expect(swaps.every((s) => s.resolved)).toBe(true);
      expect(events).toContainEqual(expect.objectContaining({ kind: 'swap_executed', round: 2 }));
    },
    TIMEOUT,
  );

  it(
    'swap is kept (no-op) when the beneficiary already has the better slot',
    async () => {
      await insertSwap(2, bot4, bot1); // bot4 already at slot 1

      const { events, picks, swaps } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot4)).toBe(bot4);
      expect(ownerOf(picks, 2, bot1)).toBe(bot1);
      expect(swaps.every((s) => s.resolved)).toBe(true);
      expect(events).toContainEqual(expect.objectContaining({ kind: 'swap_kept', round: 2 }));
    },
    TIMEOUT,
  );

  it(
    'duplicate swap (same direction) is rejected with a friendly 400 before it hits the unique constraint',
    async () => {
      // A swap between the same pair/round/season already exists…
      await insertSwap(2, bot1, bot4);

      // …and a second trade tries to create the identical swap (bot1 benef vs bot4).
      const t = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot4,
        items: [
          { fromTeamId: bot4, toTeamId: bot1, pickSwapSeason: NEW_SEASON, pickSwapRound: 2 },
        ],
      });
      const resp = await serverInvoke('execute-trade', { proposal_id: t.proposalId });
      await expectHttpError(resp, { status: 400, messageMatch: /already exists for the/i });

      // Guard fires pre-RPC: proposal stays accepted, still exactly one swap row.
      const admin = adminClient();
      const { data: swaps } = await admin
        .from('pick_swaps').select('id').eq('league_id', league.leagueId);
      expect(swaps).toHaveLength(1);
    },
    TIMEOUT,
  );

  it(
    'mutual swap (reverse direction) is blocked — cannot create the contradictory second swap',
    async () => {
      // Existing: bot1 benefits vs bot4.
      await insertSwap(2, bot1, bot4);

      // Attempt: bot4 benefits vs bot1 — the reverse. Would neutralize at lottery.
      const t = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot1,
        items: [
          { fromTeamId: bot1, toTeamId: bot4, pickSwapSeason: NEW_SEASON, pickSwapRound: 2 },
        ],
      });
      const resp = await serverInvoke('execute-trade', { proposal_id: t.proposalId });
      await expectHttpError(resp, { status: 400, messageMatch: /already exists for the/i });

      const admin = adminClient();
      const { data: swaps } = await admin
        .from('pick_swaps').select('id').eq('league_id', league.leagueId);
      expect(swaps).toHaveLength(1); // no reverse swap created
    },
    TIMEOUT,
  );

  it(
    'two identical swaps within ONE proposal are rejected',
    async () => {
      const t = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot1,
        items: [
          { fromTeamId: bot4, toTeamId: bot1, pickSwapSeason: NEW_SEASON, pickSwapRound: 2 },
          { fromTeamId: bot1, toTeamId: bot4, pickSwapSeason: NEW_SEASON, pickSwapRound: 2 },
        ],
      });
      const resp = await serverInvoke('execute-trade', { proposal_id: t.proposalId });
      await expectHttpError(resp, { status: 400, messageMatch: /two pick swaps between the same teams/i });
    },
    TIMEOUT,
  );

  it(
    'swap with a round beyond rookie_draft_rounds is rejected',
    async () => {
      // Lifecycle league has rookie_draft_rounds = 2.
      const t = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot1,
        items: [
          { fromTeamId: bot4, toTeamId: bot1, pickSwapSeason: NEW_SEASON, pickSwapRound: 5 },
        ],
      });
      const resp = await serverInvoke('execute-trade', { proposal_id: t.proposalId });
      await expectHttpError(resp, { status: 400, messageMatch: /swap round must be between 1 and 2/i });
    },
    TIMEOUT,
  );

  it(
    'mutual swaps resolve deterministically oldest-first → net no-op (both execute, cancel out)',
    async () => {
      // These can no longer be CREATED via trades (PR2 blocks the reverse
      // direction), but legacy/hand-seeded data can still contain both. With
      // oldest-first resolution the older swap executes, then the newer swap
      // executes and swaps the picks right back — deterministic net no-op.
      await insertSwap(2, bot1, bot4, 0); // older: bot1 benefits vs bot4
      await insertSwap(2, bot4, bot1, 1); // newer: bot4 benefits vs bot1

      const { picks, events } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot4)).toBe(bot4);
      expect(ownerOf(picks, 2, bot1)).toBe(bot1);
      const swapKinds = events.filter((e) => e.kind.startsWith('swap_')).map((e) => e.kind);
      expect(swapKinds).toEqual(['swap_executed', 'swap_executed']);
    },
    TIMEOUT,
  );

  it(
    'swap chain (swap of a swap) cascades oldest-first: best pick flows to the newest right-holder',
    async () => {
      // bot2 acquired swap rights vs bot4 (slot 1) FIRST; bot1 later bought
      // rights vs bot2. Oldest-first: bot2's swap fires and pulls slot 1 off
      // bot4, then bot1's swap fires against bot2's now-upgraded holdings and
      // takes slot 1 the rest of the way to bot1. This is the "swap of a swap"
      // cascade — the value flows down the chain to the most recent right.
      await insertSwap(2, bot2, bot4, 0); // older
      await insertSwap(2, bot1, bot2, 1); // newer

      const { picks, events } = await runOffseasonChain();

      // Slot 1 = the pick originating from bot4.
      expect(ownerOf(picks, 2, bot4)).toBe(bot1); // cascaded all the way to bot1
      const swapKinds = events.filter((e) => e.kind.startsWith('swap_')).map((e) => e.kind);
      expect(swapKinds).toEqual(['swap_executed', 'swap_executed']);
    },
    TIMEOUT,
  );

  it(
    'swap chain is REVERSED when the newer swap is older: no cascade',
    async () => {
      // Same two swaps, opposite created_at order. bot1-vs-bot2 fires first,
      // when bot2 still only holds its own slot-3 pick, so bot1 gets slot 3.
      // Then bot2-vs-bot4 fires and bot2 keeps slot 1. Proves ordering drives
      // the outcome (and that it's now stable, not storage-order luck).
      await insertSwap(2, bot1, bot2, 0); // older now
      await insertSwap(2, bot2, bot4, 1); // newer now

      const { picks } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot4)).toBe(bot2); // slot 1 stays with bot2 — no cascade
      expect(ownerOf(picks, 2, bot2)).toBe(bot1); // bot1 only got bot2's original slot-3 pick
    },
    TIMEOUT,
  );

  it(
    'best-pick: a team holding two picks in the round puts up its BEST one',
    async () => {
      // bot4 acquires bot3's R2 pick (slot 2) on top of its own (slot 1), so it
      // holds two R2 picks. bot1 (slot 4) has swap rights vs bot4. The swap must
      // take bot4's BEST pick (slot 1), not the arbitrary-first — and leave the
      // slot-2 pick with bot4.
      await setPickState(2, bot3, { currentTeamId: bot4 });
      await insertSwap(2, bot1, bot4);

      const { picks } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot4)).toBe(bot1); // bot4's slot-1 pick went to bot1
      expect(ownerOf(picks, 2, bot3)).toBe(bot4); // bot3-origin slot-2 pick stayed with bot4
      expect(ownerOf(picks, 2, bot1)).toBe(bot4); // bot1 gave up its slot-4 pick
    },
    TIMEOUT,
  );

  it(
    'swap voided when the counterparty holds no pick in that round',
    async () => {
      // bot2 traded its own R2 pick away to bot3 → bot2 holds nothing in R2.
      await setPickState(2, bot2, { currentTeamId: bot3 });
      await insertSwap(2, bot1, bot2);

      const { events, picks, swaps, swapWarnings } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot1)).toBe(bot1); // untouched
      expect(events).toContainEqual(expect.objectContaining({ kind: 'swap_voided', round: 2 }));
      expect(swaps.every((s) => s.resolved)).toBe(true); // voided still consumes the swap
      expect(swapWarnings.length).toBeGreaterThan(0);
    },
    TIMEOUT,
  );

  it(
    'protection resolves before swap: reverted pick changes what the swap sees',
    async () => {
      // bot4's R2 pick (slot 1) is with bot2, top-2 protected → reverts to bot4.
      // bot1 holds swap rights vs bot2. Post-protection, bot2 only has its own
      // slot-3 pick, so bot1 (slot 4) swaps into slot 3 — NOT slot 1.
      await setPickState(2, bot4, { currentTeamId: bot2, threshold: 2, owner: bot4 });
      await insertSwap(2, bot1, bot2);

      const { picks, events } = await runOffseasonChain();

      expect(ownerOf(picks, 2, bot4)).toBe(bot4); // protection reverted first
      expect(ownerOf(picks, 2, bot2)).toBe(bot1); // swap took bot2's own slot-3 pick
      expect(ownerOf(picks, 2, bot1)).toBe(bot2);
      expect(events).toContainEqual(expect.objectContaining({ kind: 'protected', round: 2 }));
      expect(events).toContainEqual(expect.objectContaining({ kind: 'swap_executed', round: 2 }));
    },
    TIMEOUT,
  );

  // ── Trade-layer semantics (execute-trade / reverse-trade) ─────────────────

  it(
    're-protecting an already-protected pick is rejected with a friendly 400',
    async () => {
      const pickId = (await getPick(1, bot4)).id;

      // Trade 1: bot4 → bot2, top-1 protected. Legal (pick was unprotected).
      const t1 = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot4,
        items: [{ fromTeamId: bot4, toTeamId: bot2, draftPickId: pickId, protectionThreshold: 1 }],
      });
      expect((await serverInvoke('execute-trade', { proposal_id: t1.proposalId })).error).toBeNull();

      // Trade 2: bot2 → bot3 with a NEW protection — must be rejected.
      const t2 = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot2,
        items: [{ fromTeamId: bot2, toTeamId: bot3, draftPickId: pickId, protectionThreshold: 3 }],
      });
      const r2 = await serverInvoke('execute-trade', { proposal_id: t2.proposalId });
      await expectHttpError(r2, { status: 400, messageMatch: /already Top-1 protected/i });

      // Nothing changed: bot2 still holds the pick, original protection intact.
      const pick = await getPick(1, bot4);
      expect(pick.current_team_id).toBe(bot2);
      expect(pick.protection_threshold).toBe(1);
      expect(pick.protection_owner_id).toBe(bot4);
    },
    TIMEOUT,
  );

  it(
    'protection thresholds are bounded to 1..teams-1',
    async () => {
      const pickId = (await getPick(1, bot4)).id;

      // 99 (>= team count) would mean the pick can never convey.
      const tooHigh = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot4,
        items: [{ fromTeamId: bot4, toTeamId: bot2, draftPickId: pickId, protectionThreshold: 99 }],
      });
      await expectHttpError(
        await serverInvoke('execute-trade', { proposal_id: tooHigh.proposalId }),
        { status: 400, messageMatch: /between Top-1 and Top-3/i },
      );

      // 0 would be a protection that can never trigger.
      const tooLow = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot4,
        items: [{ fromTeamId: bot4, toTeamId: bot2, draftPickId: pickId, protectionThreshold: 0 }],
      });
      await expectHttpError(
        await serverInvoke('execute-trade', { proposal_id: tooLow.proposalId }),
        { status: 400, messageMatch: /between Top-1 and Top-3/i },
      );

      // Boundary value (teams-1 = 3) is legal. Use a DIFFERENT pick — the two
      // rejected proposals above stay `accepted` and lock `pickId` via
      // execute-trade's "asset in another active proposal" guard.
      const otherPickId = (await getPick(1, bot3)).id;
      const maxOk = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot3,
        items: [{ fromTeamId: bot3, toTeamId: bot2, draftPickId: otherPickId, protectionThreshold: 3 }],
      });
      expect((await serverInvoke('execute-trade', { proposal_id: maxOk.proposalId })).error).toBeNull();
      expect((await getPick(1, bot3)).protection_threshold).toBe(3);
    },
    TIMEOUT,
  );

  it(
    'get_trade_proposals_for_league surfaces a pick\'s existing protection to the detail view',
    async () => {
      // bot2 holds an R1 pick that's already Top-4 protected for bot3 (a prior
      // trade). A new pending trade just MOVES it (no new protection).
      const pickId = await setPickState(1, bot2, { threshold: 4, owner: bot3 });
      await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot2,
        items: [{ fromTeamId: bot2, toTeamId: bot1, draftPickId: pickId }],
      });

      // Read as a league member (bot2) — the RPC gates on is_league_member.
      const client = await signInAsBot(2);
      const { data, error } = await client.rpc('get_trade_proposals_for_league', {
        p_league_id: league.leagueId,
      });
      expect(error).toBeNull();
      const proposals = (data as any[]) ?? [];
      const item = proposals
        .flatMap((p) => p.items ?? [])
        .find((i: any) => i.draft_pick_id === pickId);
      expect(item).toBeTruthy();
      expect(item.protection_threshold).toBeNull(); // this trade adds none
      expect(item.pick_protection_threshold).toBe(4); // but the pick already carries one
      expect(item.pick_protection_owner_name).toBe(
        league.teams.find((t) => t.botIndex === 3)!.name,
      );
    },
    TIMEOUT,
  );

  it(
    'protected pick can still be re-traded WITHOUT a new protection, and reversals now behave',
    async () => {
      const pickId = (await getPick(1, bot4)).id;

      // Trade 1 creates the protection; trade 2 just moves the protected pick.
      const t1 = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot4,
        items: [{ fromTeamId: bot4, toTeamId: bot2, draftPickId: pickId, protectionThreshold: 2 }],
      });
      expect((await serverInvoke('execute-trade', { proposal_id: t1.proposalId })).error).toBeNull();

      const t2 = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: bot2,
        items: [{ fromTeamId: bot2, toTeamId: bot3, draftPickId: pickId }],
      });
      expect((await serverInvoke('execute-trade', { proposal_id: t2.proposalId })).error).toBeNull();

      // Protection travelled with the pick.
      let pick = await getPick(1, bot4);
      expect(pick.current_team_id).toBe(bot3);
      expect(pick.protection_threshold).toBe(2);
      expect(pick.protection_owner_id).toBe(bot4);

      const client = await signInAsBot(1);

      // Reversing the MOVE (trade 2) preserves the original protection —
      // this was the finding: pre-guard, a chained re-protection made this
      // reversal wipe trade 1's protection unrecoverably.
      const rev2 = await client.functions.invoke('reverse-trade', {
        body: { proposal_id: t2.proposalId },
      });
      expect(rev2.error).toBeNull();
      pick = await getPick(1, bot4);
      expect(pick.current_team_id).toBe(bot2);
      expect(pick.protection_threshold).toBe(2);
      expect(pick.protection_owner_id).toBe(bot4);

      // Reversing the CREATING trade (trade 1) clears the protection with it.
      const rev1 = await client.functions.invoke('reverse-trade', {
        body: { proposal_id: t1.proposalId },
      });
      expect(rev1.error).toBeNull();
      pick = await getPick(1, bot4);
      expect(pick.current_team_id).toBe(bot4);
      expect(pick.protection_threshold).toBeNull();
      expect(pick.protection_owner_id).toBeNull();
    },
    TIMEOUT,
  );
});
