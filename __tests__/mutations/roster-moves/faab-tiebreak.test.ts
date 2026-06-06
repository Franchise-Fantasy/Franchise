import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, cronInvoke } from '../helpers/clients';
import {
  getPlayerOwner,
  pickFreeAgentPlayer,
  restoreCanonicalRosters,
} from '../helpers/seed';

const TIMEOUT = 30_000;

// process-waivers resolves FAAB claims purely by bid: the highest bid wins, and
// an EXACT tie is broken by the earliest submitted bid (created_at). Waiver
// priority is intentionally NOT a factor in FAAB.
//
// To prove that, this test stages two equal $10 bids where the EARLIER bid has
// the WORSE waiver priority (99) and the LATER bid has the BEST priority (1).
// Under the old "tie falls back to priority" behavior the priority-1 (late)
// team would win; under the current rule the earlier bid wins. The league has
// 4/20 roster spots used, so claims award without needing a drop.

describe('process-waivers — FAAB tie-break', () => {
  let league: BootstrapResult;
  let earlyTeam: BootstrapResult['teams'][number]; // bids first, worse priority
  let lateTeam: BootstrapResult['teams'][number]; // bids later, best priority
  let originalWaiverType: string | null = null;
  let fa: { id: string; position: string } | null = null;

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
      .select('waiver_type')
      .eq('id', league.leagueId)
      .single();
    originalWaiverType = before?.waiver_type ?? null;
    await admin
      .from('leagues')
      .update({ waiver_type: 'faab' })
      .eq('id', league.leagueId);
  }, TIMEOUT);

  afterAll(async () => {
    const admin = adminClient();
    if (fa) {
      await admin
        .from('league_players')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', fa.id);
      await admin
        .from('daily_lineups')
        .delete()
        .eq('league_id', league.leagueId)
        .eq('player_id', fa.id);
    }
    await admin.from('waiver_claims').delete().eq('league_id', league.leagueId);
    await admin.from('league_waivers').delete().eq('league_id', league.leagueId);
    await restoreCanonicalRosters(league.leagueId);
    await admin
      .from('leagues')
      .update({ waiver_type: originalWaiverType })
      .eq('id', league.leagueId);
  }, TIMEOUT);

  it(
    'awards an exact-bid tie to the earliest bid, ignoring waiver priority',
    async () => {
      const admin = adminClient();
      fa = await pickFreeAgentPlayer(league.leagueId);

      // Player is on waivers with an already-expired clock so the resolver
      // picks it up on this invocation.
      const { error: wErr } = await admin.from('league_waivers').insert({
        league_id: league.leagueId,
        player_id: fa.id,
        on_waivers_until: new Date(Date.now() - 60_000).toISOString(),
      });
      expect(wErr).toBeNull();

      const earlyAt = new Date(Date.now() - 10 * 60_000).toISOString();
      const lateAt = new Date(Date.now() - 5 * 60_000).toISOString();
      const { error: cErr } = await admin.from('waiver_claims').insert([
        {
          league_id: league.leagueId,
          team_id: earlyTeam.id,
          player_id: fa.id,
          bid_amount: 10,
          priority: 99, // worse priority — would lose under the old tie rule
          status: 'pending',
          created_at: earlyAt,
        },
        {
          league_id: league.leagueId,
          team_id: lateTeam.id,
          player_id: fa.id,
          bid_amount: 10,
          priority: 1, // best priority — would win under the old tie rule
          status: 'pending',
          created_at: lateAt,
        },
      ]);
      expect(cErr).toBeNull();

      const { data, status } = await cronInvoke('process-waivers');
      expect(status).toBe(200);
      expect((data as { ok?: boolean } | null)?.ok).toBe(true);

      // The earlier bid won despite the worse waiver priority.
      const owner = await getPlayerOwner(league.leagueId, fa.id);
      expect(owner).toBe(earlyTeam.id);

      const { data: claims } = await admin
        .from('waiver_claims')
        .select('team_id, status')
        .eq('league_id', league.leagueId)
        .eq('player_id', fa.id);
      const statusByTeam = new Map((claims ?? []).map((c) => [c.team_id, c.status]));
      expect(statusByTeam.get(earlyTeam.id)).toBe('successful');
      expect(statusByTeam.get(lateTeam.id)).toBe('failed');
    },
    TIMEOUT,
  );
});
