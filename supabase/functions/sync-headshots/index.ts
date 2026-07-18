/**
 * Mirror player headshots into Supabase Storage. Runs daily so new players
 * (rookies, mid-season acquisitions) get their portrait stored without anyone
 * re-running the seed script.
 *
 *  - NBA portraits → cdn.nba.com/headshots/nba/latest/1040x760/{personId}.png
 *  - WNBA portraits → a.espncdn.com/i/headshots/wnba/players/full/{espnId}.png
 *    (ESPN is the only working WNBA portrait source; we touch it once per
 *    new player at sync time and never at app runtime.)
 *  - NFL portraits → static.www.nfl.com/image/{upload|private}/…/league/{cloudinaryId}
 *    (the league's own CDN; the opaque cloudinary id is seeded into
 *    external_id_nba by backend/seed_nfl_headshots.py. The id belongs to exactly
 *    one delivery namespace, so we try both and keep the one that resolves.)
 *
 * Strategy: for each player with `external_id_nba`, check whether the
 * Storage object already exists; if not, fetch from the source CDN and
 * upload. Idempotent — safe to re-run anytime.
 *
 * Body params:
 *   { sport?: 'nba' | 'wnba' | 'nfl'   default: process all with a source
 *     force?: boolean                  re-upload even if Storage object exists }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Image as ImgScript } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import type { Sport } from "../_shared/bdl.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { handleError, jsonResponse, errorResponse } from "../_shared/http.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// Match scripts/seed-pro-assets.mjs — headshots are rendered at ≤200px on the
// largest surface, so 256x192 is plenty at retina density and ~10× smaller than
// the source PNG.
const HEADSHOT_W = 256;
const HEADSHOT_H = 192;

// Per-sport portrait source. `urls` yields the candidate CDN URLs tried in order
// until one fetches (NFL ids live in one of two Cloudinary namespaces). `preSized`
// marks a source that already returns the target 256x192 — we then upload its bytes
// as-is and SKIP the imagescript decode/resize/encode, whose CPU cost across a full
// cold-start batch (NFL's ~900 players) trips the edge worker's resource limit.
// HeadshotSport is derived from the map keys, so a sport is supported iff listed.
const HEADSHOT_SOURCES = {
  nba:  { urls: (id: string) => [`https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`] },
  wnba: { urls: (id: string) => [`https://a.espncdn.com/i/headshots/wnba/players/full/${id}.png`] },
  nfl:  {
    preSized: true,
    urls: (id: string) => [
      `https://static.www.nfl.com/image/upload/c_fill,w_${HEADSHOT_W},h_${HEADSHOT_H}/f_png/league/${id}`,
      `https://static.www.nfl.com/image/private/c_fill,w_${HEADSHOT_W},h_${HEADSHOT_H}/f_png/league/${id}`,
    ],
  },
} satisfies Partial<Record<Sport, { urls: (id: string) => string[]; preSized?: boolean }>>;

type HeadshotSport = keyof typeof HEADSHOT_SOURCES;

async function resizeHeadshot(buf: Uint8Array): Promise<Uint8Array> {
  const decoded = await ImgScript.decode(buf);
  const resized = decoded.resize(HEADSHOT_W, HEADSHOT_H);
  return await resized.encode();
}

/**
 * Pulls every existing object name in a given sport's headshot subdir.
 * Storage list() pages 1000 entries; loop until exhausted.
 */
async function listExisting(sport: HeadshotSport): Promise<Set<string>> {
  const seen = new Set<string>();
  let offset = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await supabase.storage
      .from("player-headshots")
      .list(sport, { limit: PAGE, offset });
    if (error) throw new Error(`storage list ${sport}: ${error.message}`);
    for (const o of data ?? []) {
      // Strip extension to get the bare external_id_nba.
      seen.add(o.name.replace(/\.png$/i, ""));
    }
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }
  return seen;
}

async function syncSport(sport: HeadshotSport, force: boolean): Promise<{
  total: number; uploaded: number; skipped: number; failed: { name: string; id: string; err: string }[];
}> {
  const { data: players, error } = await supabase
    .from("players")
    .select("name, external_id_nba")
    .eq("sport", sport)
    .not("external_id_nba", "is", null);
  if (error) throw new Error(`players query: ${error.message}`);

  const existing = force ? new Set<string>() : await listExisting(sport);
  const sourceUrls = HEADSHOT_SOURCES[sport];
  const failed: { name: string; id: string; err: string }[] = [];
  let uploaded = 0;
  let skipped = 0;

  // Modest concurrency — public CDNs but no need to hammer them.
  const CONCURRENCY = 6;
  const queue = (players ?? []).filter((p) => force || !existing.has(String(p.external_id_nba)));
  let cursor = 0;

  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= queue.length) return;
      const p = queue[i];
      const id = String(p.external_id_nba);
      try {
        const urls = sourceUrls(id);
        let res: Response | null = null;
        for (const url of urls) {
          const r = await fetch(url);
          if (r.ok) { res = r; break; }
          await r.body?.cancel();
        }
        if (!res) throw new Error(`no source resolved: ${urls.join(", ")}`);
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength === 0) throw new Error("empty body");
        const resized = await resizeHeadshot(buf);
        const { error: upErr } = await supabase.storage
          .from("player-headshots")
          .upload(`${sport}/${id}.png`, resized, {
            contentType: "image/png",
            upsert: true,
            cacheControl: "31536000",
          });
        if (upErr) throw new Error(upErr.message);
        uploaded++;
      } catch (e) {
        failed.push({ name: p.name, id, err: (e as Error).message });
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  skipped = (players?.length ?? 0) - queue.length;

  return { total: players?.length ?? 0, uploaded, skipped, failed };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse("Unauthorized", 401);
  }

  let sportFilter: HeadshotSport | null = null;
  let force = false;
  try {
    const body = await req.json();
    if (body?.sport && body.sport in HEADSHOT_SOURCES) sportFilter = body.sport as HeadshotSport;
    if (body?.force === true) force = true;
  } catch {
    // No body — defaults apply.
  }

  try {
    const sports = sportFilter
      ? [sportFilter]
      : (Object.keys(HEADSHOT_SOURCES) as HeadshotSport[]);
    const results: Record<string, unknown> = {};
    for (const s of sports) {
      results[s] = await syncSport(s, force);
    }
    await recordHeartbeat(supabase, 'sync-headshots', 'ok');
    return jsonResponse({ ok: true, force, results });
  } catch (err) {
    await recordHeartbeat(supabase, 'sync-headshots', 'error', (err as Error)?.message ?? String(err));
    return handleError(err, 'sync-headshots');
  }
});
