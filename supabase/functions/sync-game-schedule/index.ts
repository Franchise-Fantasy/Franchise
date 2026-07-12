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
 * Upserts on (sport, game_id). Updates the score columns + status when the
 * game has finalized so re-running a finished season doesn't undo final
 * scores written by poll-live-stats.
 *
 * NFL: regular-season games only (postseason=false — BDL restarts week
 * numbering at 1 in the postseason, and fantasy schedules end at week 18).
 * The NFL week number is stored in game_schedule.week (drives bye detection).
 * Do NOT add start_date/end_date params for NFL — BDL silently ignores them.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bdlFetchAll, bdlGameSlateDate, type Sport } from "../_shared/bdl.ts";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";
import { handleError, jsonResponse, errorResponse } from "../_shared/http.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const CURRENT_SEASON: Record<Sport, string> = {
  nba: "2025-26",
  wnba: "2026",
  nfl: "2026",
};

/**
 * BDL returns games with `status` strings like "Final", "Q3 5:42",
 * "2025-10-21T23:30:00Z" (scheduled — ISO timestamp), etc. The current
 * `game_schedule.status` is just "scheduled" / "final".
 */
function deriveStatus(bdlStatus: string): "scheduled" | "final" {
  return bdlStatus === "Final" ? "final" : "scheduled";
}

/**
 * BDL emits a midnight-Eastern timestamp (e.g. "2026-05-03T04:00:00Z" during
 * EDT) as the TBD placeholder for playoff games whose tipoff isn't set yet.
 * Real NBA/WNBA games never tip at exactly 12:00am ET, so any datetime that
 * lands on midnight ET is a placeholder — return null so downstream lock
 * logic (utils/nba/gameStarted.ts) treats the game as untimed instead of
 * "already started at midnight."
 */
function normalizeGameTimeUtc(datetime: string | null | undefined): string | null {
  if (!datetime) return null;
  const d = new Date(datetime);
  if (isNaN(d.getTime())) return null;
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const hour = etParts.find((p) => p.type === "hour")?.value;
  const minute = etParts.find((p) => p.type === "minute")?.value;
  // Intl returns "24" for midnight in some Node/Deno versions; treat both as midnight.
  const isMidnightEt = (hour === "00" || hour === "24") && minute === "00";
  return isMidnightEt ? null : datetime;
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

    const rows = bdlGames
      .filter((g: any) => g.home_team?.abbreviation && g.visitor_team?.abbreviation)
      .map((g: any) => {
        const status = deriveStatus(String(g.status ?? ""));
        const isFinal = status === "final";
        // BDL's NBA endpoint returns `date: "YYYY-MM-DD"` and `datetime: <ISO>`.
        // Its WNBA endpoint returns the tipoff time directly in `date` as a
        // full ISO timestamp and omits `datetime` entirely. Prefer `datetime`
        // when present; otherwise use `date` if it carries a time component.
        const rawDateTime =
          g.datetime ??
          (typeof g.date === "string" && g.date.length > 10 ? g.date : null);
        // Anchor game_date on the ET slate so 10pm ET tipoffs (02:00 UTC next
        // day) stay attached to the night they were scheduled for. Falls back
        // to plain date for NBA's `YYYY-MM-DD` form.
        const gameDate = bdlGameSlateDate(rawDateTime ?? g.date);
        return {
          sport,
          game_id: String(g.id),
          game_date: gameDate,
          season: targetSeason,
          home_team: g.home_team.abbreviation,
          away_team: g.visitor_team.abbreviation,
          home_score: isFinal ? (g.home_team_score ?? null) : null,
          away_score: isFinal ? (g.visitor_team_score ?? null) : null,
          status,
          game_time_utc: normalizeGameTimeUtc(rawDateTime),
          // NFL week number (1-18) drives bye detection; basketball has none.
          ...(sport === "nfl" ? { week: g.week ?? null } : {}),
        };
      })
      .filter((r) => r.game_date);

    // Upsert in chunks. (sport, game_id) is the conflict key.
    const BATCH = 500;
    let upserted = 0;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const { error } = await supabase
        .from("game_schedule")
        .upsert(chunk, { onConflict: "sport,game_id" });
      if (error) throw error;
      upserted += chunk.length;
    }

    await recordHeartbeat(supabase, `sync-game-schedule:${sport}`, 'ok');
    return jsonResponse({
      ok: true,
      sport,
      season: targetSeason,
      bdl_games: bdlGames.length,
      upserted,
    });
  } catch (err: any) {
    await recordHeartbeat(supabase, `sync-game-schedule:${sport}`, 'error', err?.message ?? String(err));
    return handleError(err, 'sync-game-schedule');
  }
});
