/**
 * Regression tests for the sync-game-schedule row builder
 * (supabase/functions/sync-game-schedule/pure.ts).
 *
 * The headline scenario: the old `deriveStatus` used an exact `=== "Final"`
 * match, but BDL reports WNBA finals as "post" and NFL overtime finals as
 * "Final/OT". Every weekly WNBA sync rewrote the whole season's finished
 * games back to status='scheduled' with NULL scores (151 games clobbered in
 * prod), and the daily NFL sync would have downgraded live Sunday games
 * mid-slate. The fix: finality via mapGameStatus, and non-final rows OMIT the
 * status/score keys entirely so the upsert can never downgrade a row that
 * poll-live-stats already marked 'live'/'final'.
 */

import { buildScheduleRows, normalizeGameTimeUtc } from '../supabase/functions/sync-game-schedule/pure';
import { bdlGameSlateDate } from '../utils/sports/bdlDates';
import { mapGameStatus, type GameStatusSport } from '../utils/sports/gameStatus';

function depsFor(sport: GameStatusSport) {
  return {
    isFinal: (status: string, kickoffIso: string | null) =>
      mapGameStatus(status, sport, kickoffIso) === 3,
    slateDateOf: bdlGameSlateDate,
  };
}

// Real WNBA /games shape: scores are `home_score`/`away_score` (NOT the
// NBA-style `home_team_score`/`visitor_team_score`), the tipoff lives in
// `date` as a full ISO timestamp, and there is no `datetime` key.
const wnbaGame = (over: Record<string, unknown> = {}) => ({
  id: 24897,
  status: 'post',
  date: '2026-07-02T23:00:00Z',
  home_team: { abbreviation: 'WSH' },
  visitor_team: { abbreviation: 'ATL' },
  home_score: 82,
  away_score: 80,
  ...over,
});

// Real NBA /games shape: NBA-style score names, plain `date`, ISO `datetime`.
const nbaGame = (over: Record<string, unknown> = {}) => ({
  id: 15001,
  status: 'Final',
  date: '2026-01-15',
  datetime: '2026-01-16T00:00:00Z',
  home_team: { abbreviation: 'BOS' },
  visitor_team: { abbreviation: 'LAL' },
  home_team_score: 112,
  visitor_team_score: 104,
  ...over,
});

describe('buildScheduleRows — finals detection per sport vocabulary', () => {
  it("regression: WNBA 'post' is a final AND its home_score/away_score field names are read (the NBA-only read NULLed WNBA scores)", () => {
    const { finals, pending } = buildScheduleRows([wnbaGame()], 'wnba', '2026', depsFor('wnba'));
    expect(pending).toHaveLength(0);
    expect(finals).toHaveLength(1);
    expect(finals[0]).toMatchObject({
      sport: 'wnba',
      game_id: '24897',
      status: 'final',
      home_score: 82,
      away_score: 80,
    });
  });

  it("regression: NFL 'Final/OT' is a final (NBA-style score fields)", () => {
    const { finals, pending } = buildScheduleRows(
      [nbaGame({ status: 'Final/OT', date: '2026-11-08T18:00:00Z', datetime: undefined, week: 7 })],
      'nfl',
      '2026',
      depsFor('nfl'),
    );
    expect(pending).toHaveLength(0);
    expect(finals).toHaveLength(1);
    expect(finals[0].week).toBe(7);
    expect(finals[0].home_score).toBe(112);
    expect(finals[0].away_score).toBe(104);
  });

  it("NBA 'Final' maps to a final and reads home_team_score/visitor_team_score", () => {
    const { finals } = buildScheduleRows([nbaGame()], 'nba', '2025-26', depsFor('nba'));
    expect(finals).toHaveLength(1);
    expect(finals[0].season).toBe('2025-26');
    expect(finals[0].home_score).toBe(112);
    expect(finals[0].away_score).toBe(104);
  });
});

describe('buildScheduleRows — non-final rows can never downgrade', () => {
  it("a live game ('Q3 5:42' / 'in') lands in pending WITHOUT status or score keys", () => {
    const { finals, pending } = buildScheduleRows(
      [wnbaGame({ status: 'in' }), wnbaGame({ id: 24898, status: 'Q3 5:42' })],
      'wnba',
      '2026',
      depsFor('wnba'),
    );
    expect(finals).toHaveLength(0);
    expect(pending).toHaveLength(2);
    for (const row of pending) {
      // The absent keys are the whole fix: PostgREST only SETs payload keys
      // on conflict, so existing 'live'/'final' rows keep their status and
      // scores, and fresh inserts take the column DEFAULT 'scheduled'.
      expect(row).not.toHaveProperty('status');
      expect(row).not.toHaveProperty('home_score');
      expect(row).not.toHaveProperty('away_score');
    }
  });

  it('a scheduled game (ISO-timestamp status) lands in pending', () => {
    const { finals, pending } = buildScheduleRows(
      [wnbaGame({ status: '2026-10-21T23:30:00Z' })],
      'wnba',
      '2026',
      depsFor('wnba'),
    );
    expect(finals).toHaveLength(0);
    expect(pending).toHaveLength(1);
  });

  it("an NFL pre-game slate status ('9/9 - 8:20 PM EDT') lands in pending", () => {
    const { pending } = buildScheduleRows(
      [wnbaGame({ status: '9/9 - 8:20 PM EDT', date: '2027-09-09T00:20:00Z', week: 1 })],
      'nfl',
      '2026',
      depsFor('nfl'),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].week).toBe(1);
  });
});

describe('buildScheduleRows — dates, placeholders, and drops', () => {
  it('anchors game_date on the ET slate (10pm ET tip = 02:00 UTC next day stays on its night)', () => {
    const { finals } = buildScheduleRows(
      [wnbaGame({ date: '2026-07-03T02:00:00Z' })], // 10pm ET on Jul 2
      'wnba',
      '2026',
      depsFor('wnba'),
    );
    expect(finals[0].game_date).toBe('2026-07-02');
  });

  it('nulls the midnight-ET TBD placeholder in game_time_utc but keeps the game_date', () => {
    const { pending } = buildScheduleRows(
      [wnbaGame({ status: 'pre', date: '2026-05-03T04:00:00Z' })], // midnight ET during EDT
      'wnba',
      '2026',
      depsFor('wnba'),
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].game_time_utc).toBeNull();
    // bdlGameSlateDate buckets ET hours < 5am back one day, so a midnight-ET
    // placeholder files under the previous slate — same as the original code.
    expect(pending[0].game_date).toBe('2026-05-02');
  });

  it('drops games missing a team abbreviation or a resolvable date', () => {
    const { finals, pending } = buildScheduleRows(
      [
        wnbaGame({ home_team: {} }),
        wnbaGame({ id: 24899, date: null, datetime: null }),
      ],
      'wnba',
      '2026',
      depsFor('wnba'),
    );
    expect(finals).toHaveLength(0);
    expect(pending).toHaveLength(0);
  });

  it('only NFL rows carry the week key', () => {
    const { finals } = buildScheduleRows([wnbaGame()], 'wnba', '2026', depsFor('wnba'));
    expect(finals[0]).not.toHaveProperty('week');
  });
});

describe('normalizeGameTimeUtc', () => {
  it('passes real tipoffs through and nulls midnight-ET placeholders', () => {
    expect(normalizeGameTimeUtc('2026-07-02T23:00:00Z')).toBe('2026-07-02T23:00:00Z');
    expect(normalizeGameTimeUtc('2026-05-03T04:00:00Z')).toBeNull(); // 00:00 ET (EDT)
    expect(normalizeGameTimeUtc('2026-01-15T05:00:00Z')).toBeNull(); // 00:00 ET (EST)
    expect(normalizeGameTimeUtc(null)).toBeNull();
    expect(normalizeGameTimeUtc('garbage')).toBeNull();
  });
});
