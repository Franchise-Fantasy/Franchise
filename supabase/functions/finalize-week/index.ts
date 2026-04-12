import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyTeams, notifyLeague } from '../_shared/push.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const STAT_TO_GAME: Record<string, string> = {
  PTS: "pts",
  REB: "reb",
  AST: "ast",
  STL: "stl",
  BLK: "blk",
  TO: "tov",
  "3PM": "3pm",
  "3PA": "3pa",
  FGM: "fgm",
  FGA: "fga",
  FTM: "ftm",
  FTA: "fta",
  PF: "pf",
  DD: "double_double",
  TD: "triple_double",
};

interface ScoringWeight {
  stat_name: string;
  point_value: number;
  is_enabled: boolean;
  inverse: boolean;
}

interface PlayerGameEntry {
  date: string;
  slot: string;
  fpts: number;
  stats: Record<string, any>;
  matchup: string | null;
}

interface PlayerScoreEntry {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  external_id_nba: number | null;
  roster_slot: string;
  week_points: number;
  games: PlayerGameEntry[];
}

// ── Category scoring helpers ───────────────────────────────────────────────

const PERCENTAGE_STATS: Record<string, { numerator: string; denominator: string }> = {
  'FG%': { numerator: 'fgm', denominator: 'fga' },
  'FT%': { numerator: 'ftm', denominator: 'fta' },
};

interface CategoryResult {
  stat: string;
  home: number;
  away: number;
  winner: 'home' | 'away' | 'tie';
}

function aggregateGameStats(
  gameLogs: Record<string, any>[],
): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const game of gameLogs) {
    for (const [, gameKey] of Object.entries(STAT_TO_GAME)) {
      const raw = game[gameKey];
      if (raw == null) continue;
      const val = typeof raw === 'boolean' ? (raw ? 1 : 0) : Number(raw);
      totals[gameKey] = (totals[gameKey] ?? 0) + val;
    }
  }
  return totals;
}

function compareCategoryStats(
  homeStats: Record<string, number>,
  awayStats: Record<string, number>,
  categories: ScoringWeight[],
): { results: CategoryResult[]; homeWins: number; awayWins: number; ties: number } {
  const results: CategoryResult[] = [];
  let homeWins = 0;
  let awayWins = 0;
  let ties = 0;

  for (const cat of categories) {
    if (!cat.is_enabled) continue;

    const pctDef = PERCENTAGE_STATS[cat.stat_name];
    let homeVal: number;
    let awayVal: number;

    if (pctDef) {
      const hNum = homeStats[pctDef.numerator] ?? 0;
      const hDen = homeStats[pctDef.denominator] ?? 0;
      const aNum = awayStats[pctDef.numerator] ?? 0;
      const aDen = awayStats[pctDef.denominator] ?? 0;
      homeVal = hDen > 0 ? Math.round((hNum / hDen) * 1000) / 1000 : 0;
      awayVal = aDen > 0 ? Math.round((aNum / aDen) * 1000) / 1000 : 0;
    } else {
      const gameKey = STAT_TO_GAME[cat.stat_name];
      if (!gameKey) continue;
      homeVal = homeStats[gameKey] ?? 0;
      awayVal = awayStats[gameKey] ?? 0;
    }

    let winner: 'home' | 'away' | 'tie';
    if (homeVal === awayVal) {
      winner = 'tie';
      ties++;
    } else if (cat.inverse) {
      winner = homeVal < awayVal ? 'home' : 'away';
      if (winner === 'home') homeWins++; else awayWins++;
    } else {
      winner = homeVal > awayVal ? 'home' : 'away';
      if (winner === 'home') homeWins++; else awayWins++;
    }

    results.push({ stat: cat.stat_name, home: homeVal, away: awayVal, winner });
  }

  return { results, homeWins, awayWins, ties };
}

function calculateGameFpts(
  game: Record<string, number>,
  weights: ScoringWeight[],
): number {
  let total = 0;
  for (const w of weights) {
    const field = STAT_TO_GAME[w.stat_name];
    if (field && game[field] != null) {
      total += game[field] * w.point_value;
    }
  }
  return Math.round(total * 100) / 100;
}

import { resolveSlot as sharedResolveSlot, isActiveSlot } from '../_shared/resolveSlot.ts';

function resolveSlotForGame(
  dailyEntries: Array<{ lineup_date: string; roster_slot: string }>,
  day: string,
  defaultSlot: string,
  opts: { isOnCurrentRoster: boolean; dropDate?: string; acquiredDate?: string; today: string },
): string {
  return sharedResolveSlot({
    dailyEntries,
    day,
    defaultSlot,
    isOnCurrentRoster: opts.isOnCurrentRoster,
    dropDate: opts.dropDate,
    acquiredDate: opts.acquiredDate,
    today: opts.today,
  });
}

async function fetchTeamRosterAndGames(
  teamId: string,
  leagueId: string,
  startDate: string,
  endDate: string,
) {
  const { data: leaguePlayers } = await supabase
    .from("league_players")
    .select("player_id, roster_slot, acquired_at")
    .eq("team_id", teamId)
    .eq("league_id", leagueId);

  const currentPlayerIds = new Set((leaguePlayers ?? []).map((lp: any) => lp.player_id));
  const defaultSlotMap = new Map<string, string>(
    (leaguePlayers ?? []).map((lp: any) => [lp.player_id, lp.roster_slot ?? "BE"]),
  );

  const acquiredDateMap = new Map<string, string>();
  for (const lp of leaguePlayers ?? []) {
    if ((lp as any).acquired_at) {
      const d = new Date((lp as any).acquired_at);
      acquiredDateMap.set((lp as any).player_id, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    }
  }

  const { data: dailyEntries } = await supabase
    .from("daily_lineups")
    .select("player_id, roster_slot, lineup_date")
    .eq("team_id", teamId)
    .eq("league_id", leagueId)
    .lte("lineup_date", endDate)
    .order("lineup_date", { ascending: false });

  const dailyByPlayer = new Map<
    string,
    Array<{ lineup_date: string; roster_slot: string }>
  >();
  const droppedPlayerIds: string[] = [];
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) {
      dailyByPlayer.set(entry.player_id, []);
    }
    dailyByPlayer.get(entry.player_id)!.push(entry);

    if (
      !currentPlayerIds.has(entry.player_id) &&
      entry.lineup_date >= startDate &&
      !droppedPlayerIds.includes(entry.player_id)
    ) {
      droppedPlayerIds.push(entry.player_id);
    }
  }

  const allPlayerIds = [...currentPlayerIds, ...droppedPlayerIds];

  const [{ data: gameLogs }, { data: playerInfoRows }] = await Promise.all([
    supabase
      .from("player_games")
      .select(
        'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date, matchup',
      )
      .in("player_id", allPlayerIds.length > 0 ? allPlayerIds : ["__none__"])
      .gte("game_date", startDate)
      .lte("game_date", endDate),
    supabase
      .from("players")
      .select("id, name, position, nba_team, external_id_nba")
      .in("id", allPlayerIds.length > 0 ? allPlayerIds : ["__none__"]),
  ]);

  const playerInfo = new Map<string, { name: string; position: string; nba_team: string; external_id_nba: number | null }>();
  for (const p of playerInfoRows ?? []) {
    playerInfo.set(p.id, { name: p.name, position: p.position, nba_team: p.nba_team, external_id_nba: p.external_id_nba });
  }

  // Build drop-date map for players no longer on the team
  const dropDateMap = new Map<string, string>();
  for (const pid of droppedPlayerIds) {
    const entries = dailyByPlayer.get(pid) ?? [];
    const droppedEntry = entries.find((e: any) => e.roster_slot === "DROPPED");
    if (droppedEntry) dropDateMap.set(pid, droppedEntry.lineup_date);
  }

  return { allPlayerIds, currentPlayerIds, defaultSlotMap, acquiredDateMap, dropDateMap, dailyByPlayer, gameLogs: gameLogs ?? [], playerInfo };
}

async function computeTeamScore(
  teamId: string,
  leagueId: string,
  startDate: string,
  endDate: string,
  weights: ScoringWeight[],
): Promise<{ total: number; playerScores: PlayerScoreEntry[] }> {
  const { allPlayerIds, currentPlayerIds, defaultSlotMap, acquiredDateMap, dropDateMap, dailyByPlayer, gameLogs, playerInfo } =
    await fetchTeamRosterAndGames(teamId, leagueId, startDate, endDate);

  if (allPlayerIds.length === 0) return { total: 0, playerScores: [] };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  let teamTotal = 0;
  // Group games by player for building playerScores
  const playerGamesMap = new Map<string, PlayerGameEntry[]>();
  const playerWeekPoints = new Map<string, number>();

  for (const game of gameLogs) {
    const slot = resolveSlotForGame(
      dailyByPlayer.get(game.player_id) ?? [],
      game.game_date,
      defaultSlotMap.get(game.player_id) ?? "BE",
      {
        isOnCurrentRoster: currentPlayerIds.has(game.player_id),
        dropDate: dropDateMap.get(game.player_id),
        acquiredDate: acquiredDateMap.get(game.player_id),
        today: todayStr,
      },
    );

    const fpts = calculateGameFpts(game as any, weights);
    const active = isActiveSlot(slot);

    if (active) {
      teamTotal += fpts;
      playerWeekPoints.set(game.player_id, (playerWeekPoints.get(game.player_id) ?? 0) + fpts);
    }

    if (!playerGamesMap.has(game.player_id)) playerGamesMap.set(game.player_id, []);
    playerGamesMap.get(game.player_id)!.push({
      date: game.game_date,
      slot,
      fpts: Math.round(fpts * 100) / 100,
      stats: {
        pts: game.pts, reb: game.reb, ast: game.ast, stl: game.stl, blk: game.blk,
        tov: game.tov, fgm: game.fgm, fga: game.fga, "3pm": game["3pm"],
        ftm: game.ftm, fta: game.fta, pf: game.pf,
        double_double: game.double_double, triple_double: game.triple_double,
      },
      matchup: game.matchup ?? null,
    });
  }

  const playerScores: PlayerScoreEntry[] = allPlayerIds.map((pid) => {
    const info = playerInfo.get(pid);
    return {
      player_id: pid,
      name: info?.name ?? "Unknown",
      position: info?.position ?? "—",
      nba_team: info?.nba_team ?? "—",
      external_id_nba: info?.external_id_nba ?? null,
      roster_slot: defaultSlotMap.get(pid) ?? "BE",
      week_points: Math.round((playerWeekPoints.get(pid) ?? 0) * 100) / 100,
      games: playerGamesMap.get(pid) ?? [],
    };
  });

  return { total: Math.round(teamTotal * 100) / 100, playerScores };
}

async function computeTeamCategoryStats(
  teamId: string,
  leagueId: string,
  startDate: string,
  endDate: string,
): Promise<{ teamStats: Record<string, number>; playerScores: PlayerScoreEntry[] }> {
  const { allPlayerIds, currentPlayerIds, defaultSlotMap, acquiredDateMap, dropDateMap, dailyByPlayer, gameLogs, playerInfo } =
    await fetchTeamRosterAndGames(teamId, leagueId, startDate, endDate);

  if (allPlayerIds.length === 0) return { teamStats: {}, playerScores: [] };

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

  const activeGames: Record<string, any>[] = [];
  const playerGamesMap = new Map<string, PlayerGameEntry[]>();

  for (const game of gameLogs) {
    const slot = resolveSlotForGame(
      dailyByPlayer.get(game.player_id) ?? [],
      game.game_date,
      defaultSlotMap.get(game.player_id) ?? "BE",
      {
        isOnCurrentRoster: currentPlayerIds.has(game.player_id),
        dropDate: dropDateMap.get(game.player_id),
        acquiredDate: acquiredDateMap.get(game.player_id),
        today: todayStr,
      },
    );
    const active = isActiveSlot(slot);

    if (active) activeGames.push(game);

    if (!playerGamesMap.has(game.player_id)) playerGamesMap.set(game.player_id, []);
    playerGamesMap.get(game.player_id)!.push({
      date: game.game_date,
      slot,
      fpts: 0,
      stats: {
        pts: game.pts, reb: game.reb, ast: game.ast, stl: game.stl, blk: game.blk,
        tov: game.tov, fgm: game.fgm, fga: game.fga, "3pm": game["3pm"],
        ftm: game.ftm, fta: game.fta, pf: game.pf,
        double_double: game.double_double, triple_double: game.triple_double,
      },
      matchup: game.matchup ?? null,
    });
  }

  const playerScores: PlayerScoreEntry[] = allPlayerIds.map((pid) => {
    const info = playerInfo.get(pid);
    return {
      player_id: pid,
      name: info?.name ?? "Unknown",
      position: info?.position ?? "—",
      nba_team: info?.nba_team ?? "—",
      external_id_nba: info?.external_id_nba ?? null,
      roster_slot: defaultSlotMap.get(pid) ?? "BE",
      week_points: 0,
      games: playerGamesMap.get(pid) ?? [],
    };
  });

  return { teamStats: aggregateGameStats(activeGames), playerScores };
}

async function computeStreak(
  teamId: string,
  leagueId: string,
): Promise<string> {
  const { data: matchups } = await supabase
    .from("league_matchups")
    .select("home_team_id, away_team_id, winner_team_id, week_number, playoff_round")
    .eq("league_id", leagueId)
    .eq("is_finalized", true)
    .is("playoff_round", null)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order("week_number", { ascending: false });

  if (!matchups || matchups.length === 0) return "";

  const real = matchups.filter((m: any) => m.away_team_id !== null);
  if (real.length === 0) return "";

  function getResult(m: any): "W" | "L" | "T" {
    if (m.winner_team_id === null) return "T";
    return m.winner_team_id === teamId ? "W" : "L";
  }

  const firstResult = getResult(real[0]);
  let count = 0;
  for (const m of real) {
    if (getResult(m) === firstResult) {
      count++;
    } else {
      break;
    }
  }

  return `${firstResult}${count}`;
}

/** Extract per-day fpts totals from active-slot games */
function extractBestDay(
  playerScores: PlayerScoreEntry[],
): { date: string; total: number } | null {
  const dailyTotals = new Map<string, number>();
  for (const ps of playerScores) {
    for (const g of ps.games) {
      if (isActiveSlot(g.slot)) {
        dailyTotals.set(g.date, (dailyTotals.get(g.date) ?? 0) + g.fpts);
      }
    }
  }
  let best: { date: string; total: number } | null = null;
  for (const [date, total] of dailyTotals) {
    if (!best || total > best.total) best = { date, total };
  }
  return best;
}

function calcRounds(playoffTeams: number): number {
  let p = 1;
  while (p < playoffTeams) p *= 2;
  return Math.log2(p);
}

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // ── Recovery: flush stats for matchups claimed but not yet flushed ──
    const { data: orphaned } = await supabase
      .from("league_matchups")
      .select("id, league_id, home_team_id, away_team_id, home_score, away_score, winner_team_id, playoff_round, home_category_wins, away_category_wins, schedule_id")
      .eq("is_finalized", true)
      .eq("stats_flushed", false);

    if (orphaned && orphaned.length > 0) {
      const recoveryStats: Array<{ p_team_id: string; p_wins: number; p_losses: number; p_ties: number; p_pf: number; p_pa: number }> = [];
      const recoveryScores: Array<{ league_id: string; schedule_id: string; team_id: string; score: number; updated_at: string }> = [];
      const recoveryTeams = new Set<string>();
      const recoveryTeamLeague = new Map<string, string>();
      const now = new Date().toISOString();

      for (const m of orphaned) {
        if (m.away_team_id === null) continue;

        // Recover scores for all matchups (regular season + playoff)
        recoveryScores.push(
          { league_id: m.league_id, schedule_id: m.schedule_id, team_id: m.home_team_id, score: Number(m.home_score ?? 0), updated_at: now },
          { league_id: m.league_id, schedule_id: m.schedule_id, team_id: m.away_team_id, score: Number(m.away_score ?? 0), updated_at: now },
        );

        // Only update team W/L for regular-season matchups
        // PF/PA is owned by update-standings — pass 0 to avoid double-counting
        if (m.playoff_round != null) continue;

        if (m.winner_team_id === m.home_team_id) {
          recoveryStats.push(
            { p_team_id: m.home_team_id, p_wins: 1, p_losses: 0, p_ties: 0, p_pf: 0, p_pa: 0 },
            { p_team_id: m.away_team_id, p_wins: 0, p_losses: 1, p_ties: 0, p_pf: 0, p_pa: 0 },
          );
        } else if (m.winner_team_id === m.away_team_id) {
          recoveryStats.push(
            { p_team_id: m.away_team_id, p_wins: 1, p_losses: 0, p_ties: 0, p_pf: 0, p_pa: 0 },
            { p_team_id: m.home_team_id, p_wins: 0, p_losses: 1, p_ties: 0, p_pf: 0, p_pa: 0 },
          );
        } else {
          recoveryStats.push(
            { p_team_id: m.home_team_id, p_wins: 0, p_losses: 0, p_ties: 1, p_pf: 0, p_pa: 0 },
            { p_team_id: m.away_team_id, p_wins: 0, p_losses: 0, p_ties: 1, p_pf: 0, p_pa: 0 },
          );
        }

        recoveryTeams.add(m.home_team_id);
        recoveryTeams.add(m.away_team_id);
        recoveryTeamLeague.set(m.home_team_id, m.league_id);
        recoveryTeamLeague.set(m.away_team_id, m.league_id);
      }

      if (recoveryScores.length > 0) {
        await supabase.from("week_scores").upsert(recoveryScores, { onConflict: "league_id,schedule_id,team_id" });
      }

      if (recoveryStats.length > 0) {
        await Promise.all(
          recoveryStats.map((params) => supabase.rpc("increment_team_stats", params)),
        );

        await Promise.all([...recoveryTeams].map(async (teamId) => {
          const lid = recoveryTeamLeague.get(teamId)!;
          const streak = await computeStreak(teamId, lid);
          await supabase.from("teams").update({ streak }).eq("id", teamId);
        }));
      }

      await supabase.from("league_matchups").update({ stats_flushed: true }).in("id", orphaned.map((m: any) => m.id));
      console.log(`Recovery: flushed stats for ${orphaned.length} orphaned matchups.`);
    }

    const today = new Date().toISOString().split("T")[0];

    const { data: pendingWeeks, error: weekErr } = await supabase
      .from("league_schedule")
      .select("id, league_id, week_number, start_date, end_date, is_playoff")
      .lt("end_date", today);

    if (weekErr) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch schedule", detail: weekErr.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!pendingWeeks || pendingWeeks.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, finalized: 0, message: "No completed weeks found" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const scheduleIds = pendingWeeks.map((w: any) => w.id);
    const scheduleMap = new Map(pendingWeeks.map((w: any) => [w.id, w]));

    // Atomically claim unfinalized matchups by setting is_finalized=true upfront.
    // If two invocations run concurrently, only one will get rows back (the other
    // will match 0 rows since is_finalized is already true), preventing double stat counts.
    const { data: unfinalizedMatchups, error: matchErr } = await supabase
      .from("league_matchups")
      .update({ is_finalized: true })
      .in("schedule_id", scheduleIds)
      .eq("is_finalized", false)
      .select("id, league_id, schedule_id, week_number, home_team_id, away_team_id, playoff_round");

    if (matchErr) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch matchups", detail: matchErr.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!unfinalizedMatchups || unfinalizedMatchups.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, finalized: 0, message: "All matchups already finalized" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const leagueIds = [...new Set(unfinalizedMatchups.map((m: any) => m.league_id))];
    const scoringByLeague = new Map<string, ScoringWeight[]>();
    const scoringTypeByLeague = new Map<string, string>();

    await Promise.all(leagueIds.map(async (lid) => {
      const [{ data: scoring }, { data: leagueRow }] = await Promise.all([
        supabase
          .from("league_scoring_settings")
          .select("stat_name, point_value, is_enabled, inverse")
          .eq("league_id", lid),
        supabase
          .from("leagues")
          .select("scoring_type")
          .eq("id", lid)
          .single(),
      ]);
      scoringByLeague.set(lid, scoring ?? []);
      scoringTypeByLeague.set(lid, leagueRow?.scoring_type ?? 'points');
    }));

    const affectedTeams = new Set<string>();
    const teamLeagueMap = new Map<string, string>();
    const playoffMatchupsFinalized = new Map<string, Array<{ matchup_id: string; playoff_round: number; winner_id: string | null }>>();
    const bestDayCandidates = new Map<string, { value: number; teamId: string; date: string; season: string }>();

    // Type for per-matchup results returned from parallel processing
    interface MatchupResult {
      statUpdates: Array<{ p_team_id: string; p_wins: number; p_losses: number; p_ties: number; p_pf: number; p_pa: number }>;
      weekScores: Array<{ league_id: string; schedule_id: string; team_id: string; score: number; updated_at: string }>;
      notification: {
        leagueId: string; homeTeamId: string; awayTeamId: string;
        homeScore: number; awayScore: number; winnerId: string | null;
        isPlayoff: boolean; playoffRound: number | null;
        homeCatWins?: number | null; awayCatWins?: number | null;
        catTies?: number | null; scoringType?: string;
      } | null;
      affectedTeamIds: Array<{ teamId: string; leagueId: string }>;
      playoffResult: { leagueId: string; matchup_id: string; playoff_round: number; winner_id: string | null } | null;
      bestDay: { leagueId: string; value: number; teamId: string; date: string; season: string } | null;
    }

    // Process all matchups in parallel — each is independent (already atomically claimed)
    const settled = await Promise.allSettled(
      unfinalizedMatchups.map(async (matchup): Promise<MatchupResult> => {
        const week = scheduleMap.get(matchup.schedule_id);
        if (!week) return { statUpdates: [], weekScores: [], notification: null, affectedTeamIds: [], playoffResult: null, bestDay: null };

        const isPlayoff = week.is_playoff || matchup.playoff_round != null;
        const weights = scoringByLeague.get(matchup.league_id) ?? [];

        if (matchup.away_team_id === null) {
          return { statUpdates: [], weekScores: [], notification: null, affectedTeamIds: [], playoffResult: null, bestDay: null };
        }

        const scoringType = scoringTypeByLeague.get(matchup.league_id) ?? 'points';
        let winnerId: string | null = null;
        let homeScore = 0;
        let awayScore = 0;
        let homeCatWins: number | null = null;
        let awayCatWins: number | null = null;
        let catTies: number | null = null;
        let catResults: CategoryResult[] | null = null;
        let homePlayerScores: PlayerScoreEntry[] = [];
        let awayPlayerScores: PlayerScoreEntry[] = [];

        if (scoringType === 'h2h_categories') {
          const [homeResult, awayResult] = await Promise.all([
            computeTeamCategoryStats(matchup.home_team_id, matchup.league_id, week.start_date, week.end_date),
            computeTeamCategoryStats(matchup.away_team_id, matchup.league_id, week.start_date, week.end_date),
          ]);
          homePlayerScores = homeResult.playerScores;
          awayPlayerScores = awayResult.playerScores;
          const comparison = compareCategoryStats(homeResult.teamStats, awayResult.teamStats, weights);
          homeCatWins = comparison.homeWins;
          awayCatWins = comparison.awayWins;
          catTies = comparison.ties;
          catResults = comparison.results;
          if (comparison.homeWins > comparison.awayWins) winnerId = matchup.home_team_id;
          else if (comparison.awayWins > comparison.homeWins) winnerId = matchup.away_team_id;
        } else {
          const [homeResult, awayResult] = await Promise.all([
            computeTeamScore(matchup.home_team_id, matchup.league_id, week.start_date, week.end_date, weights),
            computeTeamScore(matchup.away_team_id, matchup.league_id, week.start_date, week.end_date, weights),
          ]);
          homeScore = homeResult.total;
          awayScore = awayResult.total;
          homePlayerScores = homeResult.playerScores;
          awayPlayerScores = awayResult.playerScores;
          if (homeScore > awayScore) winnerId = matchup.home_team_id;
          else if (awayScore > homeScore) winnerId = matchup.away_team_id;
        }

        // Write matchup result to DB
        await supabase
          .from("league_matchups")
          .update({
            home_score: homeScore,
            away_score: awayScore,
            home_category_wins: homeCatWins,
            away_category_wins: awayCatWins,
            category_ties: catTies,
            category_results: catResults,
            home_player_scores: homePlayerScores,
            away_player_scores: awayPlayerScores,
            winner_team_id: winnerId,
          })
          .eq("id", matchup.id);

        // Update playoff bracket if applicable
        let playoffResult: MatchupResult['playoffResult'] = null;
        if (isPlayoff && matchup.playoff_round != null) {
          await supabase
            .from('playoff_bracket')
            .update({ winner_id: winnerId })
            .eq('matchup_id', matchup.id);
          playoffResult = { leagueId: matchup.league_id, matchup_id: matchup.id, playoff_round: matchup.playoff_round, winner_id: winnerId };
        }

        // Build week_scores
        const now = new Date().toISOString();
        const weekScores = [
          { league_id: matchup.league_id, schedule_id: matchup.schedule_id, team_id: matchup.home_team_id, score: homeScore, updated_at: now },
          { league_id: matchup.league_id, schedule_id: matchup.schedule_id, team_id: matchup.away_team_id, score: awayScore, updated_at: now },
        ];

        // Build stat updates (regular season only)
        const statUpdates: MatchupResult['statUpdates'] = [];
        const affectedTeamIds: MatchupResult['affectedTeamIds'] = [];
        if (!isPlayoff) {
          if (winnerId === matchup.home_team_id) {
            statUpdates.push(
              { p_team_id: matchup.home_team_id, p_wins: 1, p_losses: 0, p_ties: 0, p_pf: 0, p_pa: 0 },
              { p_team_id: matchup.away_team_id, p_wins: 0, p_losses: 1, p_ties: 0, p_pf: 0, p_pa: 0 },
            );
          } else if (winnerId === matchup.away_team_id) {
            statUpdates.push(
              { p_team_id: matchup.away_team_id, p_wins: 1, p_losses: 0, p_ties: 0, p_pf: 0, p_pa: 0 },
              { p_team_id: matchup.home_team_id, p_wins: 0, p_losses: 1, p_ties: 0, p_pf: 0, p_pa: 0 },
            );
          } else {
            statUpdates.push(
              { p_team_id: matchup.home_team_id, p_wins: 0, p_losses: 0, p_ties: 1, p_pf: 0, p_pa: 0 },
              { p_team_id: matchup.away_team_id, p_wins: 0, p_losses: 0, p_ties: 1, p_pf: 0, p_pa: 0 },
            );
          }
          affectedTeamIds.push(
            { teamId: matchup.home_team_id, leagueId: matchup.league_id },
            { teamId: matchup.away_team_id, leagueId: matchup.league_id },
          );
        }

        // Track best scoring day (points scoring only)
        let bestDay: MatchupResult['bestDay'] = null;
        if (scoringType === 'points') {
          const season = week.start_date.slice(0, 4);
          for (const [tid, ps] of [[matchup.home_team_id, homePlayerScores], [matchup.away_team_id, awayPlayerScores]] as const) {
            const best = extractBestDay(ps as PlayerScoreEntry[]);
            if (best && (!bestDay || best.total > bestDay.value)) {
              bestDay = { leagueId: matchup.league_id, value: best.total, teamId: tid, date: best.date, season };
            }
          }
        }

        return {
          statUpdates,
          weekScores,
          notification: {
            leagueId: matchup.league_id,
            homeTeamId: matchup.home_team_id,
            awayTeamId: matchup.away_team_id,
            homeScore, awayScore, winnerId,
            isPlayoff, playoffRound: matchup.playoff_round,
            homeCatWins, awayCatWins, catTies, scoringType,
          },
          affectedTeamIds,
          playoffResult,
          bestDay,
        };
      }),
    );

    // Merge results from all parallel matchup tasks
    const pendingStatUpdates: Array<{ p_team_id: string; p_wins: number; p_losses: number; p_ties: number; p_pf: number; p_pa: number }> = [];
    const pendingWeekScores: Array<{ league_id: string; schedule_id: string; team_id: string; score: number; updated_at: string }> = [];
    const matchupResults: Array<NonNullable<MatchupResult['notification']>> = [];
    let finalizedCount = 0;

    for (const r of settled) {
      if (r.status === 'rejected') {
        console.error('Failed to finalize a matchup:', r.reason);
        continue;
      }
      const result = r.value;
      finalizedCount++;
      pendingStatUpdates.push(...result.statUpdates);
      pendingWeekScores.push(...result.weekScores);
      if (result.notification) matchupResults.push(result.notification);
      for (const { teamId, leagueId: lid } of result.affectedTeamIds) {
        affectedTeams.add(teamId);
        teamLeagueMap.set(teamId, lid);
      }
      if (result.playoffResult) {
        const { leagueId: lid, ...pr } = result.playoffResult;
        if (!playoffMatchupsFinalized.has(lid)) playoffMatchupsFinalized.set(lid, []);
        playoffMatchupsFinalized.get(lid)!.push(pr);
      }
      if (result.bestDay) {
        const prev = bestDayCandidates.get(result.bestDay.leagueId);
        if (!prev || result.bestDay.value > prev.value) {
          bestDayCandidates.set(result.bestDay.leagueId, result.bestDay);
        }
      }
    }

    // Flush all stat updates and week_scores upserts in parallel
    await Promise.all([
      ...pendingStatUpdates.map((params) => supabase.rpc("increment_team_stats", params)),
      pendingWeekScores.length > 0
        ? supabase.from("week_scores").upsert(pendingWeekScores, { onConflict: "league_id,schedule_id,team_id" })
        : Promise.resolve(),
    ]);

    // Update streaks for regular season teams in parallel
    if (affectedTeams.size > 0) {
      await Promise.all([...affectedTeams].map(async (teamId) => {
        const lid = teamLeagueMap.get(teamId)!;
        const streak = await computeStreak(teamId, lid);
        await supabase.from("teams").update({ streak }).eq("id", teamId);
      }));
    }

    // Mark stats as flushed so a crash-recovery re-run won't double-count
    const matchupIds = unfinalizedMatchups.map((m: any) => m.id);
    if (matchupIds.length > 0) {
      await supabase.from("league_matchups").update({ stats_flushed: true }).in("id", matchupIds);
    }

    // ── Upsert highest-scoring-day records (only if new value beats existing) ──
    if (bestDayCandidates.size > 0) {
      await Promise.all([...bestDayCandidates.entries()].map(async ([lid, candidate]) => {
        const { data: existing } = await supabase
          .from('league_records')
          .select('value')
          .eq('league_id', lid)
          .eq('record_type', 'highest_scoring_day')
          .single();

        if (!existing || candidate.value > Number(existing.value)) {
          await supabase.from('league_records').upsert({
            league_id: lid,
            record_type: 'highest_scoring_day',
            value: candidate.value,
            team_id: candidate.teamId,
            detail: candidate.date,
            season: candidate.season,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'league_id,record_type' });
        }
      }));
    }

    // ── Send matchup result notifications ──
    try {
      // Build team name + league name lookups
      const allTeamIds = new Set<string>();
      for (const r of matchupResults) {
        allTeamIds.add(r.homeTeamId);
        allTeamIds.add(r.awayTeamId);
      }
      const [{ data: teamRows }, { data: leagueRows }] = await Promise.all([
        supabase.from('teams').select('id, name').in('id', [...allTeamIds]),
        supabase.from('leagues').select('id, name, playoff_teams').in('id', leagueIds),
      ]);
      const teamName = new Map<string, string>(
        (teamRows ?? []).map((t: any) => [t.id, t.name]),
      );
      const leagueName = new Map<string, string>(
        (leagueRows ?? []).map((l: any) => [l.id, l.name]),
      );
      const leaguePlayoffTeams = new Map<string, number>(
        (leagueRows ?? []).map((l: any) => [l.id, l.playoff_teams ?? 8]),
      );

      // Map a playoff round number to a human-readable name
      function playoffRoundLabel(round: number, totalRounds: number): string {
        if (round >= totalRounds) return 'Championship';
        if (round === totalRounds - 1) return 'Semifinals';
        if (round === totalRounds - 2) return 'Quarterfinals';
        return `Playoff Round ${round}`;
      }

      await Promise.all(matchupResults.map(async (r) => {
        const homeName = teamName.get(r.homeTeamId) ?? 'Home';
        const awayName = teamName.get(r.awayTeamId) ?? 'Away';
        const category = r.isPlayoff ? 'playoffs' : 'matchups';
        const ln = leagueName.get(r.leagueId) ?? 'Your League';

        // Determine result for each side
        const homeWon = r.winnerId === r.homeTeamId;
        const awayWon = r.winnerId === r.awayTeamId;
        const tied = r.winnerId === null;

        if (r.isPlayoff && r.playoffRound != null) {
          // ── Playoff notification ──
          const totalRounds = calcRounds(leaguePlayoffTeams.get(r.leagueId) ?? 8);
          const roundName = playoffRoundLabel(r.playoffRound, totalRounds);
          const isChampionship = r.playoffRound >= totalRounds;
          const isSemis = r.playoffRound === totalRounds - 1;

          const scoreLine = r.scoringType === 'h2h_categories'
            ? `${r.homeCatWins ?? 0}-${r.awayCatWins ?? 0}${(r.catTies ?? 0) > 0 ? `-${r.catTies}` : ''}`
            : `${r.homeScore} - ${r.awayScore}`;

          function buildPlayoffBody(won: boolean, opponentName: string, isTied: boolean): string {
            if (isTied) return `Tied ${scoreLine} vs ${opponentName}. What a battle.`;
            if (isChampionship) {
              return won
                ? `You beat ${opponentName} ${scoreLine} and won the championship! \uD83C\uDFC6`
                : `${opponentName} wins ${scoreLine}. Tough loss in the finals.`;
            }
            if (won) {
              const next = isSemis ? 'On to the championship!' : 'You advance!';
              return `You beat ${opponentName} ${scoreLine}. ${next}`;
            }
            return `${opponentName} wins ${scoreLine}. Season over.`;
          }

          const homeBody = buildPlayoffBody(homeWon, awayName, tied);
          const awayBody = buildPlayoffBody(awayWon, homeName, tied);

          const icon = isChampionship ? '\uD83C\uDFC6' : '\uD83C\uDFC0';
          const title = `${icon} ${ln} \u2014 ${roundName}`;

          await Promise.all([
            notifyTeams(supabase, [r.homeTeamId], category,
              title, homeBody, { screen: 'playoff-bracket' },
              undefined, { subtitle: roundName, priority: 'high' }
            ),
            notifyTeams(supabase, [r.awayTeamId], category,
              title, awayBody, { screen: 'playoff-bracket' },
              undefined, { subtitle: roundName, priority: 'high' }
            ),
          ]);
        } else {
          // ── Regular-season notification ──
          const scoreLine = r.scoringType === 'h2h_categories'
            ? `${homeName} ${r.homeCatWins ?? 0}-${r.awayCatWins ?? 0}${(r.catTies ?? 0) > 0 ? `-${r.catTies}` : ''} ${awayName}`
            : `${homeName} ${r.homeScore} - ${r.awayScore} ${awayName}`;

          const homeResult = homeWon ? '\uD83D\uDD25 You won!' : awayWon ? 'You lost.' : 'It\'s a tie.';
          const awayResult = awayWon ? '\uD83D\uDD25 You won!' : homeWon ? 'You lost.' : 'It\'s a tie.';
          const title = `${ln} \u2014 Matchup Final`;

          await Promise.all([
            notifyTeams(supabase, [r.homeTeamId], category,
              title, `${scoreLine} \u2014 ${homeResult}`, { screen: 'matchup' }
            ),
            notifyTeams(supabase, [r.awayTeamId], category,
              title, `${scoreLine} \u2014 ${awayResult}`, { screen: 'matchup' }
            ),
          ]);
        }
      }));
    } catch (notifyErr) {
      console.warn('Matchup notification failed (non-fatal):', notifyErr);
    }

    // ── Post-processing: detect playoff transitions ──
    for (const lid of leagueIds) {
      const { data: league } = await supabase
        .from('leagues')
        .select('name, season, scoring_type, playoff_teams, playoff_seeding_format, reseed_each_round, regular_season_weeks')
        .eq('id', lid)
        .single();

      if (!league) continue;

      const { data: unfinalizedReg } = await supabase
        .from('league_matchups')
        .select('id')
        .eq('league_id', lid)
        .eq('is_finalized', false)
        .is('playoff_round', null)
        .limit(1);

      const allRegDone = !unfinalizedReg || unfinalizedReg.length === 0;

      if (allRegDone) {
        const { data: existingBracket } = await supabase
          .from('playoff_bracket')
          .select('id')
          .eq('league_id', lid)
          .eq('season', league.season)
          .limit(1);

        if (!existingBracket || existingBracket.length === 0) {
          const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-playoff-round`;
          await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            },
            body: JSON.stringify({ league_id: lid, round: 1 }),
          });
        }
      }

      const playoffFinalized = playoffMatchupsFinalized.get(lid);
      if (playoffFinalized && playoffFinalized.length > 0) {
        const maxRound = Math.max(...playoffFinalized.map(p => p.playoff_round));

        const { data: roundMatchups } = await supabase
          .from('league_matchups')
          .select('id, is_finalized')
          .eq('league_id', lid)
          .eq('playoff_round', maxRound);

        const allRoundDone = roundMatchups && roundMatchups.every((m: any) => m.is_finalized);

        if (allRoundDone) {
          const totalRounds = calcRounds(league.playoff_teams ?? 8);

          if (maxRound >= totalRounds) {
            // Championship round just finished — notify league
            // Query bracket to find the actual championship entry (not the 3rd place game)
            try {
              const { data: champBracket } = await supabase
                .from('playoff_bracket')
                .select('matchup_id')
                .eq('league_id', lid)
                .eq('season', league.season)
                .eq('round', maxRound)
                .eq('is_third_place', false)
                .not('matchup_id', 'is', null)
                .limit(1)
                .maybeSingle();

              const champMatchup = champBracket?.matchup_id
                ? playoffFinalized.find(p => p.matchup_id === champBracket.matchup_id && p.winner_id)
                : playoffFinalized.find(p => p.playoff_round === maxRound && p.winner_id);

              if (champMatchup?.winner_id) {
                const { data: champTeam } = await supabase
                  .from('teams')
                  .select('name')
                  .eq('id', champMatchup.winner_id)
                  .single();
                const champName = champTeam?.name ?? 'The champion';
                const champLn = league?.name ?? 'Your League';
                await notifyLeague(supabase, lid, 'playoffs',
                  `\uD83C\uDFC6 ${champLn} \u2014 We Have a Champion!`,
                  `${champName} has won the league championship!`,
                  { screen: 'playoff-bracket' },
                  undefined, { subtitle: 'Championship', priority: 'high' }
                );
              }
            } catch (champErr) {
              console.warn('Championship notification failed (non-fatal):', champErr);
            }
          } else {
            const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-playoff-round`;
            await fetch(url, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
              },
              body: JSON.stringify({ league_id: lid, round: maxRound + 1 }),
            });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        finalized: finalizedCount,
        leagues: leagueIds.length,
        teamsUpdated: affectedTeams.size,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("Unhandled error in finalize-week:", err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
