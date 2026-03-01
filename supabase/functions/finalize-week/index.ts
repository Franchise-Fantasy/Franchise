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
  FGM: "fgm",
  FGA: "fga",
  FTM: "ftm",
  FTA: "fta",
  PF: "pf",
};

interface ScoringWeight {
  stat_name: string;
  point_value: number;
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
      'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", ftm, fta, pf, game_date',
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
    if (slot === "BE" || slot === "IR") continue;
    teamTotal += calculateGameFpts(game as any, weights);
  }

  return Math.round(teamTotal * 100) / 100;
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

    for (const lid of leagueIds) {
      const { data: scoring } = await supabase
        .from("league_scoring_settings")
        .select("stat_name, point_value")
        .eq("league_id", lid);
      scoringByLeague.set(lid, scoring ?? []);
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

      const [homeScore, awayScore] = await Promise.all([
        computeTeamScore(
          matchup.home_team_id,
          matchup.league_id,
          week.start_date,
          week.end_date,
          weights,
        ),
        computeTeamScore(
          matchup.away_team_id,
          matchup.league_id,
          week.start_date,
          week.end_date,
          weights,
        ),
      ]);

      let winnerId: string | null = null;
      if (homeScore > awayScore) winnerId = matchup.home_team_id;
      else if (awayScore > homeScore) winnerId = matchup.away_team_id;

      await supabase
        .from("league_matchups")
        .update({
          home_score: homeScore,
          away_score: awayScore,
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
      });

      if (!isPlayoff) {
        if (winnerId === matchup.home_team_id) {
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.home_team_id,
            p_wins: 1, p_losses: 0, p_ties: 0,
            p_pf: homeScore, p_pa: awayScore,
          });
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.away_team_id,
            p_wins: 0, p_losses: 1, p_ties: 0,
            p_pf: awayScore, p_pa: homeScore,
          });
        } else if (winnerId === matchup.away_team_id) {
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.away_team_id,
            p_wins: 1, p_losses: 0, p_ties: 0,
            p_pf: awayScore, p_pa: homeScore,
          });
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.home_team_id,
            p_wins: 0, p_losses: 1, p_ties: 0,
            p_pf: homeScore, p_pa: awayScore,
          });
        } else {
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.home_team_id,
            p_wins: 0, p_losses: 0, p_ties: 1,
            p_pf: homeScore, p_pa: awayScore,
          });
          await supabase.rpc("increment_team_stats", {
            p_team_id: matchup.away_team_id,
            p_wins: 0, p_losses: 0, p_ties: 1,
            p_pf: awayScore, p_pa: homeScore,
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
        const scoreLine = `${homeName} ${r.homeScore} - ${r.awayScore} ${awayName}`;
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
        .select('name, season, playoff_teams, playoff_seeding_format, reseed_each_round, regular_season_weeks')
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
