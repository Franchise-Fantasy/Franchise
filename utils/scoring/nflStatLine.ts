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

/**
 * D/ST points-allowed scoring tiers — the classic fantasy bracket. The tier
 * RESULT is what gets scored (written to `dst_pa_pts` at ingest by
 * poll-live-stats via _shared/nflStats.ts); the league's DST_PA point_value
 * is a scale factor on it, which is why the weight itself is +1 and not
 * negative. Single source for the ingest calc AND the wizard's explainer
 * copy — keep label/pts/max together so the two can't drift.
 */
export const DST_PA_TIERS: { label: string; max: number; pts: number }[] = [
  { label: '0', max: 0, pts: 10 },
  { label: '1–6', max: 6, pts: 7 },
  { label: '7–13', max: 13, pts: 4 },
  { label: '14–20', max: 20, pts: 1 },
  { label: '21–27', max: 27, pts: 0 },
  { label: '28–34', max: 34, pts: -1 },
  { label: '35+', max: Infinity, pts: -4 },
];

/** Tier points for a D/ST's points allowed (see {@link DST_PA_TIERS}). */
export function dstPointsAllowedPts(pointsAllowed: number): number {
  for (const tier of DST_PA_TIERS) {
    if (pointsAllowed <= tier.max) return tier.pts;
  }
  return DST_PA_TIERS[DST_PA_TIERS.length - 1].pts;
}

/**
 * Live-ticker event kinds for NFL, and the column each one diffs.
 *
 * The basketball tape emits shot-by-shot detail because basketball generates a
 * scoring event every ~30 seconds. Football's cadence is the opposite: ~12
 * possessions a side, most plays worth a few yards. So the NFL tape emits only
 * the plays that MOVE a fantasy score — touchdowns, turnovers, kicks, D/ST
 * takeaways — rather than every completion. Yardage isn't an event: it would
 * fire on nearly every snap and drown the band it's rendered in.
 *
 * `kind` is deliberately identical to the league's scoring `stat_name`, so the
 * client's fpts-per-event calc is just `value × weight(kind)` with no map.
 *
 * The DB CHECK on live_scoring_events.kind must list every kind here — a single
 * unlisted kind aborts the whole batch INSERT and silently drops every event in
 * that poll cycle (that bug already bit the basketball tape once; see migration
 * 20260510184500).
 */
export const NFL_EVENT_DEFS = [
  { kind: 'PASS_TD', col: 'pass_td', one: 'PASSING TD', many: 'PASSING TDS' },
  { kind: 'RUSH_TD', col: 'rush_td', one: 'RUSHING TD', many: 'RUSHING TDS' },
  { kind: 'REC_TD', col: 'rec_td', one: 'RECEIVING TD', many: 'RECEIVING TDS' },
  { kind: 'RET_TD', col: 'ret_td', one: 'RETURN TD', many: 'RETURN TDS' },
  { kind: 'DST_TD', col: 'dst_td', one: 'DEFENSIVE TD', many: 'DEFENSIVE TDS' },
  { kind: 'PASS_INT', col: 'pass_int', one: 'THREW INT', many: 'INTS THROWN' },
  { kind: 'FUM_LOST', col: 'fum_lost', one: 'FUMBLE LOST', many: 'FUMBLES LOST' },
  { kind: 'FG', col: 'fg_made', one: 'FIELD GOAL', many: 'FIELD GOALS' },
  { kind: 'XP', col: 'xp_made', one: 'EXTRA POINT', many: 'EXTRA POINTS' },
  { kind: 'DST_SACK', col: 'dst_sacks', one: 'SACK', many: 'SACKS' },
  { kind: 'DST_INT', col: 'dst_int', one: 'D/ST INT', many: 'D/ST INTS' },
  { kind: 'DST_FUM_REC', col: 'dst_fum_rec', one: 'FUMBLE REC', many: 'FUMBLE RECS' },
] as const;

export type NflEventKind = (typeof NFL_EVENT_DEFS)[number]['kind'];

/** The NFL columns the live tape diffs — the select for the previous snapshot
 *  must carry all of them or a stat that moved reads as unchanged. */
export const NFL_EVENT_COLUMNS = NFL_EVENT_DEFS.map((d) => d.col);

/** Ticker label for an NFL event ("2 PASSING TDS" / "SACK"). */
export function nflEventLabel(kind: string, value: number): string | null {
  const def = NFL_EVENT_DEFS.find((d) => d.kind === kind);
  if (!def) return null;
  return value > 1 ? `${value} ${def.many}` : def.one;
}

/**
 * Events implied by the change between two NFL stat snapshots. Only positive
 * deltas emit — BDL occasionally revises a stat down (a TD reversed on review),
 * and "un-scoring" a play mid-tape would be worse than staying silent.
 */
export function deriveNflEvents(prev: StatRow, curr: StatRow): { kind: NflEventKind; value: number }[] {
  const events: { kind: NflEventKind; value: number }[] = [];
  for (const def of NFL_EVENT_DEFS) {
    const delta = num(curr, def.col) - num(prev, def.col);
    if (delta > 0) events.push({ kind: def.kind, value: delta });
  }
  return events;
}

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

/**
 * Adapt a season-average row (`avg_<col>` keys — player_season_stats rows or
 * merged historical rows) to the game-column shape {@link nflStatFields}
 * expects. Values stay per-game averages; null/absent columns are dropped so
 * the position-shape detection (which keys the row carries) still works.
 */
export function nflAvgRowToGameShape(row: StatRow): StatRow {
  const out: StatRow = {};
  for (const col of NFL_GAME_COLUMNS) {
    const v = row[`avg_${col}`];
    if (v != null) out[col] = Number(v);
  }
  return out;
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
