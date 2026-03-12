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

function resolveSlot(
  dailyEntries: Array<{ lineup_date: string; roster_slot: string }>,
  day: string,
  defaultSlot: string,
): string {
  const entry = dailyEntries.find((e) => e.lineup_date <= day);
  return entry?.roster_slot ?? defaultSlot;
}

async function computeTeamScore(
  teamId: string,
  leagueId: string,
  startDate: string,
  endDate: string,
  weights: ScoringWeight[],
): Promise<number> {
  const { data: leaguePlayers, error: lpErr } = await supabase
    .from("league_players")
    .select("player_id, roster_slot")
    .eq("team_id", teamId)
    .eq("league_id", leagueId);

  if (lpErr || !leaguePlayers || leaguePlayers.length === 0) return 0;

  const playerIds = leaguePlayers.map((lp: any) => lp.player_id);
  const defaultSlotMap = new Map<string, string>(
    leaguePlayers.map((lp: any) => [lp.player_id, lp.roster_slot ?? "BE"]),
  );

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
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) {
      dailyByPlayer.set(entry.player_id, []);
    }
    dailyByPlayer.get(entry.player_id)!.push(entry);
  }

  const { data: gameLogs } = await supabase
    .from("player_games")
    .select(
      'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date',
    )
    .in("player_id", playerIds)
    .gte("game_date", startDate)
    .lte("game_date", endDate);

  let teamTotal = 0;
  for (const game of gameLogs ?? []) {
    const slot = resolveSlot(
      dailyByPlayer.get(game.player_id) ?? [],
      game.game_date,
      defaultSlotMap.get(game.player_id) ?? "BE",
    );
    if (slot === "BE" || slot === "IR" || slot === "TAXI") continue;
    teamTotal += calculateGameFpts(game as any, weights);
  }

  return Math.round(teamTotal * 100) / 100;
}

async function computeTeamCategoryStats(
  teamId: string,
  leagueId: string,
  startDate: string,
  endDate: string,
): Promise<Record<string, number>> {
  const { data: leaguePlayers } = await supabase
    .from("league_players")
    .select("player_id, roster_slot")
    .eq("team_id", teamId)
    .eq("league_id", leagueId);

  if (!leaguePlayers || leaguePlayers.length === 0) return {};

  const playerIds = leaguePlayers.map((lp: any) => lp.player_id);
  const defaultSlotMap = new Map<string, string>(
    leaguePlayers.map((lp: any) => [lp.player_id, lp.roster_slot ?? "BE"]),
  );

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
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) {
      dailyByPlayer.set(entry.player_id, []);
    }
    dailyByPlayer.get(entry.player_id)!.push(entry);
  }

  const { data: gameLogs } = await supabase
    .from("player_games")
    .select(
      'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date',
    )
    .in("player_id", playerIds)
    .gte("game_date", startDate)
    .lte("game_date", endDate);

  // Filter to active-slot games then aggregate raw stats
  const activeGames: Record<string, any>[] = [];
  for (const game of gameLogs ?? []) {
    const slot = resolveSlot(
      dailyByPlayer.get(game.player_id) ?? [],
      game.game_date,
      defaultSlotMap.get(game.player_id) ?? "BE",
    );
    if (slot === "BE" || slot === "IR" || slot === "TAXI") continue;
    activeGames.push(game);
  }

  return aggregateGameStats(activeGames);
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

function calcRounds(playoffTeams: number): number {
  let p = 1;
  while (p < playoffTeams) p *= 2;
  return Math.log2(p);
}

Deno.serve(async (req: Request) => {
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

    const { data: unfinalizedMatchups, error: matchErr } = await supabase
      .from("league_matchups")
      .select("id, league_id, schedule_id, week_number, home_team_id, away_team_id, playoff_round")
      .in("schedule_id", scheduleIds)
      .eq("is_finalized", false);

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

    for (const lid of leagueIds) {
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
    }

    let finalizedCount = 0;
    const affectedTeams = new Set<string>();
    const teamLeagueMap = new Map<string, string>();
    const playoffMatchupsFinalized = new Map<string, Array<{ matchup_id: string; playoff_round: number; winner_id: string | null }>>();

    // Collect matchup results for notifications
    const matchupResults: Array<{
      leagueId: string;
      homeTeamId: string;
      awayTeamId: string;
      homeScore: number;
      awayScore: number;
      winnerId: string | null;
      isPlayoff: boolean;
      playoffRound: number | null;
      homeCatWins?: number | null;
      awayCatWins?: number | null;
      catTies?: number | null;
      scoringType?: string;
    }> = [];

    for (const matchup of unfinalizedMatchups) {
      const week = scheduleMap.get(matchup.schedule_id);
      if (!week) continue;

      const isPlayoff = week.is_playoff || matchup.playoff_round != null;
      const weights = scoringByLeague.get(matchup.league_id) ?? [];

      if (matchup.away_team_id === null) {
        await supabase
          .from("league_matchups")
          .update({ is_finalized: true })
          .eq("id", matchup.id);
        finalizedCount++;
        continue;
      }

      const scoringType = scoringTypeByLeague.get(matchup.league_id) ?? 'points';
      let winnerId: string | null = null;
      let homeScore = 0;
      let awayScore = 0;
      let homeCatWins: number | null = null;
      let awayCatWins: number | null = null;
      let catTies: number | null = null;
      let catResults: CategoryResult[] | null = null;

      if (scoringType === 'h2h_categories') {
        // Category scoring — compare raw stats per category
        const [homeStats, awayStats] = await Promise.all([
          computeTeamCategoryStats(matchup.home_team_id, matchup.league_id, week.start_date, week.end_date),
          computeTeamCategoryStats(matchup.away_team_id, matchup.league_id, week.start_date, week.end_date),
        ]);
        const comparison = compareCategoryStats(homeStats, awayStats, weights);
        homeCatWins = comparison.homeWins;
        awayCatWins = comparison.awayWins;
        catTies = comparison.ties;
        catResults = comparison.results;

        if (comparison.homeWins > comparison.awayWins) winnerId = matchup.home_team_id;
        else if (comparison.awayWins > comparison.homeWins) winnerId = matchup.away_team_id;
      } else {
        // Points scoring — existing logic
        [homeScore, awayScore] = await Promise.all([
          computeTeamScore(matchup.home_team_id, matchup.league_id, week.start_date, week.end_date, weights),
          computeTeamScore(matchup.away_team_id, matchup.league_id, week.start_date, week.end_date, weights),
        ]);
        if (homeScore > awayScore) winnerId = matchup.home_team_id;
        else if (awayScore > homeScore) winnerId = matchup.away_team_id;
      }

      await supabase
        .from("league_matchups")
        .update({
          home_score: scoringType === 'points' ? homeScore : null,
          away_score: scoringType === 'points' ? awayScore : null,
          home_category_wins: homeCatWins,
          away_category_wins: awayCatWins,
          category_ties: catTies,
          category_results: catResults,
          winner_team_id: winnerId,
          is_finalized: true,
        })
        .eq("id", matchup.id);

      matchupResults.push({
        leagueId: matchup.league_id,
        homeTeamId: matchup.home_team_id,
        awayTeamId: matchup.away_team_id,
        homeScore,
        awayScore,
        winnerId,
        isPlayoff,
        playoffRound: matchup.playoff_round,
        homeCatWins,
        awayCatWins,
        catTies,
        scoringType,
      });

      if (!isPlayoff) {
        // For category leagues, store category wins/losses as PF/PA for tiebreaking
        const homePF = scoringType === 'h2h_categories' ? (homeCatWins ?? 0) : homeScore;
        const homePa = scoringType === 'h2h_categories' ? (awayCatWins ?? 0) : awayScore;
        const awayPF = scoringType === 'h2h_categories' ? (awayCatWins ?? 0) : awayScore;
        const awayPa = scoringType === 'h2h_categories' ? (homeCatWins ?? 0) : homeScore;

        if (winnerId === matchup.home_team_id) {
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.home_team_id,
            p_wins: 1, p_losses: 0, p_ties: 0,
            p_pf: homePF, p_pa: homePa,
          });
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.away_team_id,
            p_wins: 0, p_losses: 1, p_ties: 0,
            p_pf: awayPF, p_pa: awayPa,
          });
        } else if (winnerId === matchup.away_team_id) {
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.away_team_id,
            p_wins: 1, p_losses: 0, p_ties: 0,
            p_pf: awayPF, p_pa: awayPa,
          });
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.home_team_id,
            p_wins: 0, p_losses: 1, p_ties: 0,
            p_pf: homePF, p_pa: homePa,
          });
        } else {
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.home_team_id,
            p_wins: 0, p_losses: 0, p_ties: 1,
            p_pf: homePF, p_pa: homePa,
          });
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.away_team_id,
            p_wins: 0, p_losses: 0, p_ties: 1,
            p_pf: awayPF, p_pa: awayPa,
          });
        }

        affectedTeams.add(matchup.home_team_id);
        affectedTeams.add(matchup.away_team_id);
        teamLeagueMap.set(matchup.home_team_id, matchup.league_id);
        teamLeagueMap.set(matchup.away_team_id, matchup.league_id);
      }

      if (isPlayoff && matchup.playoff_round != null) {
        await supabase
          .from('playoff_bracket')
          .update({ winner_id: winnerId })
          .eq('matchup_id', matchup.id);

        if (!playoffMatchupsFinalized.has(matchup.league_id)) {
          playoffMatchupsFinalized.set(matchup.league_id, []);
        }
        playoffMatchupsFinalized.get(matchup.league_id)!.push({
          matchup_id: matchup.id,
          playoff_round: matchup.playoff_round,
          winner_id: winnerId,
        });
      }

      finalizedCount++;
    }

    // Update streaks for regular season teams
    for (const teamId of affectedTeams) {
      const lid = teamLeagueMap.get(teamId)!;
      const streak = await computeStreak(teamId, lid);
      await supabase.from("teams").update({ streak }).eq("id", teamId);
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
        supabase.from('leagues').select('id, name').in('id', leagueIds),
      ]);
      const teamName = new Map<string, string>(
        (teamRows ?? []).map((t: any) => [t.id, t.name]),
      );
      const leagueName = new Map<string, string>(
        (leagueRows ?? []).map((l: any) => [l.id, l.name]),
      );

      for (const r of matchupResults) {
        const homeName = teamName.get(r.homeTeamId) ?? 'Home';
        const awayName = teamName.get(r.awayTeamId) ?? 'Away';
        const scoreLine = r.scoringType === 'h2h_categories'
          ? `${homeName} ${r.homeCatWins ?? 0}-${r.awayCatWins ?? 0}${(r.catTies ?? 0) > 0 ? `-${r.catTies}` : ''} ${awayName}`
          : `${homeName} ${r.homeScore} - ${r.awayScore} ${awayName}`;
        const category = r.isPlayoff ? 'playoffs' : 'matchups';
        const ln = leagueName.get(r.leagueId) ?? 'Your League';

        // Notify both teams with their result
        const homeResult = r.winnerId === r.homeTeamId ? 'You won!' : r.winnerId === r.awayTeamId ? 'You lost.' : 'It\'s a tie.';
        const awayResult = r.winnerId === r.awayTeamId ? 'You won!' : r.winnerId === r.homeTeamId ? 'You lost.' : 'It\'s a tie.';

        const title = r.isPlayoff ? `${ln} — Playoff Matchup Final` : `${ln} — Matchup Final`;

        await notifyTeams(supabase, [r.homeTeamId], category,
          title,
          `${scoreLine} — ${homeResult}`,
          { screen: r.isPlayoff ? 'playoff-bracket' : 'matchup' }
        );
        await notifyTeams(supabase, [r.awayTeamId], category,
          title,
          `${scoreLine} — ${awayResult}`,
          { screen: r.isPlayoff ? 'playoff-bracket' : 'matchup' }
        );
      }
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
            try {
              const champMatchup = playoffFinalized.find(p => p.playoff_round === maxRound && p.winner_id);
              if (champMatchup?.winner_id) {
                const { data: champTeam } = await supabase
                  .from('teams')
                  .select('name')
                  .eq('id', champMatchup.winner_id)
                  .single();
                const champName = champTeam?.name ?? 'The champion';
                const champLn = league?.name ?? 'Your League';
                await notifyLeague(supabase, lid, 'playoffs',
                  `${champLn} — Championship Winner!`,
                  `${champName} has won the league championship!`,
                  { screen: 'playoff-bracket' }
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
