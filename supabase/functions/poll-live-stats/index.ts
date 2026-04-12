import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { bdlFetch, mapGameStatus, toIsoDuration } from "../_shared/bdl.ts";
import { pushActivityUpdate } from "../_shared/apns.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
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

// ── Live Activity dispatch: push player stat lines to active activities ──

async function dispatchPlayerTickerUpdates(
  liveRows: any[],
): Promise<void> {
  if (liveRows.length === 0) return;

  // Check for any active matchup Live Activities
  const { data: tokens } = await supabase
    .from('activity_tokens')
    .select('id, team_id, schedule_id, league_id, matchup_id')
    .eq('activity_type', 'matchup')
    .eq('stale', false);

  if (!tokens || tokens.length === 0) return;

  // Build a lookup: player_id → live stat row
  const liveByPlayer = new Map<string, any>(
    liveRows.map(r => [r.player_id, r]),
  );

  // Get unique team IDs from active tokens
  const teamIds = [...new Set(tokens.map(t => t.team_id))];

  // Fetch rostered players for those teams
  const { data: rosterPlayers } = await supabase
    .from('league_players')
    .select('player_id, team_id, roster_slot, players!inner(first_name, last_name)')
    .in('team_id', teamIds)
    .not('roster_slot', 'in', '("BE","IR","TAXI")');

  if (!rosterPlayers || rosterPlayers.length === 0) return;

  // Group roster by team
  const rosterByTeam = new Map<string, any[]>();
  for (const rp of rosterPlayers) {
    const list = rosterByTeam.get(rp.team_id) ?? [];
    list.push(rp);
    rosterByTeam.set(rp.team_id, list);
  }

  // Also need scoring weights per league to compute FPTS
  const leagueIds = [...new Set(tokens.map(t => t.league_id))];
  const { data: scoringRows } = await supabase
    .from('scoring_weights')
    .select('league_id, stat_name, point_value, is_enabled')
    .in('league_id', leagueIds);

  const scoringByLeague = new Map<string, any[]>();
  for (const sw of scoringRows ?? []) {
    const list = scoringByLeague.get(sw.league_id) ?? [];
    list.push(sw);
    scoringByLeague.set(sw.league_id, list);
  }

  // For each active token, build player stat lines
  for (const token of tokens) {
    const roster = rosterByTeam.get(token.team_id) ?? [];
    const weights = scoringByLeague.get(token.league_id) ?? [];

    // Find rostered players with live stats
    const playerLines: any[] = [];
    for (const rp of roster) {
      const live = liveByPlayer.get(rp.player_id);
      if (!live || live.game_status < 2) continue; // only live or final games

      const player = (rp as any).players;
      const firstName = player?.first_name ?? '';
      const lastName = player?.last_name ?? '';
      const name = firstName ? `${firstName.charAt(0)}. ${lastName}` : lastName;

      // Compute fantasy points
      let fpts = 0;
      for (const w of weights) {
        if (!w.is_enabled) continue;
        const gameKey = STAT_TO_GAME[w.stat_name];
        if (!gameKey) continue;
        const val = live[gameKey] ?? 0;
        fpts += val * w.point_value;
      }

      playerLines.push({
        name,
        statLine: `${live.pts}p ${live.reb}r ${live.ast}a`,
        fantasyPoints: Math.round(fpts * 10) / 10,
        gameStatus: live.game_status === 3
          ? 'Final'
          : live.game_clock
            ? `${ordinal(live.period)} ${formatClock(live.game_clock)}`
            : `${ordinal(live.period)}`,
        isOnCourt: live.oncourt ?? false,
      });
    }

    // Sort by FPTS descending, take top 5
    playerLines.sort((a, b) => b.fantasyPoints - a.fantasyPoints);
    const top5 = playerLines.slice(0, 5);

    // Find biggest contributor
    const biggest = top5[0];
    const biggestContributor = biggest
      ? `${biggest.name} ${biggest.statLine}`
      : '';

    // Only push if there are live players to show
    if (top5.length === 0) continue;

    const contentState = {
      // Scores are set by get-week-scores; we only update player lines here
      // ActivityKit merges updates, so we include all fields
      myScore: 0,
      opponentScore: 0,
      scoreGap: 0,
      biggestContributor,
      myActivePlayers: playerLines.filter(p => p.gameStatus !== 'Final').length,
      opponentActivePlayers: 0,
      players: top5,
    };

    await pushActivityUpdate(supabase, 'matchup', {
      schedule_id: token.schedule_id,
      league_id: token.league_id,
    }, contentState).catch(() => {});
  }
}

// Stat key mapping (matches get-week-scores)
const STAT_TO_GAME: Record<string, string> = {
  PTS: "pts", REB: "reb", AST: "ast", STL: "stl", BLK: "blk",
  TO: "tov", "3PM": "3pm", "3PA": "3pa", FGM: "fgm", FGA: "fga",
  FTM: "ftm", FTA: "fta", PF: "pf",
};

function ordinal(period: number): string {
  if (period === 1) return '1st';
  if (period === 2) return '2nd';
  if (period === 3) return '3rd';
  if (period === 4) return '4th';
  return `OT${period - 4}`;
}

function formatClock(isoDuration: string): string {
  // Parse ISO duration like PT5M23S → "5:23"
  const match = isoDuration.match(/PT(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?/);
  if (!match) return isoDuration;
  const min = match[1] ?? '0';
  const sec = Math.floor(parseFloat(match[2] ?? '0'));
  return `${min}:${String(sec).padStart(2, '0')}`;
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

    // ── Dispatch Live Activity player ticker updates (non-blocking) ──
    dispatchPlayerTickerUpdates(allLiveRows).catch(err =>
      console.warn('Live activity ticker dispatch error (non-fatal):', err),
    );

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