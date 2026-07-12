/**
 * Compact NFL stat-line formatting shared by every surface that shows a
 * one-line NFL box score: matchup PlayerCell / tickers / WeekSummarySheet on
 * the client, and poll-live-stats' Live Activity player lines on the edge.
 *
 * Zero dependencies on purpose (same pattern as utils/sports/registry.ts):
 * importable from Metro (`@/utils/scoring/nflStatLine`) AND Deno edge
 * functions (`../../../utils/scoring/nflStatLine.ts`).
 *
 * NFL lines are position-shaped — a QB line is "18/27 245Y 2TD", a receiver
 * line "5REC 87Y 1TD" — so unlike basketball's fixed PTS/REB/AST triple the
 * fields are picked from whichever stat group the row actually has. Works on
 * any row shape that carries the NFL game columns (player_games,
 * live_player_stats, or the frozen player_scores stats payload).
 */

type StatRow = Record<string, unknown>;

/**
 * The NFL per-game stat columns every stat surface reads: the scoring columns
 * (registry NFL_STAT_TO_GAME values, minus the never-ingested two_pt /
 * dst_safety) plus the display extras (completions/attempts, carries, targets,
 * FG attempts, raw points allowed). Single source for client selects, the
 * frozen player_scores payload (edge finalizeWeek), and week-stat rollups.
 */
export const NFL_GAME_COLUMNS = [
  'pass_cmp', 'pass_att', 'pass_yd', 'pass_td', 'pass_int',
  'rush_att', 'rush_yd', 'rush_td',
  'rec', 'targets', 'rec_yd', 'rec_td',
  'fum_lost', 'ret_td',
  'fg_made', 'fg_att', 'xp_made',
  'dst_sacks', 'dst_int', 'dst_fum_rec', 'dst_td', 'dst_pts_allowed', 'dst_pa_pts',
] as const;

function num(row: StatRow, key: string): number {
  const v = row[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function has(row: StatRow, key: string): boolean {
  return row[key] != null;
}

/**
 * Up to three [statKey, suffix] pairs for the row, picked by position shape.
 * Consumed by the matchup StatBlocks renderer (each pair becomes a
 * `${value}${suffix}` block) and by {@link nflStatLine}.
 */
export function nflStatFields(row: StatRow): Array<[string, string]> {
  // Passer: anyone who attempted a pass leads with the passing line.
  if (num(row, 'pass_att') > 0) {
    const third: [string, string] =
      num(row, 'rush_yd') > 0 && num(row, 'rush_yd') >= 10
        ? ['rush_yd', 'RuY']
        : ['pass_int', 'INT'];
    return [['pass_yd', 'Y'], ['pass_td', 'TD'], third];
  }
  // D/ST: identified by the points-allowed column only they carry.
  if (has(row, 'dst_pts_allowed') || has(row, 'dst_sacks')) {
    return [['dst_sacks', 'SCK'], ['dst_int', 'INT'], ['dst_pts_allowed', 'PA']];
  }
  // Kicker.
  if (num(row, 'fg_att') > 0 || num(row, 'xp_made') > 0) {
    return [['fg_made', 'FG'], ['fg_att', 'FGA'], ['xp_made', 'XP']];
  }
  // Skill player: lead with the bigger of the rushing/receiving days.
  const rushing = num(row, 'rush_yd');
  const receiving = num(row, 'rec_yd');
  if (rushing > receiving) {
    const third: [string, string] =
      num(row, 'rec') > 0 ? ['rec', 'REC'] : ['rush_att', 'CAR'];
    return [['rush_yd', 'Y'], ['rush_td', 'TD'], third];
  }
  return [['rec', 'REC'], ['rec_yd', 'Y'], ['rec_td', 'TD']];
}

/** "18/27 245Y 2TD"-style single-string line (tickers, Live Activities). */
export function nflStatLine(row: StatRow): string {
  const parts: string[] = [];
  // Passers get the completions/attempts fraction as the leading block.
  if (num(row, 'pass_att') > 0) {
    parts.push(`${num(row, 'pass_cmp')}/${num(row, 'pass_att')}`);
  }
  for (const [key, suffix] of nflStatFields(row)) {
    parts.push(`${num(row, key)}${suffix}`);
  }
  return parts.slice(0, 3).join(' ');
}
