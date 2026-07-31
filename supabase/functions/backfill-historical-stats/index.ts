/**
 * Backfill `player_historical_stats` for a sport+season.
 *
 * Data sources by sport — different because BDL paywalls WNBA stats:
 *   NBA  → BDL /v1/season_averages         (ALL-STAR tier — what we have)
 *   WNBA → stats.wnba.com playercareerstats (free, browser-impersonated;
 *          BDL only exposes per-game/season WNBA stats on GOAT tier $40/mo)
 *   NFL  → BDL /nfl/v1/season_stats        (ALL-STAR tier). Regular-season
 *          rows only. Writes the total_* NFL columns; kicker XP totals stay
 *          null (season_stats has no extra-points field) and D/ST units are
 *          skipped (no season_stats for synthetic defenses).
 *
 * stats.wnba.com mirrors stats.nba.com — same `commonallplayers` /
 * `playercareerstats` endpoints with `LeagueID=10`, same browser-spoofed
 * headers our sync-players edge function already uses. We run requests in
 * parallel batches of 10 to fit 291 players inside the 150s edge timeout.
 *
 * Body params (JSON):
 *   { sport: 'nba' | 'wnba' | 'nfl'  required
 *     season: string                  required ('2025' WNBA/NFL, '2024-25' NBA)
 *     offset?: number                 optional, default 0 (slice players)
 *     limit?:  number                 optional, per-sport default }
 *
 * ALL sports page — no single invocation covers a whole player set inside the
 * 150s timeout, and an unranged read would hit PostgREST's 1000-row max_rows
 * silently. Caller invokes with offset=0 and follows `next_offset` until
 * `done` is true. Re-running is idempotent (UPSERT on player_id,season).
 *
 * Auth: CRON_SECRET (Bearer).
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bdlFetch, type Sport } from "../_shared/bdl.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { handleError, jsonResponse, errorResponse } from "../_shared/http.ts";
import { parseBody, z } from "../_shared/validate.ts";
import type { Database } from "../../../types/database.types.ts";

const Body = z.object({
  sport: z.enum(['nba', 'wnba', 'nfl']),
  season: z.string().min(1, "season required (e.g. '2025' WNBA/NFL, '2024-25' NBA)"),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

const supabase = createClient<Database>(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const ID_CHUNK = 25; // BDL /nfl/v1/season_stats player_ids[] chunk size
// BDL retired the `player_ids[]` array on /v1/season_averages — it now answers
// `player_id must be a single integer` (400), and the batch replacement
// (/season_averages/general) is gated above our tier (401). So NBA is one
// request per player.
// Measured 2026-07-31: the NBA key returns `x-ratelimit-limit: 60`, i.e. 60
// req/min — NOT the 600/min GOAT tier previously assumed. A 10-wide pool burned
// the whole minute's budget in seconds and 140 of 200 players came back 429
// (fetchWithRetry gives up after 3 tries / 3s backoff, nowhere near a 60s
// window). So NBA paces sequentially like the NFL path below.
// Paced by request START interval, not by sleeping a flat gap after each call:
// the rate limit counts requests per minute, so the ~300ms the request itself
// takes is part of the budget, not extra. 1050ms keeps us just under 60/min.
const NBA_REQUEST_INTERVAL_MS = 1050;
// Hard stop well inside the 150s worker timeout. The loop returns what it
// finished and reports how far it got, so the caller's next_offset resumes
// exactly there — page size stops being a number that has to be tuned against
// upstream latency (a flat 1.1s gap ignoring latency ran ~140s and got killed
// mid-run, losing the whole page's work since the upsert is at the end).
const NBA_DEADLINE_MS = 110_000;
const NBA_DEFAULT_LIMIT = 200;
const WNBA_CONCURRENCY = 8;
const WNBA_DEFAULT_LIMIT = 20;
// NFL is 60 req/min, same as NBA (measured — see NBA_REQUEST_SPACING_MS), so NFL
// chunks are spaced ~1.1s apart and the player set is paged per invocation
// (offset/limit, same mechanism as WNBA). 200 players = 8 BDL calls ≈ 10s.
const NFL_DEFAULT_LIMIT = 200;
const NFL_CHUNK_SPACING_MS = 1100;

type Row = Database["public"]["Tables"]["player_historical_stats"]["Insert"];
type PlayerMeta = { uuid: string; pro_team: string | null; nba_id: string | null };

/**
 * Season shooting rate as a 0-1 fraction, for the fg_pct/fg3_pct/ft_pct
 * columns. These exist because avg_* is stored as numeric(5,1): a 0.55-on-0.64
 * FT line rounds to 0.6/0.6 and divides out to 100% (see the migration).
 *
 * Prefers the source's own rate field, falling back to the UNROUNDED per-game
 * makes/attempts we were handed (the damage happens on write, not here).
 * Null when the player never attempted, so the client renders "—", not 0.0% —
 * which also matters because both sources report a 0 rate for 0 attempts.
 * The 0-1 bound guards the numeric(4,3) column against a source that ever
 * switches to 0-100; we'd fall back rather than overflow the upsert.
 */
function rate(sourcePct: unknown, avgMade: number, avgAtt: number): number | null {
  if (!(avgAtt > 0)) return null;
  const p = Number(sourcePct);
  if (Number.isFinite(p) && p >= 0 && p <= 1) return p;
  return avgMade / avgAtt;
}

/** BDL reports minutes as "32:12" on season_averages, plain minutes elsewhere. */
function parseMin(m: unknown): number {
  if (typeof m === "number") return m;
  if (typeof m !== "string" || !m) return 0;
  if (m.includes(":")) {
    const [mm, ss] = m.split(":");
    return parseInt(mm, 10) + (parseInt(ss, 10) || 0) / 60;
  }
  return parseFloat(m) || 0;
}

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
  const avgFgm = get("FGM"), avgFga = get("FGA");
  const avg3pm = get("FG3M"), avg3pa = get("FG3A");
  const avgFtm = get("FTM"), avgFta = get("FTA");

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
    avg_fgm: avgFgm,
    avg_fga: avgFga,
    avg_3pm: avg3pm,
    avg_3pa: avg3pa,
    avg_ftm: avgFtm,
    avg_fta: avgFta,
    avg_pf:  get("PF"),
    fg_pct:  rate(row[idx("FG_PCT")],  avgFgm, avgFga),
    fg3_pct: rate(row[idx("FG3_PCT")], avg3pm, avg3pa),
    ft_pct:  rate(row[idx("FT_PCT")],  avgFtm, avgFta),
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
): Promise<{
  rows: Row[]; matched: number; missing: number; errors: number;
  errorSamples: string[]; consumed: number;
}> {
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
  let errors = 0;
  let consumed = 0;
  const errorSamples: string[] = [];

  const startedAt = Date.now();
  let nextSlot = startedAt;

  for (let i = 0; i < ids.length; i++) {
    if (Date.now() - startedAt > NBA_DEADLINE_MS) break;

    const waitMs = nextSlot - Date.now();
    if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
    nextSlot = Date.now() + NBA_REQUEST_INTERVAL_MS;
    consumed++;

    let s: any;
    try {
      const data = await bdlFetch(
        "nba",
        `/season_averages?season=${seasonYear}&player_id=${ids[i]}`,
      ) as { data?: any[] };
      s = data?.data?.[0] ?? null;
    } catch (err) {
      errors++;
      if (errorSamples.length < 3) errorSamples.push(String((err as Error)?.message ?? err));
      continue;
    }

    if (!s) continue;
    const meta = idToMeta.get(Number(s.player_id));
    if (!meta) continue;
    const gp = Number(s.games_played ?? 0);
    if (!gp) continue;

    const avgPts = Number(s.pts ?? 0);
    const avgReb = Number(s.reb ?? 0);
    const avgAst = Number(s.ast ?? 0);
    const avgStl = Number(s.stl ?? 0);
    const avgBlk = Number(s.blk ?? 0);
    const avgTov = Number(s.turnover ?? 0);
    const avgFgm = Number(s.fgm ?? 0), avgFga = Number(s.fga ?? 0);
    const avg3pm = Number(s.fg3m ?? 0), avg3pa = Number(s.fg3a ?? 0);
    const avgFtm = Number(s.ftm ?? 0), avgFta = Number(s.fta ?? 0);

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
      avg_fgm: avgFgm,
      avg_fga: avgFga,
      avg_3pm: avg3pm,
      avg_3pa: avg3pa,
      avg_ftm: avgFtm,
      avg_fta: avgFta,
      avg_pf:  Number(s.pf   ?? 0),
      fg_pct:  rate(s.fg_pct,  avgFgm, avgFga),
      fg3_pct: rate(s.fg3_pct, avg3pm, avg3pa),
      ft_pct:  rate(s.ft_pct,  avgFtm, avgFta),
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
  return { rows, matched, missing: consumed - matched - errors, errors, errorSamples, consumed };
}

async function backfillNfl(
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
  const toInt = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : 0;
  };

  const rows: Row[] = [];
  let matched = 0;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    if (i > 0) await new Promise((r) => setTimeout(r, NFL_CHUNK_SPACING_MS));
    const chunk = ids.slice(i, i + ID_CHUNK);
    const qs = new URLSearchParams();
    qs.set("season", String(seasonYear));
    qs.set("postseason", "false");
    for (const id of chunk) qs.append("player_ids[]", String(id));
    const data = await bdlFetch("nfl", `/season_stats?${qs.toString()}`) as { data?: any[] };
    for (const s of data?.data ?? []) {
      if (s.postseason) continue; // defensive — regular season only
      const meta = idToMeta.get(Number(s.player?.id));
      if (!meta) continue;
      const gp = Number(s.games_played ?? 0);
      if (!gp) continue;

      rows.push({
        player_id: meta.uuid,
        season,
        sport: "nfl",
        games_played: gp,
        total_pass_att: toInt(s.passing_attempts),
        total_pass_cmp: toInt(s.passing_completions),
        total_pass_yd: toInt(s.passing_yards),
        total_pass_td: toInt(s.passing_touchdowns),
        total_pass_int: toInt(s.passing_interceptions),
        total_rush_att: toInt(s.rushing_attempts),
        total_rush_yd: toInt(s.rushing_yards),
        total_rush_td: toInt(s.rushing_touchdowns),
        total_rec: toInt(s.receptions),
        total_targets: toInt(s.receiving_targets),
        total_rec_yd: toInt(s.receiving_yards),
        total_rec_td: toInt(s.receiving_touchdowns),
        // season_stats splits fumbles by phase; QB strip-sacks land under
        // rushing_fumbles_lost.
        total_fum_lost: toInt(s.rushing_fumbles_lost) + toInt(s.receiving_fumbles_lost),
        total_ret_td: toInt(s.kick_return_touchdowns) + toInt(s.punt_return_touchdowns),
        total_fg_made: toInt(s.field_goals_made),
        total_fg_att: toInt(s.field_goal_attempts),
        // total_xp_made intentionally omitted — no XP field in season_stats.
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
    const parsed = parseBody(Body, await req.json());
    const sport: Sport = parsed.sport;
    const season: string = parsed.season;
    const offset = parsed.offset ?? 0;
    const limit = parsed.limit ??
      (sport === "nfl" ? NFL_DEFAULT_LIMIT : sport === "nba" ? NBA_DEFAULT_LIMIT : WNBA_DEFAULT_LIMIT);

    const seasonYear = parseInt(season.split("-")[0], 10);
    if (!seasonYear) {
      return errorResponse(`Invalid season: ${season}`, 400);
    }

    const idColumn = sport === "wnba" ? "external_id_nba" : "external_id_bdl";

    // Stable ordering across paginated invocations. Every sport pages now —
    // NBA joined when BDL forced it to one request per player, and an unranged
    // read would silently stop at PostgREST's 1000-row max_rows anyway.
    const { data: players, error: playersErr } = await supabase
      .from("players")
      .select(`id, external_id_nba, external_id_bdl, pro_team`)
      .eq("sport", sport)
      .not(idColumn, "is", null)
      .order("id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (playersErr) {
      throw playersErr;
    }
    if (!players || players.length === 0) {
      return jsonResponse({ ok: true, sport, season, players: 0, upserted: 0, done: true });
    }

    const result = sport === "wnba"
      ? await backfillWnba(players, season)
      : sport === "nfl"
        ? { ...await backfillNfl(players, season, seasonYear), errorSamples: [] as string[] }
        : await backfillNba(players, season, seasonYear);

    // Non-NBA paths always walk their whole page; only NBA can stop early.
    const consumed = "consumed" in result ? (result as { consumed: number }).consumed : players.length;
    const more = consumed < players.length || players.length === limit;

    let upserted = 0;
    const BATCH = 500;
    for (let i = 0; i < result.rows.length; i += BATCH) {
      const chunk = result.rows.slice(i, i + BATCH);
      // sport-scope: payload rows carry sport; conflict key is player-scoped
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
      limit,
      processed: players.length,
      matched: result.matched,
      missing_season: result.missing,
      errors: result.errors,
      error_samples: result.errorSamples,
      upserted,
      // Every sport pages: keep re-invoking with next_offset until done.
      // `consumed` < the page when NBA's deadline guard cut the run short, so
      // resume from there rather than from offset+limit — otherwise the
      // untouched tail of the page is skipped silently.
      consumed,
      next_offset: more ? offset + consumed : null,
      done: !more,
    });
  } catch (error) {
    return handleError(error, 'backfill-historical-stats');
  }
});
