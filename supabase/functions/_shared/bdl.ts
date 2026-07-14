/**
 * Shared balldontlie API helper for edge functions.
 *
 * All BDL requests go through these helpers so auth, error handling,
 * pagination, sport-namespacing, AND retry/backoff are handled in one
 * place. Transient 5xx/429s recover within the same cron tick instead
 * of skipping the whole cycle.
 *
 * BDL exposes NBA at `/v1`, WNBA at `/wnba/v1`, and NFL at `/nfl/v1` with the
 * same auth and envelope shapes — callers pass `sport` and we route
 * accordingly.
 *
 * NFL quirks (verified 2026-07-10 / 2026-07-13, see wiki "NFL Support"):
 *   - `start_date`/`end_date` params are silently IGNORED on /nfl/v1/games;
 *     filter by `seasons[]`, `weeks[]`, `dates[]`, `postseason` instead.
 *   - No preseason data; postseason games restart `week` numbering at 1.
 *   - Score fields use NBA-style names (home_team_score/visitor_team_score).
 *   - Overtime finals read "Final/OT", not "Final" (see mapGameStatus).
 *   - The players feed has NO draft_year — `experience` ("10th Season") stands
 *     in for it (see utils/sports/nflExperience.ts).
 */

import { fetchWithRetry } from './retry.ts';

export type Sport = "nba" | "wnba" | "nfl";

const BDL_HOST = "https://api.balldontlie.io";
const BDL_API_KEY = Deno.env.get("BDL_API_KEY") ?? "";

function bdlPrefix(sport: Sport): string {
  if (sport === "wnba") return "/wnba/v1";
  if (sport === "nfl") return "/nfl/v1";
  return "/v1";
}

/**
 * Per-sport path renames. BDL's WNBA API uses `/player_stats` where the NBA
 * API uses `/stats` — same response shape, different route. Callers pass the
 * NBA-style path and we translate for WNBA so call sites stay sport-agnostic.
 */
function resolvePath(sport: Sport, path: string): string {
  if (sport === "wnba") {
    if (path === "/stats" || path.startsWith("/stats?")) {
      return "/player_stats" + path.slice("/stats".length);
    }
  }
  return path;
}

/** Single BDL request with API key auth, scoped to the given sport. */
export async function bdlFetch(
  sport: Sport,
  path: string,
  params?: Record<string, string | string[]>,
): Promise<any> {
  const url = new URL(`${BDL_HOST}${bdlPrefix(sport)}${resolvePath(sport, path)}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) {
        for (const item of v) url.searchParams.append(k, item);
      } else {
        url.searchParams.append(k, v);
      }
    }
  }

  // fetchWithRetry throws on non-2xx after exhausting retries; treat the
  // thrown error as the final outcome.
  const res = await fetchWithRetry(
    url.toString(),
    { headers: { Authorization: BDL_API_KEY } },
    { attempts: 3, baseMs: 250, maxMs: 2000 },
  );

  return res.json();
}

/** Paginate through all results using BDL cursor-based pagination.
 *  Safety cap prevents runaway pagination from a misbehaving endpoint. */
export async function bdlFetchAll(
  sport: Sport,
  path: string,
  params?: Record<string, string>,
  maxPages = 50,
): Promise<any[]> {
  const all: any[] = [];
  let cursor: string | undefined;
  let pages = 0;

  do {
    const p: Record<string, string> = { ...params, per_page: "100" };
    if (cursor) p.cursor = cursor;

    const data = await bdlFetch(sport, path, p);
    all.push(...(data.data ?? []));
    cursor = data.meta?.next_cursor?.toString();
    pages++;

    if (pages >= maxPages) {
      console.warn(
        `bdlFetchAll: hit ${maxPages}-page safety cap for ${sport}${path}`,
      );
      break;
    }
  } while (cursor);

  return all;
}

/**
 * Map BDL game status string to the numeric game_status used in the DB
 * (1 = scheduled, 2 = live, 3 = final).
 *
 * The logic is pure and lives in utils/sports/gameStatus.ts so the client test
 * runner can cover it — this module reads `Deno.env` at import time and can't be
 * loaded from jest. Re-exported here so edge call sites keep importing from
 * `_shared/bdl.ts`.
 */
export { mapGameStatus } from '../../../utils/sports/gameStatus.ts';

/**
 * Convert a BDL game's UTC date/datetime to the ET "slate date" it belongs to.
 * Slate date = ET calendar date, except tipoffs before 5am ET are bucketed
 * back to the previous day so a 10pm ET tipoff (= 02:00 UTC next day) still
 * groups with the previous night's slate. Returns null if input is missing or
 * unparseable.
 *
 * If the input has no time component (e.g. NBA's `date: "YYYY-MM-DD"`), the
 * date is returned as-is — BDL's plain date already matches the schedule day.
 */
export function bdlGameSlateDate(input: string | null | undefined): string | null {
  if (!input) return null;
  if (input.length <= 10) return input.slice(0, 10);
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const y = parts.find(p => p.type === "year")?.value;
  const m = parts.find(p => p.type === "month")?.value;
  const day = parts.find(p => p.type === "day")?.value;
  const hourStr = parts.find(p => p.type === "hour")?.value;
  if (!y || !m || !day || !hourStr) return null;
  if (parseInt(hourStr, 10) < 5) {
    const prev = new Date(`${y}-${m}-${day}T12:00:00Z`);
    prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().slice(0, 10);
  }
  return `${y}-${m}-${day}`;
}

/**
 * Convert BDL clock string to ISO duration format ("PT05M23.00S")
 * used in live_player_stats.game_clock.
 * BDL returns "Q3 6:56", "Q1 :13.7", or "Final" — strip the prefix first.
 */
export function toIsoDuration(time: string): string {
  if (!time || !time.includes(":")) return "";
  // Strip "Q1 ", "Q3 ", etc. prefix
  const clock = time.replace(/^Q\d\s*/, "");
  // Handle ":13.7" (seconds only, no minutes)
  if (clock.startsWith(":")) {
    const secs = Math.floor(parseFloat(clock.slice(1)));
    return `PT00M${String(secs).padStart(2, "0")}.00S`;
  }
  const [mins, rawSecs] = clock.split(":");
  const secs = Math.floor(parseFloat(rawSecs ?? "0"));
  return `PT${mins.padStart(2, "0")}M${String(secs).padStart(2, "0")}.00S`;
}

/**
 * Coerce BDL position strings to a normalized form per sport.
 *
 * NBA: BDL mostly returns granular tokens (PG/SG/SF/PF/C, G-F, F-C, …)
 * that already match the app spectrum. The few bare-letter tokens
 * ("G"/"F") get nudged into the spectrum so Sleeper-spectrum-aware
 * roster logic keeps working — Sleeper enrichment in `sync-players`
 * almost always overrides these anyway.
 *
 * WNBA: BDL returns mostly bare-letter tokens ("G", "F", "C") plus a
 * few hyphenated combos. Pass them through verbatim — WNBA leagues use
 * G/F/C roster slots (no PG/SG/SF/PF), and `getEligiblePositions`
 * expands "G" → PG-SG and "F" → SF-PF so slot eligibility still works.
 * Hyphen direction is normalized so "F-G"/"C-F" don't create duplicate
 * spelling variants alongside "G-F"/"F-C".
 *
 * NFL: BDL's `position_abbreviation` tokens map to the app's disjoint set
 * (QB/RB/WR/TE/K). "PK" → "K"; fullbacks roster as RBs. Returns null for
 * any other token (OL/IDP/UNK) — sync-players drops those players, which
 * is also what keeps BDL's offensive-line "G"/"C" tokens from colliding
 * with the basketball spectrum.
 */
export function coerceBdlPosition(
  raw: string | null | undefined,
  sport: Sport = "nba",
): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;

  if (sport === "nfl") {
    const nflMap: Record<string, string> = {
      QB: "QB",
      RB: "RB",
      FB: "RB",
      WR: "WR",
      TE: "TE",
      PK: "K",
      K: "K",
    };
    return nflMap[trimmed] ?? null;
  }

  if (sport === "wnba") {
    const wnbaMap: Record<string, string> = {
      "F-G": "G-F",
      "C-F": "F-C",
    };
    return wnbaMap[trimmed] ?? trimmed;
  }

  const nbaMap: Record<string, string> = {
    "G": "SG",
    "F": "SF",
    "G-F": "SG-SF",
    "F-G": "SG-SF",
    "F-C": "PF-C",
    "C-F": "PF-C",
  };
  return nbaMap[trimmed] ?? trimmed;
}
