// Regression tests for the SCORE SOURCE that scan-close-matchups reads.
//
// The bug these pin (2026-07-12): the scanner read the matchup score from
// `league_matchups.home_score`/`away_score`, which are written ONLY by
// finalize-week. Mid-week they sit at 0.00, so every unfinalized matchup
// looked like a 0-0 tie, `pointsClose(0, 0)` is trivially true, and both teams
// of every matchup got a "your matchup is within 0.0 pts" push. Playoff weeks
// were the worst case: update-standings mirrors week_scores into
// league_matchups daily, but it skips playoff matchups by design, so those
// scores were 0.00 for the entire week.
//
// The live running total lives in `week_scores`. These tests seed one genuinely
// close matchup and one blowout with IDENTICAL (zeroed) league_matchups scores,
// and assert only the close one notifies — which is exactly the discrimination
// the old code could not make.
//
// We assert on `close_matchup_notifications_sent` (the dedup table) rather than
// on pushes: it's the function's durable side effect, and the bot teams have no
// push tokens, so nothing leaves the building. Matchups here are bot-vs-bot on
// purpose — the watcher team (a real human) is never in one, so a test run
// can't ping a real phone.
//
// Note: this invokes the real cron endpoint, which scans EVERY league whose
// week ends today, not just the test league. That's the same work pg_cron does
// every 30 min, and the down-to-the-wire gate is evaluated at call time, so a
// test run can't make a real league notify any earlier than it otherwise would.

import { addSlateDays, getSportToday } from '@/utils/leagueTime';

import { bootstrapTestLeague, type BootstrapResult } from '../helpers/bootstrap';
import { adminClient, cronInvoke } from '../helpers/clients';
import { getCanonicalRosterPlayerIds, restoreCanonicalRosters } from '../helpers/seed';
import { seedScoringFixture, setDailyLineups, cleanupScoringFixture, type SeededWeek } from '../helpers/weekFixture';

const TIMEOUT = 60_000;

/** Slot the starters occupy today. Anything outside BE/IR/TAXI/DROPPED counts. */
const STARTER_SLOT = 'UTIL';

/** game_id prefix so the fixture's game_schedule rows are identifiable + purgeable. */
const TEST_GAME_PREFIX = 'test:closematchup';

interface ScanResponse {
  ok: boolean;
  qualified: number;
  sent: number;
  suppressed_by_dedup: number;
  suppressed_not_imminent: number;
  skipped_unscored: number;
}

async function setWeekScores(
  leagueId: string,
  scheduleId: string,
  scores: { teamId: string; score: number }[],
): Promise<void> {
  const admin = adminClient();
  await admin.from('week_scores').delete().eq('schedule_id', scheduleId);
  const { error } = await admin.from('week_scores').insert(
    scores.map((s) => ({
      league_id: leagueId,
      schedule_id: scheduleId,
      team_id: s.teamId,
      score: s.score,
    })),
  );
  if (error) throw new Error(`Seed week_scores failed: ${error.message}`);
}

/**
 * Put every starter's pro team into a LIVE game today, so the scanner's
 * down-to-the-wire gate passes and closeness is the only thing left deciding.
 */
async function seedLiveGamesFor(playerIds: string[], gameDate: string): Promise<string[]> {
  const admin = adminClient();
  const { data: players, error } = await admin
    .from('players')
    .select('id, pro_team, sport')
    .in('id', playerIds);
  if (error) throw new Error(`Fetch starter pro teams failed: ${error.message}`);

  const tricodes = [...new Set((players ?? []).map((p) => p.pro_team).filter(Boolean) as string[])];
  if (tricodes.length === 0) throw new Error('No starters had a pro_team — cannot seed live games.');

  const rows = tricodes.map((tricode) => ({
    game_id: `${TEST_GAME_PREFIX}:${tricode}:${gameDate}`,
    game_date: gameDate,
    home_team: tricode,
    away_team: `OPP-${tricode}`,
    season: '2026-27',
    sport: 'nba',
    status: 'live',
  }));
  await purgeTestGames();
  const { error: insErr } = await admin.from('game_schedule').insert(rows);
  if (insErr) throw new Error(`Seed game_schedule failed: ${insErr.message}`);
  return tricodes;
}

async function purgeTestGames(): Promise<void> {
  await adminClient().from('game_schedule').delete().like('game_id', `${TEST_GAME_PREFIX}%`);
}

async function notifiedMatchupIds(matchupIds: string[]): Promise<Set<string>> {
  const { data } = await adminClient()
    .from('close_matchup_notifications_sent')
    .select('matchup_id')
    .in('matchup_id', matchupIds);
  return new Set((data ?? []).map((r) => r.matchup_id as string));
}

async function clearDedup(matchupIds: string[]): Promise<void> {
  await adminClient().from('close_matchup_notifications_sent').delete().in('matchup_id', matchupIds);
}

describe('scan-close-matchups — reads the LIVE score, not the finalize-only column', () => {
  let league: BootstrapResult;
  let seeded: SeededWeek;
  let today: string;
  let weekStart: string;
  let closeMatchupId: string;
  let blowoutMatchupId: string;
  let closeHome: string;
  let closeAway: string;
  let blowoutHome: string;
  let blowoutAway: string;

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    await restoreCanonicalRosters(league.leagueId);

    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    [closeHome, closeAway, blowoutHome, blowoutAway] = [bots[0].id, bots[1].id, bots[2].id, bots[3].id];

    // The week must END today — that's the scanner's first gate.
    today = getSportToday(null);
    weekStart = addSlateDays(today, -6);

    seeded = await seedScoringFixture({
      leagueId: league.leagueId,
      weekNumber: 98,
      weekStart,
      weekEnd: today,
      season: '2026-27',
      teamPairs: [
        [closeHome, closeAway],
        [blowoutHome, blowoutAway],
      ],
    });
    [closeMatchupId, blowoutMatchupId] = seeded.matchupIds;

    // One starter per team, all in live games today.
    const rosters = await Promise.all(
      [closeHome, closeAway, blowoutHome, blowoutAway].map((id) =>
        getCanonicalRosterPlayerIds(league.leagueId, id),
      ),
    );
    const starters = rosters.map((r) => r[0]);
    await setDailyLineups({
      leagueId: league.leagueId,
      entries: starters.map((playerId, i) => ({
        team_id: [closeHome, closeAway, blowoutHome, blowoutAway][i],
        player_id: playerId,
        date: today,
        slot: STARTER_SLOT,
      })),
    });
    await seedLiveGamesFor(starters, today);
  }, TIMEOUT);

  afterAll(async () => {
    await purgeTestGames();
    if (!seeded) return;
    // close_matchup_notifications_sent cascades from league_matchups.
    await cleanupScoringFixture({
      leagueId: league.leagueId,
      scheduleId: seeded.scheduleId,
      weekStart,
      weekEnd: today,
    });
  }, TIMEOUT);

  beforeEach(async () => {
    await clearDedup([closeMatchupId, blowoutMatchupId]);
  });

  it(
    'notifies the close matchup and NOT the blowout, though both are 0-0 on league_matchups',
    async () => {
      // Both matchups' league_matchups scores are 0.00 (seedScoringFixture's
      // default, and what a real mid-week matchup actually holds). Reading that
      // column makes both look like a tie; reading week_scores tells them apart.
      await setWeekScores(league.leagueId, seeded.scheduleId, [
        { teamId: closeHome, score: 500 },
        { teamId: closeAway, score: 470 }, // gap 30 → inside the flat threshold
        { teamId: blowoutHome, score: 600 },
        { teamId: blowoutAway, score: 300 }, // gap 300 (50%) → not close by either rule
      ]);

      const { data, status } = await cronInvoke<ScanResponse>('scan-close-matchups');
      expect(status).toBe(200);
      expect(data?.ok).toBe(true);

      const notified = await notifiedMatchupIds([closeMatchupId, blowoutMatchupId]);
      expect(notified.has(closeMatchupId)).toBe(true);
      expect(notified.has(blowoutMatchupId)).toBe(false);
    },
    TIMEOUT,
  );

  it(
    'sends nothing for an unscored week rather than a phantom "within 0.0 pts" push',
    async () => {
      // No week_scores rows at all — get-week-scores hasn't run for this week.
      // The old code read 0-0 off league_matchups and called it a nail-biter.
      await adminClient().from('week_scores').delete().eq('schedule_id', seeded.scheduleId);

      const { data, status } = await cronInvoke<ScanResponse>('scan-close-matchups');
      expect(status).toBe(200);
      expect(data?.skipped_unscored).toBeGreaterThanOrEqual(2);

      const notified = await notifiedMatchupIds([closeMatchupId, blowoutMatchupId]);
      expect(notified.size).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'treats a genuinely scoreless 0-0 week as unscored, not as a tie',
    async () => {
      await setWeekScores(league.leagueId, seeded.scheduleId, [
        { teamId: closeHome, score: 0 },
        { teamId: closeAway, score: 0 },
        { teamId: blowoutHome, score: 0 },
        { teamId: blowoutAway, score: 0 },
      ]);

      const { status } = await cronInvoke<ScanResponse>('scan-close-matchups');
      expect(status).toBe(200);

      const notified = await notifiedMatchupIds([closeMatchupId, blowoutMatchupId]);
      expect(notified.size).toBe(0);
    },
    TIMEOUT,
  );

  it(
    'does not re-notify a matchup already in the dedup table',
    async () => {
      await setWeekScores(league.leagueId, seeded.scheduleId, [
        { teamId: closeHome, score: 500 },
        { teamId: closeAway, score: 470 },
        { teamId: blowoutHome, score: 600 },
        { teamId: blowoutAway, score: 300 },
      ]);

      const first = await cronInvoke<ScanResponse>('scan-close-matchups');
      expect(first.data?.sent).toBeGreaterThanOrEqual(1);

      const second = await cronInvoke<ScanResponse>('scan-close-matchups');
      expect(second.data?.suppressed_by_dedup).toBeGreaterThanOrEqual(1);

      const notified = await notifiedMatchupIds([closeMatchupId, blowoutMatchupId]);
      expect(notified.has(closeMatchupId)).toBe(true);
      expect(notified.has(blowoutMatchupId)).toBe(false);
    },
    TIMEOUT,
  );
});
