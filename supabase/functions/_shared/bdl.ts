/**
 * Shared balldontlie API helper for edge functions.
 *
 * All BDL requests go through these helpers so auth, error handling,
 * and pagination are handled in one place.
 */

const BDL_BASE = "https://api.balldontlie.io/v1";
const BDL_API_KEY = Deno.env.get("BDL_API_KEY") ?? "";

/** Single BDL request with API key auth. */
export async function bdlFetch(
  path: string,
  params?: Record<string, string>,
): Promise<any> {
  const url = new URL(`${BDL_BASE}${path}`);
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
    throw new Error(`BDL ${path} returned ${res.status}: ${text.slice(0, 200)}`);
  }

  return res.json();
}

/** Paginate through all results using BDL cursor-based pagination.
 *  Safety cap prevents runaway pagination from a misbehaving endpoint. */
export async function bdlFetchAll(
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

    const data = await bdlFetch(path, p);
    all.push(...(data.data ?? []));
    cursor = data.meta?.next_cursor?.toString();
    pages++;

    if (pages >= maxPages) {
      console.warn(`bdlFetchAll: hit ${maxPages}-page safety cap for ${path}`);
      break;
    }
  } while (cursor);

  return all;
}

/**
 * Map BDL game status string to numeric game_status used in the DB.
 * 1 = scheduled, 2 = live, 3 = final.
 */
export function mapGameStatus(status: string): number {
  if (status === "Final") return 3;
  if (/Qtr|Half|OT/i.test(status)) return 2;
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
