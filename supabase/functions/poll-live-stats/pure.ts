/**
 * Pure helpers for poll-live-stats, extracted so jest can regression-test the
 * logic that gates writes and the player_season_stats matview refresh
 * (index.ts is not jest-importable: jsr/URL imports + Deno.env at module
 * scope). Zero-import leaf on purpose — keep it dependency-free so the unit
 * test stays inside the app tsc graph (see __tests__ precedent: nflStats).
 *
 * Background (the bug this guards against): BDL files evening games under the
 * next UTC day, but their rows are stored under the ET *slate* date. When the
 * prior-snapshot query was keyed only by `datesToCheck`, a daytime poll would
 * fetch yesterday-evening finals from BDL, miss their stored rows (slate date
 * not in the window), see `prior = 0`, count every one as "newly final", and
 * re-run the full matview refresh + row rewrites every 30s for the rest of
 * the day (~1,700 refreshes/day; ~30% of all DB time). The fix is twofold:
 * widen the snapshot window to the union of datesToCheck and the returned
 * games' slate dates (collectSnapshotDates), and skip writes whose payload is
 * identical to the stored row (rowChanged).
 */

/** A raw row as returned by PostgREST (numerics may arrive as strings). */
export type DbRow = Record<string, unknown>;

/**
 * Union of the cron date window and the slate dates of the games BDL actually
 * returned. The snapshot query MUST cover every date the upsert can collide
 * with — the upsert keys rows by the game's slate date (`actualGameDate`),
 * which for evening games differs from the UTC-ish dates in `datesToCheck`.
 * Keying stays (player_id, game_date) everywhere; only the window widens.
 *
 * `slateDateOf` is injected (it's `bdlGameSlateDate`) so this module stays a
 * zero-import leaf; `fallbackDate` mirrors the `?? gameDate` fallback used
 * when a game's date is unparseable.
 */
export function collectSnapshotDates(
  datesToCheck: string[],
  gameDates: Array<string | null | undefined>,
  slateDateOf: (input: string | null | undefined) => string | null,
  fallbackDate: string,
): string[] {
  const dates = new Set<string>(datesToCheck);
  for (const d of gameDates) {
    dates.add(slateDateOf(d) ?? fallbackDate);
  }
  return [...dates];
}

/**
 * Fold the prior-snapshot rows into max-prior-status per game_id. A game is
 * "newly final" this poll iff its current status is 3 and this map says the
 * best status we had before was < 3.
 */
export function buildPrevGameStatusByGameId(rows: DbRow[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const r of rows) {
    const gid = String(r.game_id ?? "");
    if (!gid) continue;
    const status = Number(r.game_status ?? 0);
    const prior = map.get(gid) ?? 0;
    if (status > prior) map.set(gid, status);
  }
  return map;
}

/**
 * Normalize a cell for comparison across the PostgREST read/write boundary.
 * Defensive: PostgREST returns JSON numbers for numeric columns, but some
 * drivers/serializations return them as strings ("23") — normVal tolerates
 * both so a representation change can only cost skip efficiency, never
 * correctness. null and undefined compare equal (an unset payload key and a
 * NULL column are the same cell).
 */
const NUMERIC_STRING = /^-?\d+(\.\d+)?$/;
function normVal(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" && NUMERIC_STRING.test(v)) return Number(v);
  return v;
}

/**
 * True when the write payload differs from the stored row on any compared
 * column — i.e. the upsert would actually change something.
 *
 * Compares every key of `next` (the payload) except `ignoreKeys`. Fails OPEN:
 * no stored row, or a payload column missing from the snapshot select (reads
 * as undefined ≠ value), both report "changed" and the row gets written — a
 * select-list gap degrades skip efficiency, never correctness.
 */
export function rowChanged(
  prev: DbRow | undefined,
  next: DbRow,
  ignoreKeys: ReadonlySet<string>,
): boolean {
  if (!prev) return true;
  for (const key of Object.keys(next)) {
    if (ignoreKeys.has(key)) continue;
    if (normVal(prev[key]) !== normVal(next[key])) return true;
  }
  return false;
}

/**
 * live_player_stats comparison ignores:
 * - updated_at: stamped fresh on every payload; nothing anywhere reads it
 * - player_id + game_date: the upsert conflict key — equal by map lookup
 * - sport: constant per invocation and part of the query filter
 * game_id IS compared: a same-slate doubleheader re-points the row.
 */
export const LIVE_ROW_IGNORE: ReadonlySet<string> = new Set([
  "updated_at",
  "player_id",
  "game_date",
  "sport",
]);

/**
 * player_games comparison ignores the conflict key (player_id, game_id) and
 * sport; game_date IS compared (a re-filed game must correct the stored row).
 */
export const GAME_ROW_IGNORE: ReadonlySet<string> = new Set([
  "player_id",
  "game_id",
  "sport",
]);

/**
 * The player_games write predicate, shared by the NFL-skill, NFL-D/ST, and
 * basketball loops (it was previously duplicated at all three sites).
 * Final + not postseason + inside the regular-season window. The end_date
 * term exists because BDL doesn't flag play-in games as postseason; a null
 * regularSeasonEnd falls back to the postseason flag alone.
 */
export function shouldWritePlayerGame(
  gameStatus: number,
  postseason: boolean,
  actualGameDate: string,
  regularSeasonEnd: string | null,
): boolean {
  return (
    gameStatus === 3 &&
    !postseason &&
    (!regularSeasonEnd || actualGameDate <= regularSeasonEnd)
  );
}
