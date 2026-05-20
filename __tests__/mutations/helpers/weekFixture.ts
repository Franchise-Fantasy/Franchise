// Helpers for testing scoring math against `get-week-scores` and (later)
// `finalize-week`. The function reads from the past-week `player_games` table
// (not `live_player_stats`) when end_date < today, so these fixtures create a
// finalized week with deterministic game logs and assert exact point totals.
//
// Each scoring test calls seedScoringFixture() in beforeAll, populates per-day
// lineups + game logs in the test body, invokes the function, then asserts.
// cleanupScoringFixture() in afterAll wipes the schedule + matchups + scoring
// + lineups + game logs the fixture created (canonical rosters are preserved
// by the test league's bootstrap snapshot).

import { adminClient } from './clients';

export interface ScoringWeight {
  stat_name: string;
  point_value: number;
  is_enabled?: boolean;
  inverse?: boolean;
}

export interface SeededWeek {
  scheduleId: string;
  weekStart: string;
  weekEnd: string;
  matchupIds: string[];
  teamPairs: Array<[homeId: string, awayId: string]>;
}

/**
 * Create a finalized week (end_date in the past) with matchups + scoring
 * settings. Pass a list of [home, away] team pairs.
 *
 * Default scoring is the canonical NBA points payout: PTS=1, REB=1.2, AST=1.5,
 * STL=3, BLK=3, TO=-1, 3PM=1. Override via `opts.scoring`.
 */
export async function seedScoringFixture(opts: {
  leagueId: string;
  /** Week number assigned to this league_schedule row. */
  weekNumber: number;
  /** YYYY-MM-DD, must be in the past so the week is treated as finalized. */
  weekStart: string;
  weekEnd: string;
  /** Season string written to league_schedule.season. */
  season: string;
  teamPairs: Array<[homeId: string, awayId: string]>;
  scoring?: ScoringWeight[];
}): Promise<SeededWeek> {
  const admin = adminClient();

  // Wipe any pre-existing scoring/schedule rows for this league so reruns are
  // idempotent. We don't touch the league_players canonical rosters here.
  await admin.from('league_matchups').delete().eq('league_id', opts.leagueId);
  await admin.from('league_schedule').delete().eq('league_id', opts.leagueId);
  await admin.from('league_scoring_settings').delete().eq('league_id', opts.leagueId);

  const { data: schedule, error: schedErr } = await admin
    .from('league_schedule')
    .insert({
      league_id: opts.leagueId,
      week_number: opts.weekNumber,
      start_date: opts.weekStart,
      end_date: opts.weekEnd,
      is_playoff: false,
      season: opts.season,
    })
    .select('id')
    .single();
  if (schedErr || !schedule) throw new Error(`Seed schedule failed: ${schedErr?.message}`);

  const matchupRows = opts.teamPairs.map(([home, away]) => ({
    league_id: opts.leagueId,
    schedule_id: schedule.id,
    week_number: opts.weekNumber,
    home_team_id: home,
    away_team_id: away,
    home_score: 0,
    away_score: 0,
    is_finalized: false,
    stats_flushed: false,
  }));
  const { data: matchups, error: matchErr } = await admin
    .from('league_matchups')
    .insert(matchupRows)
    .select('id');
  if (matchErr || !matchups) throw new Error(`Seed matchups failed: ${matchErr?.message}`);

  const scoring: ScoringWeight[] = opts.scoring ?? [
    { stat_name: 'PTS', point_value: 1, is_enabled: true, inverse: false },
    { stat_name: 'REB', point_value: 1.2, is_enabled: true, inverse: false },
    { stat_name: 'AST', point_value: 1.5, is_enabled: true, inverse: false },
    { stat_name: 'STL', point_value: 3, is_enabled: true, inverse: false },
    { stat_name: 'BLK', point_value: 3, is_enabled: true, inverse: false },
    { stat_name: 'TO', point_value: -1, is_enabled: true, inverse: false },
    { stat_name: '3PM', point_value: 1, is_enabled: true, inverse: false },
  ];
  const { error: scoringErr } = await admin.from('league_scoring_settings').insert(
    scoring.map((s) => ({ league_id: opts.leagueId, ...s, is_enabled: s.is_enabled ?? true, inverse: s.inverse ?? false })),
  );
  if (scoringErr) throw new Error(`Seed scoring settings failed: ${scoringErr.message}`);

  return {
    scheduleId: schedule.id,
    weekStart: opts.weekStart,
    weekEnd: opts.weekEnd,
    matchupIds: matchups.map((m) => m.id),
    teamPairs: opts.teamPairs,
  };
}

/**
 * Upsert daily_lineups rows. Use this to control which slot each player
 * occupies on each day of the week — active starter slots (PG/SG/.../UTIL)
 * count toward the team score; BE/IR/TAXI/DROPPED don't.
 */
export async function setDailyLineups(opts: {
  leagueId: string;
  entries: Array<{ team_id: string; player_id: string; date: string; slot: string }>;
}): Promise<void> {
  const admin = adminClient();
  // Wipe existing rows for any (team, player, date) combo we're about to write
  // so a stale slot from another test doesn't leak in.
  for (const e of opts.entries) {
    await admin
      .from('daily_lineups')
      .delete()
      .eq('league_id', opts.leagueId)
      .eq('team_id', e.team_id)
      .eq('player_id', e.player_id)
      .eq('lineup_date', e.date);
  }
  const rows = opts.entries.map((e) => ({
    league_id: opts.leagueId,
    team_id: e.team_id,
    player_id: e.player_id,
    lineup_date: e.date,
    roster_slot: e.slot,
  }));
  const { error } = await admin.from('daily_lineups').insert(rows);
  if (error) throw new Error(`Seed daily lineups failed: ${error.message}`);
}

interface GameStat {
  player_id: string;
  game_date: string;
  pts?: number;
  reb?: number;
  ast?: number;
  stl?: number;
  blk?: number;
  tov?: number;
  fgm?: number;
  fga?: number;
  '3pm'?: number;
  '3pa'?: number;
  ftm?: number;
  fta?: number;
  pf?: number;
  /** Auto-computed from stat counts if not set. */
  double_double?: boolean;
  triple_double?: boolean;
  min?: number;
  /** Used to compute double/triple-double if not explicitly provided. */
}

/**
 * Insert player_games rows for the test week. Stats default to 0; pass only
 * what you need. game_id is auto-generated as `test:<player>:<date>` so reruns
 * are idempotent via cleanupScoringFixture's date-range delete.
 */
export async function seedPlayerGames(rows: GameStat[]): Promise<void> {
  const admin = adminClient();
  const inserts = rows.map((r) => {
    const pts = r.pts ?? 0;
    const reb = r.reb ?? 0;
    const ast = r.ast ?? 0;
    const stl = r.stl ?? 0;
    const blk = r.blk ?? 0;
    const tens = [pts, reb, ast, stl, blk].filter((v) => v >= 10).length;
    return {
      game_id: `test:${r.player_id}:${r.game_date}`,
      player_id: r.player_id,
      game_date: r.game_date,
      sport: 'nba',
      min: r.min ?? 30,
      pts, reb, ast, stl, blk,
      tov: r.tov ?? 0,
      fgm: r.fgm ?? 0, fga: r.fga ?? 0,
      '3pm': r['3pm'] ?? 0, '3pa': r['3pa'] ?? 0,
      ftm: r.ftm ?? 0, fta: r.fta ?? 0,
      pf: r.pf ?? 0,
      double_double: r.double_double ?? tens >= 2,
      triple_double: r.triple_double ?? tens >= 3,
    };
  });
  // Upsert by (player_id, game_date) — schema PK is `id`, so we delete
  // matching test rows first to keep this idempotent.
  for (const ins of inserts) {
    await admin.from('player_games').delete().eq('game_id', ins.game_id);
  }
  const { error } = await admin.from('player_games').insert(inserts);
  if (error) throw new Error(`Seed player games failed: ${error.message}`);
}

/**
 * Tear down a week fixture. Removes the schedule/matchups/scoring + any
 * daily_lineups or player_games inserted via the test:* game_id convention.
 */
export async function cleanupScoringFixture(opts: {
  leagueId: string;
  scheduleId: string;
  weekStart: string;
  weekEnd: string;
}): Promise<void> {
  const admin = adminClient();
  // player_games rows inserted by tests use the `test:` prefix.
  await admin.from('player_games').delete().like('game_id', 'test:%').gte('game_date', opts.weekStart).lte('game_date', opts.weekEnd);
  await admin
    .from('daily_lineups')
    .delete()
    .eq('league_id', opts.leagueId)
    .gte('lineup_date', opts.weekStart)
    .lte('lineup_date', opts.weekEnd);
  await admin.from('week_scores').delete().eq('schedule_id', opts.scheduleId);
  await admin.from('league_matchups').delete().eq('league_id', opts.leagueId);
  await admin.from('league_schedule').delete().eq('id', opts.scheduleId);
  await admin.from('league_scoring_settings').delete().eq('league_id', opts.leagueId);
}
