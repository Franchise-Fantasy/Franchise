/**
 * Mirror player headshots into Supabase Storage. Runs daily so new players
 * (rookies, mid-season acquisitions) get their portrait stored without anyone
 * re-running the seed script.
 *
 *  - NBA portraits → cdn.nba.com/headshots/nba/latest/1040x760/{personId}.png
 *  - WNBA portraits → a.espncdn.com/i/headshots/wnba/players/full/{espnId}.png
 *    (ESPN is the only working WNBA portrait source; we touch it once per
 *    new player at sync time and never at app runtime.)
 *
 * Strategy: for each player with `external_id_nba`, check whether the
 * Storage object already exists; if not, fetch from the source CDN and
 * upload. Idempotent — safe to re-run anytime.
 *
 * Body params:
 *   { sport?: 'nba' | 'wnba'   default: process both
 *     force?: boolean          re-upload even if Storage object exists }
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { Image as ImgScript } from "https://deno.land/x/imagescript@1.2.17/mod.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";
import type { Sport } from "../_shared/bdl.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const jsonHeaders = { ...CORS_HEADERS, "Content-Type": "application/json" };

// Match scripts/seed-pro-assets.mjs — headshots are rendered at ≤200px on the
// largest surface, so 256x192 is plenty at retina density and ~10× smaller than
// the source PNG.
const HEADSHOT_W = 256;
const HEADSHOT_H = 192;

const HEADSHOT_SOURCES: Record<Sport, (id: string) => string> = {
  nba:  (id) => `https://cdn.nba.com/headshots/nba/latest/1040x760/${id}.png`,
  wnba: (id) => `https://a.espncdn.com/i/headshots/wnba/players/full/${id}.png`,
};

async function resizeHeadshot(buf: Uint8Array): Promise<Uint8Array> {
  const decoded = await ImgScript.decode(buf);
  const resized = decoded.resize(HEADSHOT_W, HEADSHOT_H);
  return await resized.encode();
}

/**
 * Pulls every existing object name in a given sport's headshot subdir.
 * Storage list() pages 1000 entries; loop until exhausted.
 */
async function listExisting(sport: Sport): Promise<Set<string>> {
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

async function syncSport(sport: Sport, force: boolean): Promise<{
  total: number; uploaded: number; skipped: number; failed: { name: string; id: string; err: string }[];
}> {
  const { data: players, error } = await supabase
    .from("players")
    .select("name, external_id_nba")
    .eq("sport", sport)
    .not("external_id_nba", "is", null);
  if (error) throw new Error(`players query: ${error.message}`);

  const existing = force ? new Set<string>() : await listExisting(sport);
  const sourceUrl = HEADSHOT_SOURCES[sport];
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
        const res = await fetch(sourceUrl(id));
        if (!res.ok) throw new Error(`${res.status} ${sourceUrl(id)}`);
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
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401, headers: jsonHeaders,
    });
  }

  let sportFilter: Sport | null = null;
  let force = false;
  try {
    const body = await req.json();
    if (body?.sport === "nba" || body?.sport === "wnba") sportFilter = body.sport;
    if (body?.force === true) force = true;
  } catch {
    // No body — defaults apply.
  }

  try {
    const sports: Sport[] = sportFilter ? [sportFilter] : ["nba", "wnba"];
    const results: Record<string, unknown> = {};
    for (const s of sports) {
      results[s] = await syncSport(s, force);
    }
    return new Response(
      JSON.stringify({ ok: true, force, results }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err) {
    console.error("sync-headshots error:", (err as Error)?.message ?? err);
    return new Response(
      JSON.stringify({ error: (err as Error)?.message ?? String(err) }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
