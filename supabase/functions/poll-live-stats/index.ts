import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bdlFetch, mapGameStatus, toIsoDuration } from "../_shared/bdl.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

function computeDoubles(
  s: { pts: number; reb: number; ast: number; stl: number; blk: number },
): { double_double: boolean; triple_double: boolean } {
  const cats = [
    s.pts >= 10, s.reb >= 10, s.ast >= 10, s.stl >= 10, s.blk >= 10,
  ].filter(Boolean).length;
  return { double_double: cats >= 2, triple_double: cats >= 3 };
}

/** Parse BDL min string (e.g. "23:45", "34") to integer minutes. */
function parseMinutes(min: string | null): number {
  if (!min) return 0;
  const parts = min.split(":");
  return parseInt(parts[0], 10) || 0;
}

/**
 * Extract period number from BDL status string.
 * "1st Qtr" → 1, "4th Qtr" → 4, "OT1" → 5, "OT2" → 6, "Halftime" → 2, etc.
 */
function extractPeriod(status: string, period?: number): number {
  if (period != null && period > 0) return period;
  const qtrMatch = status.match(/(\d)(?:st|nd|rd|th)\s*Qtr/i);
  if (qtrMatch) return parseInt(qtrMatch[1], 10);
  if (/half/i.test(status)) return 2;
  const otMatch = status.match(/OT(\d*)/i);
  if (otMatch) return 4 + (parseInt(otMatch[1], 10) || 1);
  return 0;
}

Deno.serve(async (req: Request) => {
  // Verify cron secret
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // Skip during 3–10am ET when no NBA games are running
    const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
    const hour = nowET.getHours();
    if (hour >= 3 && hour < 10) {
      return new Response(
        JSON.stringify({ ok: true, skipped: true, reason: "off-hours (3-10am ET)" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Single BDL call returns all live games with full player stats
    const data = await bdlFetch("/box_scores/live");
    const boxScores: any[] = data?.data ?? [];

    if (boxScores.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, games: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Filter to active/finished games only
    const activeBoxScores = boxScores.filter((bs: any) => {
      const status = mapGameStatus(bs.game?.status ?? "");
      return status === 2 || status === 3;
    });

    if (activeBoxScores.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, games: 0, allGames: boxScores.length }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Collect all BDL player IDs from the box scores
    const allBdlIds = new Set<number>();
    for (const bs of activeBoxScores) {
      for (const ps of [...(bs.home_team_player_stats ?? []), ...(bs.visitor_team_player_stats ?? [])]) {
        if (ps.player?.id) allBdlIds.add(ps.player.id);
      }
    }

    if (allBdlIds.size === 0) {
      return new Response(
        JSON.stringify({ ok: true, players: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Look up internal player IDs by external_id_bdl
    const { data: playerRows, error: playerErr } = await supabase
      .from("players")
      .select("id, external_id_bdl")
      .in("external_id_bdl", [...allBdlIds]);

    if (playerErr) {
      console.error("Player lookup error:", playerErr.message);
      return new Response(JSON.stringify({ error: playerErr.message }), { status: 500 });
    }

    const bdlIdToPlayerId = new Map<number, string>(
      (playerRows ?? []).map((p: any) => [Number(p.external_id_bdl), p.id]),
    );

    const missingBdlIds = [...allBdlIds].filter(id => !bdlIdToPlayerId.has(id));
    if (missingBdlIds.length > 0) {
      console.warn(`Players not in DB (BDL IDs): ${missingBdlIds.join(', ')}`);
    }

    // Fetch current minutes for oncourt derivation
    const gameDate = new Date().toISOString().slice(0, 10);
    const { data: existingLive } = await supabase
      .from("live_player_stats")
      .select("player_id, min")
      .in("player_id", [...bdlIdToPlayerId.values()])
      .eq("game_date", gameDate);

    const prevMinMap = new Map<string, number>(
      (existingLive ?? []).map((r: any) => [r.player_id, parseMinutes(r.min ?? "0")]),
    );

    const allLiveRows: any[] = [];
    const allGameRows: any[] = [];
    const allTeamUpdates: any[] = [];

    for (const bs of activeBoxScores) {
      const game = bs.game;
      if (!game) continue;

      const gameStatus = mapGameStatus(game.status ?? "");
      const period = extractPeriod(game.status ?? "", game.period);
      const gameClock = toIsoDuration(game.time ?? "");
      const gameId = String(game.id);
      const bsDate: string = game.date?.slice(0, 10) ?? gameDate;
      const homeTeam: string = bs.home_team?.abbreviation ?? "";
      const awayTeam: string = bs.visitor_team?.abbreviation ?? "";
      const homeScore: number = bs.home_team_score ?? 0;
      const awayScore: number = bs.visitor_team_score ?? 0;

      const sides = [
        { players: bs.home_team_player_stats ?? [], tricode: homeTeam, oppTricode: awayTeam, isHome: true },
        { players: bs.visitor_team_player_stats ?? [], tricode: awayTeam, oppTricode: homeTeam, isHome: false },
      ];

      for (const side of sides) {
        const matchup = side.isHome ? `vs ${side.oppTricode}` : `@${side.oppTricode}`;

        for (const ps of side.players) {
          const playerId = bdlIdToPlayerId.get(ps.player?.id);
          if (!playerId) continue;

          const pts = ps.pts ?? 0;
          const reb = ps.reb ?? 0;
          const ast = ps.ast ?? 0;
          const blk = ps.blk ?? 0;
          const stl = ps.stl ?? 0;
          const tov = ps.turnover ?? 0;
          const fgm = ps.fgm ?? 0;
          const fga = ps.fga ?? 0;
          const fg3m = ps.fg3m ?? 0;
          const fg3a = ps.fg3a ?? 0;
          const ftm = ps.ftm ?? 0;
          const fta = ps.fta ?? 0;
          const pf = ps.pf ?? 0;
          const currentMin = parseMinutes(ps.min ?? "0");

          // Derive oncourt: if minutes increased since last poll, player is on the floor
          const prevMin = prevMinMap.get(playerId) ?? 0;
          const oncourt = gameStatus === 2 && currentMin > prevMin;

          allLiveRows.push({
            player_id: playerId,
            game_id: gameId,
            game_date: bsDate,
            game_status: gameStatus,
            period,
            game_clock: gameClock,
            matchup,
            home_score: homeScore,
            away_score: awayScore,
            oncourt,
            pts, reb, ast, blk, stl, tov, fgm, fga,
            "3pm": fg3m, "3pa": fg3a, ftm, fta, pf,
            min: ps.min ?? "0",
            updated_at: new Date().toISOString(),
          });

          allTeamUpdates.push({ id: playerId, nba_team: side.tricode });

          if (gameStatus === 3) {
            const { double_double, triple_double } = computeDoubles({ pts, reb, ast, stl, blk });
            allGameRows.push({
              player_id: playerId,
              game_id: gameId,
              game_date: bsDate,
              matchup,
              min: currentMin,
              pts, reb, ast, blk, stl, tov, fgm, fga,
              "3pm": fg3m, "3pa": fg3a, ftm, fta, pf,
              double_double,
              triple_double,
            });
          }
        }
      }
    }

    let totalLiveRows = 0;
    let totalGameRows = 0;

    const upsertPromises: Promise<void>[] = [];

    if (allLiveRows.length > 0) {
      upsertPromises.push(
        supabase
          .from("live_player_stats")
          .upsert(allLiveRows, { onConflict: "player_id,game_date" })
          .then(({ error }) => {
            if (error) console.error("live_player_stats batch upsert error:", error.message);
            else totalLiveRows = allLiveRows.length;
          }),
      );
    }

    if (allGameRows.length > 0) {
      upsertPromises.push(
        supabase
          .from("player_games")
          .upsert(allGameRows, { onConflict: "player_id,game_id", ignoreDuplicates: false })
          .then(({ error }) => {
            if (error) console.error("player_games batch upsert error:", error.message);
            else totalGameRows = allGameRows.length;
          }),
      );
    }

    await Promise.all(upsertPromises);

    if (allTeamUpdates.length > 0) {
      const { error } = await supabase
        .from("players")
        .upsert(allTeamUpdates, { onConflict: "id" });
      if (error) {
        console.error("players nba_team update error:", error.message);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        gameDate,
        activeGames: activeBoxScores.length,
        matchedPlayers: bdlIdToPlayerId.size,
        liveRowsUpserted: totalLiveRows,
        gameRowsUpserted: totalGameRows,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("Unhandled error in poll-live-stats:", err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
      status: 500,
    });
  }
});
