/**
 * Sync the season schedule into `game_schedule` from BDL.
 *
 * Replaces the python `backend/seed_schedule.py` for both sports — BDL covers
 * both NBA (`/v1/games`) and WNBA (`/wnba/v1/games`) with the same response
 * shape, so a single edge function handles both.
 *
 * Cron-triggered (CRON_SECRET) or manually invokable. Body params:
 *   { sport?: 'nba' | 'wnba'   default 'nba'
 *     season?: string          NBA: '2025-26', WNBA: '2026'  (default = current) }
 *
 * Upserts on (sport, game_id). Updates the score columns + status when the
 * game has finalized so re-running a finished season doesn't undo final
 * scores written by poll-live-stats.
 */

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { bdlFetchAll, type Sport } from "../_shared/bdl.ts";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const jsonHeaders = { ...CORS_HEADERS, "Content-Type": "application/json" };

const CURRENT_SEASON: Record<Sport, string> = {
  nba: "2025-26",
  wnba: "2026",
};

/**
 * BDL returns games with `status` strings like "Final", "Q3 5:42",
 * "2025-10-21T23:30:00Z" (scheduled — ISO timestamp), etc. The current
 * `game_schedule.status` is just "scheduled" / "final".
 */
function deriveStatus(bdlStatus: string): "scheduled" | "final" {
  return bdlStatus === "Final" ? "final" : "scheduled";
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

  let sport: Sport = "nba";
  let season: string | undefined;
  try {
    const body = await req.json();
    if (body?.sport === "wnba") sport = "wnba";
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
      return new Response(
        JSON.stringify({ error: `Invalid season: ${targetSeason}` }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const bdlGames = await bdlFetchAll(sport, "/games", {
      "seasons[]": String(seasonYear),
    });

    if (!bdlGames || bdlGames.length === 0) {
      await recordHeartbeat(supabase, `sync-game-schedule:${sport}`, 'ok');
      return new Response(
        JSON.stringify({ ok: true, sport, season: targetSeason, games: 0, note: "BDL returned no games" }),
        { status: 200, headers: jsonHeaders },
      );
    }

    const rows = bdlGames
      .filter((g: any) => g.home_team?.abbreviation && g.visitor_team?.abbreviation)
      .map((g: any) => {
        const status = deriveStatus(String(g.status ?? ""));
        const isFinal = status === "final";
        return {
          sport,
          game_id: String(g.id),
          game_date: g.date?.slice(0, 10),
          season: targetSeason,
          home_team: g.home_team.abbreviation,
          away_team: g.visitor_team.abbreviation,
          home_score: isFinal ? (g.home_team_score ?? null) : null,
          away_score: isFinal ? (g.visitor_team_score ?? null) : null,
          status,
          game_time_utc: g.datetime ?? null,
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
      if (error) {
        console.error("game_schedule upsert error:", error.message);
        return new Response(
          JSON.stringify({ error: error.message, upserted }),
          { status: 500, headers: jsonHeaders },
        );
      }
      upserted += chunk.length;
    }

    await recordHeartbeat(supabase, `sync-game-schedule:${sport}`, 'ok');
    return new Response(
      JSON.stringify({
        ok: true,
        sport,
        season: targetSeason,
        bdl_games: bdlGames.length,
        upserted,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err: any) {
    console.error("sync-game-schedule error:", err?.message ?? err);
    await recordHeartbeat(supabase, `sync-game-schedule:${sport}`, 'error', err?.message ?? String(err));
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
