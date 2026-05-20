// Correctness tests for get-week-scores in CLIENT MODE (specific league + week).
// The function is the live + recap scoring engine — every change to scoring
// math, slot-eligibility rules, or queued-drop handling has to land
// here without breaking these assertions.
//
// Each test seeds a finalized past week (end_date < today, so the function
// reads from player_games instead of live_player_stats) with hand-computed
// expected scores, then invokes get-week-scores via the service-role key.
// We use serverInvoke so we don't hit the user rate limiter across the
// suite — these tests don't exercise auth.

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';
import { clearRateLimits } from '../helpers/lifecycle';
import { restoreCanonicalRosters, getCanonicalRosterPlayerIds } from '../helpers/seed';
import {
  seedScoringFixture,
  setDailyLineups,
  seedPlayerGames,
  cleanupScoringFixture,
  type SeededWeek,
} from '../helpers/weekFixture';

const TIMEOUT = 45_000;

// A past week — 14 days ago, ending 8 days ago. Far enough in the past to
// guarantee end_date < today regardless of CI timezone, near enough that no
// real production schedule will collide.
function pastWeek(): { start: string; end: string; days: string[] } {
  const today = new Date();
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 14);
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

describe('get-week-scores — points-mode correctness', () => {
  let league: BootstrapResult;
  let teamA: BootstrapResult['teams'][number];
  let teamB: BootstrapResult['teams'][number];
  let playerA1: string; // first canonical player on team A
  let playerA2: string; // second canonical player on team A
  let playerB1: string;
  let week: ReturnType<typeof pastWeek>;
  let seeded: SeededWeek;
  let client: Awaited<ReturnType<typeof signInAsBot>>;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    client = await signInAsBot(1);
    await restoreCanonicalRosters(league.leagueId);
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    teamA = bots[0];
    teamB = bots[1];
    const [rosterA, rosterB] = await Promise.all([
      getCanonicalRosterPlayerIds(league.leagueId, teamA.id),
      getCanonicalRosterPlayerIds(league.leagueId, teamB.id),
    ]);
    playerA1 = rosterA[0];
    playerA2 = rosterA[1];
    playerB1 = rosterB[0];
    week = pastWeek();
    seeded = await seedScoringFixture({
      leagueId: league.leagueId,
      weekNumber: 99,
      weekStart: week.start,
      weekEnd: week.end,
      season: '2026-27',
      teamPairs: [[teamA.id, teamB.id]],
    });
  }, TIMEOUT);

  afterAll(async () => {
    if (!seeded) return;
    await cleanupScoringFixture({
      leagueId: league.leagueId,
      scheduleId: seeded.scheduleId,
      weekStart: week.start,
      weekEnd: week.end,
    });
  }, TIMEOUT);

  beforeEach(async () => {
    // Wipe any state from a prior test within this file.
    const admin = adminClient();
    await admin
      .from('daily_lineups')
      .delete()
      .eq('league_id', league.leagueId)
      .gte('lineup_date', week.start)
      .lte('lineup_date', week.end);
    await admin
      .from('player_games')
      .delete()
      .like('game_id', 'test:%')
      .gte('game_date', week.start)
      .lte('game_date', week.end);
    await admin.from('week_scores').delete().eq('schedule_id', seeded.scheduleId);

    // Clear bot1's per-user rate limit between tests — we make 4 calls in
    // quick succession and the prod rate limit otherwise 429s the later ones.
    const commissionerId = league.teams.find((t) => t.botIndex === 1)!.userId;
    await clearRateLimits(commissionerId, ['get-week-scores']);
  }, TIMEOUT);

  it(
    'sums active-slot player stats × point values for each team',
    async () => {
      // PlayerA1 is active (PG) on days 0 and 2. PlayerA2 is BE all week.
      // PlayerB1 is active (PG) on day 0 only.
      await setDailyLineups({
        leagueId: league.leagueId,
        entries: [
          { team_id: teamA.id, player_id: playerA1, date: week.days[0], slot: 'PG' },
          { team_id: teamA.id, player_id: playerA1, date: week.days[2], slot: 'PG' },
          { team_id: teamA.id, player_id: playerA2, date: week.days[0], slot: 'BE' },
          { team_id: teamB.id, player_id: playerB1, date: week.days[0], slot: 'PG' },
        ],
      });
      // PlayerA1: 20 pts + 10 reb + 5 ast on day 0 → 20 + 12 + 7.5 = 39.5
      // PlayerA1: 10 pts + 4 reb + 2 ast on day 2 → 10 + 4.8 + 3 = 17.8
      // Total team A: 57.3
      // PlayerA2: 30 pts (BE — should NOT count)
      // PlayerB1: 25 pts + 5 reb + 5 ast on day 0 → 25 + 6 + 7.5 = 38.5
      await seedPlayerGames([
        { player_id: playerA1, game_date: week.days[0], pts: 20, reb: 10, ast: 5 },
        { player_id: playerA1, game_date: week.days[2], pts: 10, reb: 4, ast: 2 },
        { player_id: playerA2, game_date: week.days[0], pts: 30 },
        { player_id: playerB1, game_date: week.days[0], pts: 25, reb: 5, ast: 5 },
      ]);

      const { data, error } = await client.functions.invoke('get-week-scores', {
        body: { league_id: league.leagueId, schedule_id: seeded.scheduleId },
      });
      expect(error).toBeNull();

      const scores = data?.scores as Record<string, number>;
      expect(scores).toBeTruthy();
      expect(scores[teamA.id]).toBeCloseTo(57.3, 1);
      expect(scores[teamB.id]).toBeCloseTo(38.5, 1);
    },
    TIMEOUT,
  );

  it(
    'excludes BE/IR slot days — same player active some days, benched others',
    async () => {
      // Player active day 0, benched day 2 (same player, same week).
      // Stats both days should aggregate to ONLY the day-0 stats.
      await setDailyLineups({
        leagueId: league.leagueId,
        entries: [
          { team_id: teamA.id, player_id: playerA1, date: week.days[0], slot: 'PG' },
          { team_id: teamA.id, player_id: playerA1, date: week.days[2], slot: 'BE' },
        ],
      });
      await seedPlayerGames([
        { player_id: playerA1, game_date: week.days[0], pts: 10 },
        { player_id: playerA1, game_date: week.days[2], pts: 999 }, // benched — must NOT count
      ]);

      const { data, error } = await client.functions.invoke('get-week-scores', {
        body: { league_id: league.leagueId, schedule_id: seeded.scheduleId },
      });
      expect(error).toBeNull();
      const scores = data?.scores as Record<string, number>;
      // Only day-0's 10 pts should count.
      expect(scores[teamA.id]).toBeCloseTo(10, 1);
    },
    TIMEOUT,
  );

  it(
    'persists week_scores rows and emits the broadcast event signature',
    async () => {
      await setDailyLineups({
        leagueId: league.leagueId,
        entries: [
          { team_id: teamA.id, player_id: playerA1, date: week.days[0], slot: 'PG' },
          { team_id: teamB.id, player_id: playerB1, date: week.days[0], slot: 'PG' },
        ],
      });
      await seedPlayerGames([
        { player_id: playerA1, game_date: week.days[0], pts: 15 },
        { player_id: playerB1, game_date: week.days[0], pts: 25 },
      ]);

      const { error } = await client.functions.invoke('get-week-scores', {
        body: { league_id: league.leagueId, schedule_id: seeded.scheduleId },
      });
      expect(error).toBeNull();

      // upsertScores writes one row per (league, schedule, team).
      const admin = adminClient();
      const { data: rows } = await admin
        .from('week_scores')
        .select('team_id, score')
        .eq('league_id', league.leagueId)
        .eq('schedule_id', seeded.scheduleId);
      expect(rows).toHaveLength(2);
      const map = Object.fromEntries((rows ?? []).map((r) => [r.team_id, Number(r.score)]));
      expect(map[teamA.id]).toBeCloseTo(15, 1);
      expect(map[teamB.id]).toBeCloseTo(25, 1);
    },
    TIMEOUT,
  );

  it(
    'inverse scoring (turnovers as -1) actually subtracts from total',
    async () => {
      await setDailyLineups({
        leagueId: league.leagueId,
        entries: [
          { team_id: teamA.id, player_id: playerA1, date: week.days[0], slot: 'PG' },
        ],
      });
      // 20 pts (+20) + 5 TO (-5) = 15 fantasy points.
      await seedPlayerGames([
        { player_id: playerA1, game_date: week.days[0], pts: 20, tov: 5 },
      ]);

      const { data } = await client.functions.invoke('get-week-scores', {
        body: { league_id: league.leagueId, schedule_id: seeded.scheduleId },
      });
      const scores = data?.scores as Record<string, number>;
      expect(scores[teamA.id]).toBeCloseTo(15, 1);
    },
    TIMEOUT,
  );
});
