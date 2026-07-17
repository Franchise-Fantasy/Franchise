/**
 * Sync the season schedule into `game_schedule` from BDL.
 *
 * Replaces the python `backend/seed_schedule.py` for both sports — BDL covers
 * both NBA (`/v1/games`) and WNBA (`/wnba/v1/games`) with the same response
 * shape, so a single edge function handles both.
 *
 * Cron-triggered (CRON_SECRET) or manually invokable. Body params:
 *   { sport?: 'nba' | 'wnba' | 'nfl'   default 'nba'
 *     season?: string   NBA: '2025-26', WNBA/NFL: '2026'  (default = current) }
 *
 * Upserts on (sport, game_id) in two homogeneous batches: finals carry
 * status='final' + scores; non-final games OMIT the status/score keys so an
 * upsert never downgrades a 'live'/'final' row written by poll-live-stats
 * (PostgREST only SETs payload keys on conflict; new inserts take the column
 * DEFAULT 'scheduled'). Finality is derived via mapGameStatus — BDL reports
 * WNBA finals as "post" and NFL OT finals as "Final/OT", which the previous
 * exact `=== "Final"` match missed, clobbering whole seasons back to
 * 'scheduled' on every sync (see pure.ts).
 *
 * NFL: regular-season games only (postseason=false — BDL restarts week
 * numbering at 1 in the postseason, and fantasy schedules end at week 18).
 * The NFL week number is stored in game_schedule.week (drives bye detection).
 * Do NOT add start_date/end_date params for NFL — BDL silently ignores them.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bdlFetchAll, bdlGameSlateDate, mapGameStatus, type Sport } from "../_shared/bdl.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { handleError, jsonResponse, errorResponse } from "../_shared/http.ts";
import { buildScheduleRows } from "./pure.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const CURRENT_SEASON: Record<Sport, string> = {
  nba: "2025-26",
  wnba: "2026",
  nfl: "2026",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse("Unauthorized", 401);
  }

  let sport: Sport = "nba";
  let season: string | undefined;
  try {
    const body = await req.json();
    if (body?.sport === "wnba" || body?.sport === "nfl") sport = body.sport;
    if (typeof body?.season === "string") season = body.season;
  } catch {
    // No body — defaults apply.
  }
  const targetSeason = season ?? CURRENT_SEASON[sport];

  try {
    // BDL accepts seasons as integer years. NBA's "2025-26" → year 2025;
    // WNBA's "2026" → year 2026.
    const seasonYear = parseInt(targetSeason.split("-")[0], 10);
    if (!seasonYear) {
      return errorResponse(`Invalid season: ${targetSeason}`, 400);
    }

    const bdlGames = await bdlFetchAll(sport, "/games", {
      "seasons[]": String(seasonYear),
      // NFL: fantasy only cares about the regular season, and BDL restarts
      // postseason week numbers at 1 (would corrupt the week column).
      ...(sport === "nfl" ? { postseason: "false" } : {}),
    });

    if (!bdlGames || bdlGames.length === 0) {
      await recordHeartbeat(supabase, `sync-game-schedule:${sport}`, 'ok');
      return jsonResponse({ ok: true, sport, season: targetSeason, games: 0, note: "BDL returned no games" });
    }

    const { finals, pending } = buildScheduleRows(bdlGames, sport, targetSeason, {
      isFinal: (status, kickoffIso) => mapGameStatus(status, sport, kickoffIso) === 3,
      slateDateOf: bdlGameSlateDate,
    });

    // Upsert in chunks. (sport, game_id) is the conflict key. The two batches
    // have different column sets (see pure.ts) and MUST stay separate —
    // PostgREST derives the SET list per request, so mixing shapes would
    // null the keys missing from some rows.
    const BATCH = 500;
    let upserted = 0;
    for (const rows of [finals, pending]) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const { error } = await supabase
          .from("game_schedule")
          .upsert(chunk, { onConflict: "sport,game_id" });
        if (error) throw error;
        upserted += chunk.length;
      }
    }

    await recordHeartbeat(supabase, `sync-game-schedule:${sport}`, 'ok');
    return jsonResponse({
      ok: true,
      sport,
      season: targetSeason,
      bdl_games: bdlGames.length,
      upserted,
      finals: finals.length,
      pending: pending.length,
    });
  } catch (err: any) {
    await recordHeartbeat(supabase, `sync-game-schedule:${sport}`, 'error', err?.message ?? String(err));
    return handleError(err, 'sync-game-schedule');
  }
});
