import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const NBA_SCOREBOARD_URL =
  "https://cdn.nba.com/static/json/liveData/scoreboard/todaysScoreboard_00.json";
const NBA_BOXSCORE_URL = (gameId: string) =>
  `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;

const NBA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  "x-nba-stats-origin": "stats",
  "x-nba-stats-token": "true",
  Connection: "keep-alive",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
};

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

interface NbaPlayerStatistics {
  points: number;
  reboundsTotal: number;
  assists: number;
  blocks: number;
  steals: number;
  turnovers: number;
  fieldGoalsMade: number;
  fieldGoalsAttempted: number;
  threePointersMade: number;
  threePointersAttempted: number;
  freeThrowsMade: number;
  freeThrowsAttempted: number;
  foulsPersonal: number;
  minutesCalculated: string;
}

interface NbaPlayer {
  personId: number;
  name: string;
  oncourt: string;
  statistics: NbaPlayerStatistics;
}

function computeDoubles(
  s: NbaPlayerStatistics,
): { double_double: boolean; triple_double: boolean } {
  const cats = [
    s.points >= 10,
    s.reboundsTotal >= 10,
    s.assists >= 10,
    s.steals >= 10,
    s.blocks >= 10,
  ].filter(Boolean).length;
  return { double_double: cats >= 2, triple_double: cats >= 3 };
}

function parseMinutes(minutesCalculated: string): number {
  const match = minutesCalculated?.match(/PT(\d+)M/);
  return match ? parseInt(match[1], 10) : 0;
}

function buildTeamRows(
  players: NbaPlayer[],
  nbaIdToPlayerId: Map<number, string>,
  game: any,
  gameDate: string,
  ownTricode: string,
  opponentTricode: string,
  isHome: boolean,
  homeScore: number,
  awayScore: number,
): { liveRows: any[]; gameRows: any[]; teamUpdates: any[] } {
  const matchup = isHome ? `vs ${opponentTricode}` : `@${opponentTricode}`;
  const liveRows: any[] = [];
  const gameRows: any[] = [];
  const teamUpdates: any[] = [];

  for (const player of players) {
    const playerId = nbaIdToPlayerId.get(player.personId);
    if (!playerId) continue;

    const s = player.statistics;

    liveRows.push({
      player_id: playerId,
      game_id: game.gameId,
      game_date: gameDate,
      game_status: game.gameStatus,
      period: game.period ?? 0,
      game_clock: game.gameClock ?? "",
      matchup,
      home_score: homeScore,
      away_score: awayScore,
      oncourt: player.oncourt === '1',
      pts: s.points ?? 0,
      reb: s.reboundsTotal ?? 0,
      ast: s.assists ?? 0,
      blk: s.blocks ?? 0,
      stl: s.steals ?? 0,
      tov: s.turnovers ?? 0,
      fgm: s.fieldGoalsMade ?? 0,
      fga: s.fieldGoalsAttempted ?? 0,
      "3pm": s.threePointersMade ?? 0,
      "3pa": s.threePointersAttempted ?? 0,
      ftm: s.freeThrowsMade ?? 0,
      fta: s.freeThrowsAttempted ?? 0,
      pf: s.foulsPersonal ?? 0,
      updated_at: new Date().toISOString(),
    });

    teamUpdates.push({ id: playerId, nba_team: ownTricode });

    if (game.gameStatus === 3) {
      const { double_double, triple_double } = computeDoubles(s);
      gameRows.push({
        player_id: playerId,
        game_id: game.gameId,
        game_date: gameDate,
        matchup,
        min: parseMinutes(s.minutesCalculated),
        pts: s.points ?? 0,
        reb: s.reboundsTotal ?? 0,
        ast: s.assists ?? 0,
        blk: s.blocks ?? 0,
        stl: s.steals ?? 0,
        tov: s.turnovers ?? 0,
        fgm: s.fieldGoalsMade ?? 0,
        fga: s.fieldGoalsAttempted ?? 0,
        "3pm": s.threePointersMade ?? 0,
        "3pa": s.threePointersAttempted ?? 0,
        ftm: s.freeThrowsMade ?? 0,
        fta: s.freeThrowsAttempted ?? 0,
        pf: s.foulsPersonal ?? 0,
        double_double,
        triple_double,
      });
    }
  }

  return { liveRows, gameRows, teamUpdates };
}

Deno.serve(async (req: Request) => {
  // Verify cron secret
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  try {
    const sbRes = await fetch(NBA_SCOREBOARD_URL, { headers: NBA_HEADERS });
    if (!sbRes.ok) {
      const text = await sbRes.text();
      console.error(`Scoreboard fetch failed: ${sbRes.status} — ${text.slice(0, 200)}`);
      return new Response(
        JSON.stringify({ error: `scoreboard fetch failed: ${sbRes.status}` }),
        { status: 502 },
      );
    }

    const sbData = await sbRes.json();
    const games: any[] = sbData?.scoreboard?.games ?? [];
    const gameDate: string =
      sbData?.scoreboard?.gameDate ?? new Date().toISOString().slice(0, 10);

    const activeGames = games.filter(
      (g) => g.gameStatus === 2 || g.gameStatus === 3,
    );

    if (activeGames.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, games: 0, allGames: games.length }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const allNbaIds = new Set<number>();
    const gameBoxscores = new Map<string, any>();

    for (const game of activeGames) {
      const res = await fetch(NBA_BOXSCORE_URL(game.gameId), {
        headers: NBA_HEADERS,
      });
      if (!res.ok) {
        console.error(`Boxscore fetch failed for ${game.gameId}: ${res.status}`);
        continue;
      }
      const box = await res.json();
      gameBoxscores.set(game.gameId, box);

      const homePlayers: NbaPlayer[] = box?.game?.homeTeam?.players ?? [];
      const awayPlayers: NbaPlayer[] = box?.game?.awayTeam?.players ?? [];
      for (const p of [...homePlayers, ...awayPlayers]) allNbaIds.add(p.personId);
    }

    if (allNbaIds.size === 0) {
      return new Response(
        JSON.stringify({ ok: true, players: 0 }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const { data: playerRows, error: playerErr } = await supabase
      .from("players")
      .select("id, external_id_nba")
      .in("external_id_nba", [...allNbaIds]);

    if (playerErr) {
      console.error("Player lookup error:", playerErr.message);
      return new Response(JSON.stringify({ error: playerErr.message }), {
        status: 500,
      });
    }

    const nbaIdToPlayerId = new Map<number, string>(
      (playerRows ?? []).map((p: any) => [Number(p.external_id_nba), p.id]),
    );

    let totalLiveRows = 0;
    let totalGameRows = 0;
    const allTeamUpdates: any[] = [];

    for (const game of activeGames) {
      const box = gameBoxscores.get(game.gameId);
      if (!box) continue;

      const homeTricode: string = box?.game?.homeTeam?.teamTricode ?? "";
      const awayTricode: string = box?.game?.awayTeam?.teamTricode ?? "";
      const homeScore: number = box?.game?.homeTeam?.score ?? 0;
      const awayScore: number = box?.game?.awayTeam?.score ?? 0;
      const homePlayers: NbaPlayer[] = box?.game?.homeTeam?.players ?? [];
      const awayPlayers: NbaPlayer[] = box?.game?.awayTeam?.players ?? [];

      const { liveRows: homeLive, gameRows: homeGames, teamUpdates: homeTeams } = buildTeamRows(
        homePlayers, nbaIdToPlayerId, game, gameDate,
        homeTricode, awayTricode, true, homeScore, awayScore
      );
      const { liveRows: awayLive, gameRows: awayGames, teamUpdates: awayTeams } = buildTeamRows(
        awayPlayers, nbaIdToPlayerId, game, gameDate,
        awayTricode, homeTricode, false, homeScore, awayScore
      );

      const liveRows = [...homeLive, ...awayLive];
      const gameRows = [...homeGames, ...awayGames];
      allTeamUpdates.push(...homeTeams, ...awayTeams);

      if (liveRows.length > 0) {
        const { error } = await supabase
          .from("live_player_stats")
          .upsert(liveRows, { onConflict: "player_id,game_date" });
        if (error) {
          console.error(`live_player_stats upsert error (${game.gameId}):`, error.message);
        } else {
          totalLiveRows += liveRows.length;
        }
      }

      if (gameRows.length > 0) {
        const { error } = await supabase
          .from("player_games")
          .upsert(gameRows, { onConflict: "player_id,game_id", ignoreDuplicates: false });
        if (error) {
          console.error(`player_games upsert error (${game.gameId}):`, error.message);
        } else {
          totalGameRows += gameRows.length;
        }
      }
    }

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
        matchedPlayers: nbaIdToPlayerId.size,
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
