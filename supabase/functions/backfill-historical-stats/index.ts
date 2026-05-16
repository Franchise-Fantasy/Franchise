/**
 * Backfill `player_historical_stats` for a sport+season.
 *
 * Data sources by sport — different because BDL paywalls WNBA stats:
 *   NBA  → BDL /v1/season_averages         (ALL-STAR tier — what we have)
 *   WNBA → stats.wnba.com playercareerstats (free, browser-impersonated;
 *          BDL only exposes per-game/season WNBA stats on GOAT tier $40/mo)
 *
 * stats.wnba.com mirrors stats.nba.com — same `commonallplayers` /
 * `playercareerstats` endpoints with `LeagueID=10`, same browser-spoofed
 * headers our sync-players edge function already uses. We run requests in
 * parallel batches of 10 to fit 291 players inside the 150s edge timeout.
 *
 * Body params (JSON):
 *   { sport: 'nba' | 'wnba'    required
 *     season: string            required ('2025' for WNBA, '2024-25' for NBA)
 *     offset?: number           optional, default 0 (WNBA only — slice players)
 *     limit?:  number           optional, default 60 (WNBA only — slice size) }
 *
 * For WNBA, 291 sequential stats.wnba.com calls won't fit in one invocation
 * (worker resource limit). Caller must page: invoke with offset=0, then 60,
 * 120, etc., until response.processed < limit.
 *
 * Auth: CRON_SECRET (Bearer).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bdlFetch, type Sport } from "../_shared/bdl.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { handleError, jsonResponse, errorResponse } from "../_shared/http.ts";
import type { Database } from "../../../types/database.types.ts";

const supabase = createClient<Database>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const ID_CHUNK = 25; // BDL season_averages player_ids[] chunk size
const WNBA_CONCURRENCY = 8;
const WNBA_DEFAULT_LIMIT = 20;

type Row = Database["public"]["Tables"]["player_historical_stats"]["Insert"];
type PlayerMeta = { uuid: string; pro_team: string | null; nba_id: string | null };

const WNBA_HEADERS: Record<string, string> = {
  "Accept": "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Origin": "https://www.wnba.com",
  "Referer": "https://www.wnba.com/",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
};

/** Hit stats.wnba.com playercareerstats for one player. */
async function fetchWnbaCareer(playerId: string): Promise<any> {
  const url = `https://stats.wnba.com/stats/playercareerstats?PlayerID=${playerId}&PerMode=PerGame&LeagueID=10`;
  const res = await fetch(url, {
    headers: WNBA_HEADERS,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`stats.wnba.com ${res.status} for player ${playerId}`);
  return await res.json();
}

/**
 * Pick the row matching `season` from a SeasonTotalsRegularSeason resultSet.
 * WNBA SEASON_ID is "2025"; older entries occasionally use "2024-25" — match
 * either form via prefix.
 */
function pickSeasonRow(careerJson: any, season: string): { row: any[]; idx: (k: string) => number } | null {
  const rs = careerJson?.resultSets?.[0];
  const headers: string[] = rs?.headers ?? [];
  const rows: any[][] = rs?.rowSet ?? [];
  const idx = (k: string) => headers.indexOf(k);
  const seasonIdIdx = idx("SEASON_ID");
  if (seasonIdIdx < 0) return null;
  const match = rows.find((r) => {
    const s = String(r[seasonIdIdx] ?? "");
    return s === season || s.startsWith(season);
  });
  return match ? { row: match, idx } : null;
}

function rowFromWnbaCareer(
  careerJson: any,
  meta: PlayerMeta,
  season: string,
): Row | null {
  const picked = pickSeasonRow(careerJson, season);
  if (!picked) return null;
  const { row, idx } = picked;
  const gp = Number(row[idx("GP")] ?? 0);
  if (!gp) return null;

  const get = (k: string): number => Number(row[idx(k)] ?? 0);
  const avgPts = get("PTS");
  const avgReb = get("REB");
  const avgAst = get("AST");
  const avgStl = get("STL");
  const avgBlk = get("BLK");
  const avgTov = get("TOV");

  return {
    player_id: meta.uuid,
    season,
    sport: "wnba",
    games_played: gp,
    avg_min: get("MIN"),
    avg_pts: avgPts,
    avg_reb: avgReb,
    avg_ast: avgAst,
    avg_stl: avgStl,
    avg_blk: avgBlk,
    avg_tov: avgTov,
    avg_fgm: get("FGM"),
    avg_fga: get("FGA"),
    avg_3pm: get("FG3M"),
    avg_3pa: get("FG3A"),
    avg_ftm: get("FTM"),
    avg_fta: get("FTA"),
    avg_pf:  get("PF"),
    total_pts: Math.round(avgPts * gp),
    total_reb: Math.round(avgReb * gp),
    total_ast: Math.round(avgAst * gp),
    total_stl: Math.round(avgStl * gp),
    total_blk: Math.round(avgBlk * gp),
    total_tov: Math.round(avgTov * gp),
    pro_team: String(row[idx("TEAM_ABBREVIATION")] ?? meta.pro_team ?? ""),
  };
}

async function backfillWnba(
  players: { id: string; external_id_nba: string | null; pro_team: string | null }[],
  season: string,
): Promise<{ rows: Row[]; matched: number; missing: number; errors: number; errorSamples: string[] }> {
  const rows: Row[] = [];
  let matched = 0, missing = 0, errors = 0;
  const errorSamples: string[] = [];

  for (let i = 0; i < players.length; i += WNBA_CONCURRENCY) {
    const batch = players.slice(i, i + WNBA_CONCURRENCY);
    const results = await Promise.allSettled(
      batch.map(async (p) => {
        if (!p.external_id_nba) return { player: p, row: null as Row | null, missing: true };
        const career = await fetchWnbaCareer(p.external_id_nba);
        const row = rowFromWnbaCareer(
          career,
          { uuid: p.id, pro_team: p.pro_team, nba_id: p.external_id_nba },
          season,
        );
        return { player: p, row, missing: false };
      }),
    );
    for (const r of results) {
      if (r.status === "rejected") {
        errors++;
        if (errorSamples.length < 3) {
          errorSamples.push(String(r.reason?.message ?? r.reason));
        }
        continue;
      }
      if (r.value.row) { rows.push(r.value.row); matched++; }
      else { missing++; }
    }
  }

  return { rows, matched, missing, errors, errorSamples };
}

async function backfillNba(
  players: { id: string; external_id_bdl: number | null; pro_team: string | null }[],
  season: string,
  seasonYear: number,
): Promise<{ rows: Row[]; matched: number; missing: number; errors: number }> {
  const idToMeta = new Map<number, PlayerMeta>();
  for (const p of players) {
    if (p.external_id_bdl != null) {
      idToMeta.set(Number(p.external_id_bdl), {
        uuid: p.id, pro_team: p.pro_team, nba_id: null,
      });
    }
  }
  const ids = [...idToMeta.keys()];

  const rows: Row[] = [];
  let matched = 0;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    const qs = new URLSearchParams();
    qs.set("season", String(seasonYear));
    for (const id of chunk) qs.append("player_ids[]", String(id));
    const data = await bdlFetch("nba", `/season_averages?${qs.toString()}`) as { data?: any[] };
    for (const s of data?.data ?? []) {
      const meta = idToMeta.get(Number(s.player_id));
      if (!meta) continue;
      const gp = Number(s.games_played ?? 0);
      if (!gp) continue;

      const parseMin = (m: unknown): number => {
        if (typeof m === "number") return m;
        if (typeof m !== "string" || !m) return 0;
        if (m.includes(":")) {
          const [mm, ss] = m.split(":");
          return parseInt(mm, 10) + (parseInt(ss, 10) || 0) / 60;
        }
        return parseFloat(m) || 0;
      };
      const avgPts = Number(s.pts ?? 0);
      const avgReb = Number(s.reb ?? 0);
      const avgAst = Number(s.ast ?? 0);
      const avgStl = Number(s.stl ?? 0);
      const avgBlk = Number(s.blk ?? 0);
      const avgTov = Number(s.turnover ?? 0);

      rows.push({
        player_id: meta.uuid,
        season,
        sport: "nba",
        games_played: gp,
        avg_min: parseMin(s.min),
        avg_pts: avgPts,
        avg_reb: avgReb,
        avg_ast: avgAst,
        avg_stl: avgStl,
        avg_blk: avgBlk,
        avg_tov: avgTov,
        avg_fgm: Number(s.fgm  ?? 0),
        avg_fga: Number(s.fga  ?? 0),
        avg_3pm: Number(s.fg3m ?? 0),
        avg_3pa: Number(s.fg3a ?? 0),
        avg_ftm: Number(s.ftm  ?? 0),
        avg_fta: Number(s.fta  ?? 0),
        avg_pf:  Number(s.pf   ?? 0),
        total_pts: Math.round(avgPts * gp),
        total_reb: Math.round(avgReb * gp),
        total_ast: Math.round(avgAst * gp),
        total_stl: Math.round(avgStl * gp),
        total_blk: Math.round(avgBlk * gp),
        total_tov: Math.round(avgTov * gp),
        pro_team: meta.pro_team,
      });
      matched++;
    }
  }
  return { rows, matched, missing: ids.length - matched, errors: 0 };
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

  try {
    let sport: Sport;
    let season: string;
    let offset = 0;
    let limit = WNBA_DEFAULT_LIMIT;
    try {
      const body = await req.json();
      if (body?.sport !== "nba" && body?.sport !== "wnba") {
        return errorResponse("sport must be 'nba' or 'wnba'", 400);
      }
      if (typeof body?.season !== "string" || !body.season) {
        return errorResponse("season required (e.g. '2025' WNBA, '2024-25' NBA)", 400);
      }
      sport = body.sport;
      season = body.season;
      if (typeof body?.offset === "number") offset = Math.max(0, body.offset);
      if (typeof body?.limit === "number") limit = Math.max(1, Math.min(200, body.limit));
    } catch {
      return errorResponse("JSON body required: { sport, season }", 400);
    }

    const seasonYear = parseInt(season.split("-")[0], 10);
    if (!seasonYear) {
      return errorResponse(`Invalid season: ${season}`, 400);
    }

    const idColumn = sport === "wnba" ? "external_id_nba" : "external_id_bdl";

    // Stable ordering across paginated WNBA invocations.
    let query = supabase
      .from("players")
      .select(`id, external_id_nba, external_id_bdl, pro_team`)
      .eq("sport", sport)
      .not(idColumn, "is", null)
      .order("id", { ascending: true });

    if (sport === "wnba") {
      query = query.range(offset, offset + limit - 1);
    }

    const { data: players, error: playersErr } = await query;

    if (playersErr) {
      throw playersErr;
    }
    if (!players || players.length === 0) {
      return jsonResponse({ ok: true, sport, season, players: 0, upserted: 0, done: true });
    }

    const result = sport === "wnba"
      ? await backfillWnba(players, season)
      : { ...await backfillNba(players, season, seasonYear), errorSamples: [] as string[] };

    let upserted = 0;
    const BATCH = 500;
    for (let i = 0; i < result.rows.length; i += BATCH) {
      const chunk = result.rows.slice(i, i + BATCH);
      const { error } = await supabase
        .from("player_historical_stats")
        .upsert(chunk, { onConflict: "player_id,season" });
      if (error) {
        return jsonResponse({ error: error.message, upserted }, 500);
      }
      upserted += chunk.length;
    }

    return jsonResponse({
      ok: true,
      sport,
      season,
      offset,
      limit: sport === "wnba" ? limit : null,
      processed: players.length,
      matched: result.matched,
      missing_season: result.missing,
      errors: result.errors,
      error_samples: result.errorSamples,
      upserted,
      // For WNBA: caller should keep paging while processed === limit.
      next_offset: sport === "wnba" && players.length === limit ? offset + limit : null,
      done: sport !== "wnba" || players.length < limit,
    });
  } catch (error) {
    return handleError(error, 'backfill-historical-stats');
  }
});
