import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, cronInvoke } from '../helpers/clients';
import {
  getPlayerOwner,
  pickFreeAgentPlayer,
  restoreCanonicalRosters,
} from '../helpers/seed';

const TIMEOUT = 30_000;

// process-waivers resolves FAAB claims by highest bid. An EXACT tie is broken by
// the league's faab_tiebreak setting:
//   'earliest_bid'    — the bid submitted first wins (created_at)
//   'waiver_priority' — the team with better waiver priority wins
//
// Both cases stage two equal $10 bids where the EARLIER bid has the WORSE waiver
// priority (99) and the LATER bid has the BEST priority (1). So the two settings
// pick opposite winners: earliest_bid → early team; waiver_priority → late team.
// The league has 4/20 roster spots used, so claims award without needing a drop.

describe('process-waivers — FAAB tie-break', () => {
  let league: BootstrapResult;
  let earlyTeam: BootstrapResult['teams'][number]; // bids first, worse priority
  let lateTeam: BootstrapResult['teams'][number]; // bids later, best priority
  let originalWaiverType: string | null = null;
  let originalFaabTiebreak: string | null = null;
  const stagedPlayers: { id: string; position: string }[] = [];

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await restoreCanonicalRosters(league.leagueId);

    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    earlyTeam = bots[0];
    lateTeam = bots[1];

    // Flip the shared test league to FAAB so the resolver takes the bid path;
    // restored in afterAll. Safe because the suite runs serially (--runInBand).
    const admin = adminClient();
    const { data: before } = await admin
      .from('leagues')
      .select('waiver_type, faab_tiebreak')
      .eq('id', league.leagueId)
      .single();
    originalWaiverType = before?.waiver_type ?? null;
    originalFaabTiebreak = before?.faab_tiebreak ?? null;
    await admin
      .from('leagues')
      .update({ waiver_type: 'faab' })
      .eq('id', league.leagueId);
  }, TIMEOUT);

  afterAll(async () => {
    const admin = adminClient();
    for (const p of stagedPlayers) {
      await admin
        .from('league_players')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', p.id);
      await admin
        .from('daily_lineups')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', p.id);
    }
    await admin.from('waiver_claims').delete().eq('league_id', league.leagueId);
    await admin.from('league_waivers').delete().eq('league_id', league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
    await admin
      .from('leagues')
      .update({ waiver_type: originalWaiverType, faab_tiebreak: originalFaabTiebreak })
      .eq('id', league.leagueId);
  }, TIMEOUT);

  // Put a fresh free agent on an already-expired waiver clock and stage two
  // equal bids: earlyTeam bids first with the worse priority, lateTeam later
  // with the best priority. Returns the staged player.
  async function stageExpiredTie(admin: ReturnType<typeof adminClient>) {
    const fa = await pickFreeAgentPlayer(league.leagueId);
    stagedPlayers.push(fa);

    const { error: wErr } = await admin.from('league_waivers').insert({
      league_id: league.leagueId,
      player_id: fa.id,
      on_waivers_until: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(wErr).toBeNull();

    const { error: cErr } = await admin.from('waiver_claims').insert([
      {
        league_id: league.leagueId,
        team_id: earlyTeam.id,
        player_id: fa.id,
        bid_amount: 10,
        priority: 99, // worse priority
        status: 'pending',
        created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
      },
      {
        league_id: league.leagueId,
        team_id: lateTeam.id,
        player_id: fa.id,
        bid_amount: 10,
        priority: 1, // best priority
        status: 'pending',
        created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    ]);
    expect(cErr).toBeNull();
    return fa;
  }

  async function claimStatuses(admin: ReturnType<typeof adminClient>, playerId: string) {
    const { data: claims } = await admin
      .from('waiver_claims')
      .select('team_id, status')
      .eq('league_id', league.leagueId)
      .eq('player_id', playerId);
    return new Map((claims ?? []).map((c) => [c.team_id, c.status]));
  }

  it(
    'earliest_bid: awards an exact-bid tie to the earliest bid, ignoring priority',
    async () => {
      const admin = adminClient();
      await admin
        .from('leagues')
        .update({ faab_tiebreak: 'earliest_bid' })
        .eq('id', league.leagueId);
      const fa = await stageExpiredTie(admin);

      const { data, status } = await cronInvoke('process-waivers');
      expect(status).toBe(200);
      expect((data as { ok?: boolean } | null)?.ok).toBe(true);

      // The earlier bid won despite the worse waiver priority.
      expect(await getPlayerOwner(league.leagueId, fa.id)).toBe(earlyTeam.id);
      const statusByTeam = await claimStatuses(admin, fa.id);
      expect(statusByTeam.get(earlyTeam.id)).toBe('successful');
      expect(statusByTeam.get(lateTeam.id)).toBe('failed');
    },
    TIMEOUT,
  );

  it(
    'waiver_priority: awards an exact-bid tie to the better waiver priority',
    async () => {
      const admin = adminClient();
      await admin
        .from('leagues')
        .update({ faab_tiebreak: 'waiver_priority' })
        .eq('id', league.leagueId);
      const fa = await stageExpiredTie(admin);

      const { data, status } = await cronInvoke('process-waivers');
      expect(status).toBe(200);
      expect((data as { ok?: boolean } | null)?.ok).toBe(true);

      // The better-priority (later) bid won despite being submitted second.
      expect(await getPlayerOwner(league.leagueId, fa.id)).toBe(lateTeam.id);
      const statusByTeam = await claimStatuses(admin, fa.id);
      expect(statusByTeam.get(lateTeam.id)).toBe('successful');
      expect(statusByTeam.get(earlyTeam.id)).toBe('failed');
    },
    TIMEOUT,
  );
});
