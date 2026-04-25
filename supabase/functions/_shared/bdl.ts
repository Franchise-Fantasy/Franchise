/**
 * Shared balldontlie API helper for edge functions.
 *
 * All BDL requests go through these helpers so auth, error handling,
 * pagination, and sport-namespacing are handled in one place.
 *
 * BDL exposes NBA at `/v1` and WNBA at `/wnba/v1` with the same auth and
 * response shapes — callers pass `sport` and we route accordingly.
 */

export type Sport = "nba" | "wnba";

const BDL_HOST = "https://api.balldontlie.io";
const BDL_API_KEY = Deno.env.get("BDL_API_KEY") ?? "";

function bdlPrefix(sport: Sport): string {
  return sport === "wnba" ? "/wnba/v1" : "/v1";
}

/** Single BDL request with API key auth, scoped to the given sport. */
export async function bdlFetch(
  sport: Sport,
  path: string,
  params?: Record<string, string>,
): Promise<any> {
  const url = new URL(`${BDL_HOST}${bdlPrefix(sport)}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.append(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { Authorization: BDL_API_KEY },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(
      `BDL ${sport}${path} returned ${res.status}: ${text.slice(0, 200)}`,
    );
  }

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
 * Map BDL game status string to numeric game_status used in the DB.
 * 1 = scheduled, 2 = live, 3 = final.
 *
 * NBA reports "Q1"/"Q3"/"OT". WNBA reports the same. Halftime appears as "Half"
 * in both feeds. The regex covers both.
 */
export function mapGameStatus(status: string): number {
  if (status === "Final") return 3;
  if (/Qtr|Half|OT|Q\d/i.test(status)) return 2;
  return 1;
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
 * Coerce BDL position strings to the app's PG/SG/SF/PF/C spectrum.
 *
 * NBA BDL uses granular ("PG", "SG", "G-F" etc.) and matches the app spectrum.
 * WNBA BDL also reports granular positions for most players, but some entries
 * are just "G", "F", or "G-F". We map ambiguous tokens to the closest spectrum
 * point so eligibility logic in `utils/rosterSlots.ts` keeps working.
 */
export function coerceBdlPosition(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return null;

  const map: Record<string, string> = {
    "G": "SG",
    "F": "SF",
    "G-F": "SG-SF",
    "F-G": "SG-SF",
    "F-C": "PF-C",
    "C-F": "PF-C",
  };

  return map[trimmed] ?? trimmed;
}
