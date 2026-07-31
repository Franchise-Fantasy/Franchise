import { isIrEligibleStatus } from '@/utils/roster/illegalIRShared';

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { resetTrades } from '../helpers/cleanup';
import { adminClient, serverInvoke, signInAsBot } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';
import {
  createAcceptedTrade,
  createAcceptedOneForOneTrade,
  getPlayerOwner,
  getPlayerSlot,
  getProposalStatus,
  restoreCanonicalRosters,
  getCanonicalRosterPlayerIds,
  setLeagueIrTrading,
  setLeagueRosterSize,
  setPlayerSlot,
  setTeamDrops,
} from '../helpers/seed';

const TIMEOUT = 30_000;

describe('execute-trade — IR player trading', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number]; // bot1, commissioner
  let teamB: BootstrapResult['teams'][number]; // bot2
  let rosterA: string[];
  let rosterB: string[];
  let originalRosterSize: number;
  let originalIrTrading: boolean;
  // players.status override applied by the exemption test (shared table!) —
  // tracked so afterEach restores it even when the test fails.
  let statusOverride: { playerId: string; original: string | null } | null = null;

  // restoreCanonicalRosters only resets roster_slot for players that moved
  // teams — a player parked on IR/TAXI in place keeps that slot, so every
  // test in this file relies on this explicit reset.
  async function resetCanonicalSlots(): Promise<void> {
    const admin = adminClient();
    const { error } = await admin
      .from('league_players')
      .update({ roster_slot: 'BE' })
      .eq('league_id', league.leagueId)
      .in('player_id', [...rosterA, ...rosterB]);
    if (error) throw new Error(`resetCanonicalSlots failed: ${error.message}`);
  }

  /**
   * The team's real active-roster count (excluding IR/TAXI), read after slots
   * are parked. Capacity tests derive roster_size from this rather than from
   * rosterA.length so they hold whether or not a prior run left extras behind.
   */
  async function activeRosterCount(teamId: string): Promise<number> {
    const admin = adminClient();
    const { data, error } = await admin
      .from('league_players')
      .select('roster_slot')
      .eq('league_id', league.leagueId)
      .eq('team_id', teamId);
    if (error) throw new Error(`activeRosterCount failed: ${error.message}`);
    return (data ?? []).filter((r) => r.roster_slot !== 'IR' && r.roster_slot !== 'TAXI').length;
  }

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamA = bots[0];
    teamB = bots[1];

    [rosterA, rosterB] = await Promise.all([
      getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
      getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
    ]);
    if (rosterA.length < 4 || rosterB.length < 2) {
      throw new Error('Need teamA ≥ 4 and teamB ≥ 2 canonical players for IR trade tests');
    }

    // Capture originals without mutating; restored after every test.
    const admin = adminClient();
    const { data: leagueRow } = await admin
      .from('leagues')
      .select('roster_size, ir_trading_enabled')
      .eq('id', league.leagueId)
      .single();
    originalRosterSize = leagueRow!.roster_size;
    originalIrTrading = leagueRow?.ir_trading_enabled ?? false;
  }, TIMEOUT);

  beforeEach(async () => {
    await resetTrades(league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
    await resetCanonicalSlots();
  }, TIMEOUT);

  afterEach(async () => {
    // Restore everything a test may have mutated, even when it failed.
    await setLeagueIrTrading(league.leagueId, originalIrTrading);
    await setLeagueRosterSize(league.leagueId, originalRosterSize);
    if (statusOverride) {
      const admin = adminClient();
      await admin
        .from('players')
        .update({ status: statusOverride.original })
        .eq('id', statusOverride.playerId);
      statusOverride = null;
    }
  }, TIMEOUT);

  afterAll(async () => {
    // Leave slots clean for other test files — a stray IR/TAXI slot changes
    // their capacity math (activeCount excludes IR and TAXI).
    await restoreCanonicalRosters(league.leagueId);
    await resetCanonicalSlots();
  }, TIMEOUT);

  it(
    'rejects a trade containing an IR player when ir_trading_enabled is off',
    async () => {
      await setLeagueIrTrading(league.leagueId, false);
      await setPlayerSlot(league.leagueId, rosterA[0], 'IR');
      const trade = await createAcceptedOneForOneTrade(
        league.leagueId,
        teamA.id,
        teamB.id,
        rosterA[0],
        rosterB[0],
      );

      const result = await serverInvoke('execute-trade', { proposal_id: trade.proposalId });
      await expectHttpError(result, {
        status: 400,
        messageMatch: /Players on IR cannot be traded/,
      });

      // Nothing moved and the proposal was not consumed.
      expect(await getPlayerOwner(league.leagueId, rosterA[0])).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, rosterB[0])).toBe(teamB.id);
      expect(await getPlayerSlot(league.leagueId, rosterA[0])).toBe('IR');
      expect(await getProposalStatus(trade.proposalId)).toBe('accepted');
    },
    TIMEOUT,
  );

  it(
    'trades an IR player when the flag is on, landing him on the receiving bench',
    async () => {
      await setLeagueIrTrading(league.leagueId, true);
      await setPlayerSlot(league.leagueId, rosterA[0], 'IR');
      const trade = await createAcceptedOneForOneTrade(
        league.leagueId,
        teamA.id,
        teamB.id,
        rosterA[0],
        rosterB[0],
      );

      const { data, error } = await serverInvoke('execute-trade', {
        proposal_id: trade.proposalId,
      });
      expect(error).toBeNull();
      expect(data?.transaction_id).toBeTruthy();

      expect(await getPlayerOwner(league.leagueId, rosterA[0])).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, rosterB[0])).toBe(teamA.id);
      // Implicit activation: the incoming IR player lands on the bench.
      expect(await getPlayerSlot(league.leagueId, rosterA[0])).toBe('BE');
      expect(await getProposalStatus(trade.proposalId)).toBe('completed');
    },
    TIMEOUT,
  );

  it(
    'slot-aware capacity: outgoing IR frees no seat, and a queued TAXI drop does not satisfy the requirement',
    async () => {
      await setLeagueIrTrading(league.leagueId, true);
      const [irOut, taxiParked, activeDrop] = rosterA;
      await setPlayerSlot(league.leagueId, irOut, 'IR');
      await setPlayerSlot(league.leagueId, taxiParked, 'TAXI');
      // Cap teamA at exactly its active count, so any net active gain needs a drop.
      await setLeagueRosterSize(league.leagueId, await activeRosterCount(teamA.id));

      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: irOut },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[0] },
        ],
      });

      // Outgoing IR player frees no active seat while the incoming bench
      // player takes one → net active +1 on a full roster → drop required.
      const first = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(first.error).toBeNull();
      expect(first.data?.pending_drops).toBe(true);
      expect(await getProposalStatus(proposalId)).toBe('pending_drops');
      expect(await getPlayerOwner(league.leagueId, irOut)).toBe(teamA.id);

      // A queued drop pointing at a TAXI player can't make active-roster room
      // — it's skipped, so the trade must stay pending.
      await setTeamDrops(proposalId, teamA.id, [taxiParked]);
      const second = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(second.error).toBeNull();
      expect(second.data?.pending_drops).toBe(true);
      expect(await getProposalStatus(proposalId)).toBe('pending_drops');
      // The skipped TAXI player was not dropped.
      expect(await getPlayerOwner(league.leagueId, taxiParked)).toBe(teamA.id);

      // An active-slot drop satisfies the requirement.
      await setTeamDrops(proposalId, teamA.id, [activeDrop]);
      const third = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(third.error).toBeNull();
      expect(third.data?.transaction_id).toBeTruthy();
      expect(await getProposalStatus(proposalId)).toBe('completed');

      expect(await getPlayerOwner(league.leagueId, irOut)).toBe(teamB.id);
      expect(await getPlayerSlot(league.leagueId, irOut)).toBe('BE');
      expect(await getPlayerOwner(league.leagueId, rosterB[0])).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, activeDrop)).toBeNull();
      expect(await getPlayerOwner(league.leagueId, taxiParked)).toBe(teamA.id);
    },
    TIMEOUT,
  );

  it(
    'players parked on TAXI do not count against roster capacity',
    async () => {
      const taxiParked = rosterA[1];
      await setPlayerSlot(league.leagueId, taxiParked, 'TAXI');
      // Cap at active + 1 so the 2-for-1's net +1 active exactly fills teamA.
      // That is legal only because TAXI is excluded from the active count —
      // the old head-count-minus-IR math would have demanded a drop here.
      await setLeagueRosterSize(league.leagueId, (await activeRosterCount(teamA.id)) + 1);

      const { proposalId } = await createAcceptedTrade({
        leagueId: league.leagueId,
        proposedByTeamId: teamA.id,
        items: [
          { fromTeamId: teamA.id, toTeamId: teamB.id, playerId: rosterA[0] },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[0] },
          { fromTeamId: teamB.id, toTeamId: teamA.id, playerId: rosterB[1] },
        ],
      });

      const { data, error } = await serverInvoke('execute-trade', { proposal_id: proposalId });
      expect(error).toBeNull();
      expect(data?.pending_drops).toBeFalsy();
      expect(data?.transaction_id).toBeTruthy();
      expect(await getProposalStatus(proposalId)).toBe('completed');

      expect(await getPlayerOwner(league.leagueId, rosterA[0])).toBe(teamB.id);
      expect(await getPlayerOwner(league.leagueId, rosterB[0])).toBe(teamA.id);
      expect(await getPlayerOwner(league.leagueId, rosterB[1])).toBe(teamA.id);
      // The TAXI player was untouched.
      expect(await getPlayerSlot(league.leagueId, taxiParked)).toBe('TAXI');
    },
    TIMEOUT,
  );

  it(
    'illegal-IR exemption: trading AWAY a healthy IR player executes despite the lockout (user call)',
    async () => {
      await setLeagueIrTrading(league.leagueId, true);

      // Pick a canonical teamA player whose players.status is NOT IR-eligible
      // (OUT/SUSP) — parking him on IR normally locks the team out of trades.
      const admin = adminClient();
      const { data: statusRows } = await admin
        .from('players')
        .select('id, status')
        .in('id', rosterA);
      let healthy = (statusRows ?? []).find((p) => !isIrEligibleStatus(p.status));
      if (!healthy) {
        // Every canonical player happens to be OUT/SUSP right now — force one
        // healthy. players is a shared table; afterEach restores the status.
        const forced = statusRows![0];
        statusOverride = { playerId: forced.id, original: forced.status };
        await admin.from('players').update({ status: null }).eq('id', forced.id);
        healthy = { id: forced.id, status: null };
      }

      await setPlayerSlot(league.leagueId, healthy.id, 'IR');
      const trade = await createAcceptedOneForOneTrade(
        league.leagueId,
        teamA.id,
        teamB.id,
        healthy.id,
        rosterB[0],
      );

      // Must be a user-authed call: serverInvoke's isServerCall path skips the
      // illegal-IR lockout entirely, which would make this test vacuous. Bot1
      // owns teamA (and is commissioner), so the lockout check runs — and the
      // outgoing player is exempt because the trade itself resolves it.
      const client = await signInAsBot(1);
      const { data, error } = await client.functions.invoke('execute-trade', {
        body: { proposal_id: trade.proposalId },
      });
      expect(error).toBeNull();
      expect((data as any)?.transaction_id).toBeTruthy();

      expect(await getPlayerOwner(league.leagueId, healthy.id)).toBe(teamB.id);
      expect(await getPlayerSlot(league.leagueId, healthy.id)).toBe('BE');
      expect(await getProposalStatus(trade.proposalId)).toBe('completed');
    },
    TIMEOUT,
  );
});
