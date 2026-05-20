// End-to-end correctness for finalize-week. This is the safety net the
// 1100-line function never had. Seeds a finalized past week with a single
// matchup + scoring data, invokes finalize-week via the CRON_SECRET path,
// and asserts the entire chain of side effects:
//
//   - league_matchups.is_finalized = true with winner + scores
//   - week_scores rows persist with the correct totals
//   - teams.wins / losses incremented (regular season only)
//   - league_matchups.stats_flushed = true (idempotency marker)
//   - league_matchups.home_player_scores populated
//
// Other pending matchups in the dev DB will also get finalized by the cron's
// global sweep — that's fine, we scope all assertions to our seeded data.
// The test resets team standings + cleans up matchups in afterEach.

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, cronInvoke, getCronSecret } from '../helpers/clients';
import { restoreCanonicalRosters, getCanonicalRosterPlayerIds } from '../helpers/seed';
import {
  seedScoringFixture,
  setDailyLineups,
  seedPlayerGames,
  cleanupScoringFixture,
  type SeededWeek,
} from '../helpers/weekFixture';

const TIMEOUT = 60_000;

function pastWeek(): { start: string; end: string; days: string[] } {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 21);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  const ymd = (d: Date) => d.toISOString().slice(0, 10);
  const days: string[] = [];
  for (let i = 0; i < 7; i++) {
    const day = new Date(start);
    day.setUTCDate(start.getUTCDate() + i);
    days.push(ymd(day));
  }
  return { start: ymd(start), end: ymd(end), days };
}

describe('finalize-week end-to-end', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number];
  let teamB: BootstrapResult['teams'][number];
  let playerA1: string;
  let playerB1: string;
  let week: ReturnType<typeof pastWeek>;
  let seeded: SeededWeek;
  // Capture initial team wins/losses to assert deltas rather than absolute
  // values — other test runs may have left the teams with prior records.
  let baselineA: { wins: number; losses: number; ties: number };
  let baselineB: { wins: number; losses: number; ties: number };

  beforeAll(async () => {
    // Fail fast with a clear message if CRON_SECRET RPC isn't reachable —
    // better than every test throwing identically inside `cronInvoke`.
    const secret = await getCronSecret();
    if (!secret) {
      throw new Error(
        'test_get_cron_secret RPC unavailable. Apply migration 20260516XXXXXX_test_get_cron_secret_rpc.sql before running this suite.',
      );
    }
    league = await bootstrapTestLeague();
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamA = bots[0];
    teamB = bots[1];
    const [rA, rB] = await Promise.all([
      getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
      getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
    ]);
    playerA1 = rA[0];
    playerB1 = rB[0];
    week = pastWeek();
  }, TIMEOUT);

  beforeEach(async () => {
    const admin = adminClient();
    // Capture baseline records
    const { data: rows } = await admin
      .from('teams')
      .select('id, wins, losses, ties')
      .in('id', [teamA.id, teamB.id]);
    const map = Object.fromEntries((rows ?? []).map((r) => [r.id, r]));
    baselineA = { wins: map[teamA.id].wins, losses: map[teamA.id].losses, ties: map[teamA.id].ties };
    baselineB = { wins: map[teamB.id].wins, losses: map[teamB.id].losses, ties: map[teamB.id].ties };

    // Seed the week fixture (creates schedule + matchup + scoring settings)
    seeded = await seedScoringFixture({
      leagueId: league.leagueId,
      weekNumber: 99,
      weekStart: week.start,
      weekEnd: week.end,
      season: '2026-27',
      teamPairs: [[teamA.id, teamB.id]],
    });
  }, TIMEOUT);

  afterEach(async () => {
    if (seeded) {
      await cleanupScoringFixture({
        leagueId: league.leagueId,
        scheduleId: seeded.scheduleId,
        weekStart: week.start,
        weekEnd: week.end,
      });
    }
    // Restore baselines so the next test (and other test files) see clean teams.
    const admin = adminClient();
    await admin.from('teams').update(baselineA).eq('id', teamA.id);
    await admin.from('teams').update(baselineB).eq('id', teamB.id);
  }, TIMEOUT);

  it(
    'finalizes a pending matchup: records winner, scores, W/L, and stats_flushed',
    async () => {
      // Team A: 1 active starter, day 0 only — playerA1 puts up 30/10/5 = 30+12+7.5 = 49.5 fpts
      // Team B: 1 active starter, day 0 only — playerB1 puts up 15/5/2 = 15+6+3 = 24 fpts
      // → home (A) wins.
      await setDailyLineups({
        leagueId: league.leagueId,
        entries: [
          { team_id: teamA.id, player_id: playerA1, date: week.days[0], slot: 'PG' },
          { team_id: teamB.id, player_id: playerB1, date: week.days[0], slot: 'PG' },
        ],
      });
      await seedPlayerGames([
        { player_id: playerA1, game_date: week.days[0], pts: 30, reb: 10, ast: 5 },
        { player_id: playerB1, game_date: week.days[0], pts: 15, reb: 5, ast: 2 },
      ]);

      const result = await cronInvoke('finalize-week');
      expect(result.status).toBe(200);
      expect(result.data?.ok).toBe(true);

      const admin = adminClient();

      // Matchup is finalized + winner set
      const { data: matchup } = await admin
        .from('league_matchups')
        .select('is_finalized, stats_flushed, winner_team_id, home_score, away_score, home_player_scores, away_player_scores')
        .eq('id', seeded.matchupIds[0])
        .single();
      expect(matchup?.is_finalized).toBe(true);
      expect(matchup?.stats_flushed).toBe(true);
      expect(matchup?.winner_team_id).toBe(teamA.id);
      expect(Number(matchup?.home_score)).toBeCloseTo(49.5, 1);
      expect(Number(matchup?.away_score)).toBeCloseTo(24, 1);
      expect(matchup?.home_player_scores).toBeTruthy();
      expect(matchup?.away_player_scores).toBeTruthy();

      // week_scores rows persisted
      const { data: scoreRows } = await admin
        .from('week_scores')
        .select('team_id, score')
        .eq('league_id', league.leagueId)
        .eq('schedule_id', seeded.scheduleId);
      expect(scoreRows).toHaveLength(2);
      const scoreMap = Object.fromEntries((scoreRows ?? []).map((r) => [r.team_id, Number(r.score)]));
      expect(scoreMap[teamA.id]).toBeCloseTo(49.5, 1);
      expect(scoreMap[teamB.id]).toBeCloseTo(24, 1);

      // teams.wins / losses incremented by exactly 1
      const { data: teamsAfter } = await admin
        .from('teams')
        .select('id, wins, losses, ties')
        .in('id', [teamA.id, teamB.id]);
      const teamsMap = Object.fromEntries((teamsAfter ?? []).map((t) => [t.id, t]));
      expect(teamsMap[teamA.id].wins).toBe(baselineA.wins + 1);
      expect(teamsMap[teamA.id].losses).toBe(baselineA.losses);
      expect(teamsMap[teamB.id].wins).toBe(baselineB.wins);
      expect(teamsMap[teamB.id].losses).toBe(baselineB.losses + 1);
    },
    TIMEOUT,
  );

  it(
    'records a tie when scores are equal',
    async () => {
      // Both teams: 20 pts on day 0 → 20 fpts each → tie
      await setDailyLineups({
        leagueId: league.leagueId,
        entries: [
          { team_id: teamA.id, player_id: playerA1, date: week.days[0], slot: 'PG' },
          { team_id: teamB.id, player_id: playerB1, date: week.days[0], slot: 'PG' },
        ],
      });
      await seedPlayerGames([
        { player_id: playerA1, game_date: week.days[0], pts: 20 },
        { player_id: playerB1, game_date: week.days[0], pts: 20 },
      ]);

      const result = await cronInvoke('finalize-week');
      expect(result.status).toBe(200);

      const admin = adminClient();
      const { data: matchup } = await admin
        .from('league_matchups')
        .select('winner_team_id, home_score, away_score')
        .eq('id', seeded.matchupIds[0])
        .single();
      expect(matchup?.winner_team_id).toBeNull();
      expect(Number(matchup?.home_score)).toBeCloseTo(20, 1);
      expect(Number(matchup?.away_score)).toBeCloseTo(20, 1);

      // Both teams get +1 tie, no wins/losses delta
      const { data: teamsAfter } = await admin
        .from('teams')
        .select('id, wins, losses, ties')
        .in('id', [teamA.id, teamB.id]);
      const map = Object.fromEntries((teamsAfter ?? []).map((t) => [t.id, t]));
      expect(map[teamA.id].ties).toBe(baselineA.ties + 1);
      expect(map[teamB.id].ties).toBe(baselineB.ties + 1);
      expect(map[teamA.id].wins).toBe(baselineA.wins);
      expect(map[teamB.id].wins).toBe(baselineB.wins);
    },
    TIMEOUT,
  );

  it(
    'is idempotent — re-running finalize-week does not double-count',
    async () => {
      await setDailyLineups({
        leagueId: league.leagueId,
        entries: [
          { team_id: teamA.id, player_id: playerA1, date: week.days[0], slot: 'PG' },
          { team_id: teamB.id, player_id: playerB1, date: week.days[0], slot: 'PG' },
        ],
      });
      await seedPlayerGames([
        { player_id: playerA1, game_date: week.days[0], pts: 30 },
        { player_id: playerB1, game_date: week.days[0], pts: 10 },
      ]);

      // First run claims + finalizes
      await cronInvoke('finalize-week');
      // Second run must see is_finalized=true and skip the W/L update
      const second = await cronInvoke('finalize-week');
      expect(second.status).toBe(200);

      const admin = adminClient();
      const { data: teamsAfter } = await admin
        .from('teams')
        .select('id, wins, losses, ties')
        .in('id', [teamA.id, teamB.id]);
      const map = Object.fromEntries((teamsAfter ?? []).map((t) => [t.id, t]));
      // Still exactly +1 win/loss, not +2.
      expect(map[teamA.id].wins).toBe(baselineA.wins + 1);
      expect(map[teamB.id].losses).toBe(baselineB.losses + 1);
    },
    TIMEOUT,
  );

  it(
    'rejects calls without the CRON_SECRET (security gate)',
    async () => {
      const res = await fetch(
        `${(await import('../helpers/config')).SUPABASE_URL}/functions/v1/finalize-week`,
        {
          method: 'POST',
          headers: { Authorization: 'Bearer wrong-secret', 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        },
      );
      expect(res.status).toBe(401);
    },
    TIMEOUT,
  );
});
