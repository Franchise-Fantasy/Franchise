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

    // Use ET date since NBA games are scheduled in Eastern time.
    // Between midnight–3am ET, also check yesterday since West Coast games
    // (10pm ET tip) can run past midnight.
    const gameDate = nowET.toISOString().slice(0, 10);
    const yesterdayET = new Date(nowET.getTime() - 86_400_000).toISOString().slice(0, 10);
    const datesToCheck = hour < 3 ? [gameDate, yesterdayET] : [gameDate];

    // Parallel BDL calls for each date
    const [gamesResults, statsResults] = await Promise.all([
      Promise.all(datesToCheck.map(d => bdlFetch("/games", { "dates[]": d }))),
      Promise.all(datesToCheck.map(d => bdlFetch("/stats", { "dates[]": d, per_page: "100" }))),
    ]);
    const gamesData = { data: gamesResults.flatMap((r: any) => r?.data ?? []) };
    const statsData = { data: statsResults.flatMap((r: any) => r?.data ?? []), meta: statsResults[0]?.meta };

    const allGames: any[] = gamesData?.data ?? [];
    const activeGames = allGames.filter((g: any) => {
      const s = mapGameStatus(g.status ?? "");
      return s === 2 || s === 3;
    });

    if (activeGames.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, games: 0, allGames: allGames.length }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Build game lookup: gameId → game metadata
    const gameMap = new Map<number, any>();
    for (const g of activeGames) gameMap.set(g.id, g);

    // Paginate through all stats for checked dates
    let allStats: any[] = statsData?.data ?? [];
    for (const d of datesToCheck) {
      // First page already fetched above; paginate remaining pages per date
      // Find the cursor for this date's initial fetch
      const initialIdx = datesToCheck.indexOf(d);
      let cursor = statsResults[initialIdx]?.meta?.next_cursor;
      while (cursor) {
        const page = await bdlFetch("/stats", {
          "dates[]": d,
          per_page: "100",
          cursor: String(cursor),
        });
        allStats.push(...(page?.data ?? []));
        cursor = page?.meta?.next_cursor;
      }
    }

    // Filter to only stats from active/finished games
    const activeStats = allStats.filter((s: any) => gameMap.has(s.game?.id));

    if (activeStats.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, games: activeGames.length, players: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    // Collect BDL player IDs
    const allBdlIds = new Set<number>();
    for (const s of activeStats) {
      if (s.player?.id) allBdlIds.add(s.player.id);
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

    // Fetch previous minutes for oncourt derivation (both dates when checking yesterday too)
    const { data: existingLive } = await supabase
      .from("live_player_stats")
      .select("player_id, game_date, min")
      .in("player_id", [...bdlIdToPlayerId.values()])
      .in("game_date", datesToCheck);

    const prevMinMap = new Map<string, number>(
      (existingLive ?? []).map((r: any) => [`${r.player_id}:${r.game_date}`, parseMinutes(String(r.min ?? "0"))]),
    );

    const allLiveRows: any[] = [];
    const allGameRows: any[] = [];
    const allTeamUpdates: any[] = [];

    for (const stat of activeStats) {
      const playerId = bdlIdToPlayerId.get(stat.player?.id);
      if (!playerId) continue;

      const game = gameMap.get(stat.game?.id);
      if (!game) continue;

      const gameStatus = mapGameStatus(game.status ?? "");
      const period = game.period ?? 0;
      const gameClock = toIsoDuration(game.time ?? "");
      const gameId = String(game.id);
      // Use the game's own date from BDL, not the poll date.
      // Late West Coast games that cross midnight keep yesterday's date.
      const actualGameDate = game.date?.slice(0, 10) ?? gameDate;

      // Determine home/away from the stat's team vs game's home team
      const statTeamId = stat.team?.id;
      const isHome = statTeamId === game.home_team?.id;
      const ownTricode = stat.team?.abbreviation ?? "";
      const oppTricode = isHome ? game.visitor_team?.abbreviation ?? "" : game.home_team?.abbreviation ?? "";
      const matchup = isHome ? `vs ${oppTricode}` : `@${oppTricode}`;
      const homeScore = game.home_team_score ?? 0;
      const awayScore = game.visitor_team_score ?? 0;

      const pts = stat.pts ?? 0;
      const reb = stat.reb ?? 0;
      const ast = stat.ast ?? 0;
      const blk = stat.blk ?? 0;
      const stl = stat.stl ?? 0;
      const tov = stat.turnover ?? 0;
      const fgm = stat.fgm ?? 0;
      const fga = stat.fga ?? 0;
      const fg3m = stat.fg3m ?? 0;
      const fg3a = stat.fg3a ?? 0;
      const ftm = stat.ftm ?? 0;
      const fta = stat.fta ?? 0;
      const pf = stat.pf ?? 0;
      const currentMin = parseMinutes(stat.min ?? "0");

      // Derive oncourt: if minutes increased since last poll, player is on the floor
      const prevMin = prevMinMap.get(`${playerId}:${actualGameDate}`) ?? 0;
      const oncourt = gameStatus === 2 && currentMin > prevMin;

      allLiveRows.push({
        player_id: playerId,
        game_id: gameId,
        game_date: actualGameDate,
        game_status: gameStatus,
        period,
        game_clock: gameClock,
        matchup,
        home_score: homeScore,
        away_score: awayScore,
        oncourt,
        pts, reb, ast, blk, stl, tov, fgm, fga,
        "3pm": fg3m, "3pa": fg3a, ftm, fta, pf,
        updated_at: new Date().toISOString(),
      });

      allTeamUpdates.push({ id: playerId, nba_team: ownTricode });

      if (gameStatus === 3) {
        const { double_double, triple_double } = computeDoubles({ pts, reb, ast, stl, blk });
        allGameRows.push({
          player_id: playerId,
          game_id: gameId,
          game_date: actualGameDate,
          matchup,
          min: currentMin,
          pts, reb, ast, blk, stl, tov, fgm, fga,
          "3pm": fg3m, "3pa": fg3a, ftm, fta, pf,
          double_double,
          triple_double,
        });
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
        activeGames: activeGames.length,
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