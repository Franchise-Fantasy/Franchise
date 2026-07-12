import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyTeams } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { errorResponse, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';
import {
  nextRoundOpponentPool,
  resolvePendingSeedPicks,
  round1OpponentPool,
  type SeedEntry,
} from '../../../utils/playoff/seedPickAutoResolve.ts';

const Body = z.object({
  league_id: z.string().uuid(),
  round: z.number().int().positive('round must be a positive integer').optional(),
  from_seed_picks: z.boolean().optional(),
  // When set (by the resolve-stale-seed-picks cron), any pick a manager never
  // made is auto-filled with the lowest available seed before pairing, so a
  // never-chosen opponent can't stall the whole bracket indefinitely.
  auto_resolve_picks: z.boolean().optional(),
});

// ── Bracket utilities ──

function nextPowerOf2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function calcByes(playoffTeams: number): number {
  return nextPowerOf2(playoffTeams) - playoffTeams;
}

function calcRounds(playoffTeams: number): number {
  return Math.log2(nextPowerOf2(playoffTeams));
}

interface BracketPairing { teamA: SeedEntry; teamB: SeedEntry | null; }

function generateBracketPositions(n: number): number[] {
  if (n === 1) return [1];
  const half = generateBracketPositions(n / 2);
  const result: number[] = [];
  for (const h of half) {
    result.push(h, n + 1 - h);
  }
  return result;
}

function buildRound1(seeds: SeedEntry[]): BracketPairing[] {
  const n = nextPowerOf2(seeds.length);
  const positions = generateBracketPositions(n);
  const seedMap = new Map<number, SeedEntry>();
  for (const s of seeds) seedMap.set(s.seed, s);

  const matchups: BracketPairing[] = [];
  for (let i = 0; i < n; i += 2) {
    const a = seedMap.get(positions[i]) ?? null;
    const b = seedMap.get(positions[i + 1]) ?? null;
    if (a && b) {
      matchups.push(a.seed < b.seed ? { teamA: a, teamB: b } : { teamA: b, teamB: a });
    } else if (a) {
      matchups.push({ teamA: a, teamB: null });
    } else if (b) {
      matchups.push({ teamA: b, teamB: null });
    }
  }
  return matchups;
}

function buildStandardRound1(seeds: SeedEntry[]): BracketPairing[] {
  return buildRound1(seeds);
}

function buildFixedRound1(seeds: SeedEntry[]): BracketPairing[] {
  return buildRound1(seeds);
}

interface RoundResult {
  bracket_position: number;
  winner_id: string;
  winner_seed: number;
}

function buildNextRoundPairings(
  format: string,
  reseed: boolean,
  results: RoundResult[],
): BracketPairing[] | null {
  if (format === 'higher_seed_picks') return null;

  if (format === 'standard' && reseed) {
    const sorted = [...results].sort((a, b) => a.winner_seed - b.winner_seed);
    const matchups: BracketPairing[] = [];
    for (let i = 0; i < sorted.length / 2; i++) {
      matchups.push({
        teamA: { teamId: sorted[i].winner_id, seed: sorted[i].winner_seed },
        teamB: {
          teamId: sorted[sorted.length - 1 - i].winner_id,
          seed: sorted[sorted.length - 1 - i].winner_seed,
        },
      });
    }
    return matchups;
  }

  const sorted = [...results].sort((a, b) => a.bracket_position - b.bracket_position);
  const matchups: BracketPairing[] = [];
  for (let i = 0; i < sorted.length; i += 2) {
    matchups.push({
      teamA: { teamId: sorted[i].winner_id, seed: sorted[i].winner_seed },
      teamB: {
        teamId: sorted[i + 1].winner_id,
        seed: sorted[i + 1].winner_seed,
      },
    });
  }
  return matchups;
}

/**
 * Persist the auto-default assignments produced by `resolvePendingSeedPicks`
 * (lowest available seed to each un-made pick) and mutate `picks` in place so
 * the downstream pairing loop sees the filled opponents. Called when the pick
 * window has elapsed and the bracket must proceed regardless of who chose.
 */
async function autoAssignPendingPicks(
  supabase: SupabaseClient,
  picks: Array<{ id: string; picking_seed: number; picked_opponent_id: string | null }>,
  opponentPool: SeedEntry[],
): Promise<void> {
  const assignments = resolvePendingSeedPicks(picks, opponentPool);
  if (assignments.length === 0) return;

  const byId = new Map(picks.map((p) => [p.id, p]));
  const nowIso = new Date().toISOString();
  for (const { pickId, opponentId } of assignments) {
    const pick = byId.get(pickId);
    if (pick) pick.picked_opponent_id = opponentId;
    await supabase
      .from('playoff_seed_picks')
      .update({ picked_opponent_id: opponentId, picked_at: nowIso })
      .eq('id', pickId);
  }
}

// ── Main handler ──

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SB_SECRET_KEY')!
    );

    const { league_id, round: requestedRound, from_seed_picks, auto_resolve_picks } = parseBody(Body, await req.json());

    // Allow internal service-role calls (from finalize-week, submit-seed-pick, self-recursive)
    // but require JWT + commissioner check for external calls
    const authHeader = req.headers.get('Authorization');
    const isServiceRole = authHeader === `Bearer ${Deno.env.get('SB_SECRET_KEY')}`;

    if (!isServiceRole) {
      if (!authHeader) return errorResponse('Missing authorization', 401);
      const user = await requireUser(req);

      const rateLimited = await checkRateLimit(supabase, user.id, 'generate-playoff-round');
      if (rateLimited) return rateLimited;

      const { data: commCheck } = await supabase
        .from('leagues').select('created_by').eq('id', league_id).single();
      if (!commCheck || commCheck.created_by !== user.id) {
        return errorResponse('Only the commissioner can generate playoff rounds', 403);
      }
    }

    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .select('id, name, season, playoff_teams, playoff_weeks, regular_season_weeks, playoff_seeding_format, reseed_each_round, tiebreaker_order, division_count')
      .eq('id', league_id)
      .single();

    if (leagueErr || !league) return errorResponse('League not found', 404);

    const playoffTeams = league.playoff_teams ?? 8;
    const totalRounds = calcRounds(playoffTeams);
    const format = league.playoff_seeding_format ?? 'standard';
    const reseed = league.reseed_each_round ?? false;

    const round = requestedRound ?? 1;
    if (round > totalRounds) {
      return errorResponse(`round ${round} exceeds total playoff rounds (${totalRounds})`, 400);
    }

    const { data: playoffWeeks } = await supabase
      .from('league_schedule')
      .select('id, week_number')
      .eq('league_id', league_id)
      .eq('is_playoff', true)
      .order('week_number', { ascending: true });

    if (!playoffWeeks || playoffWeeks.length === 0) {
      return errorResponse('No playoff weeks in schedule', 400);
    }

    const { data: existingBracket } = await supabase
      .from('playoff_bracket')
      .select('id')
      .eq('league_id', league_id)
      .eq('season', league.season)
      .eq('round', round)
      .limit(1);

    if (existingBracket && existingBracket.length > 0) {
      return errorResponse(`Round ${round} already generated`, 409);
    }

    let pairings: BracketPairing[] = [];
    let prevBracket: any[] | null = null;

    if (round === 1) {
      const { data: teams } = await supabase
        .from('teams')
        .select('id, wins, losses, ties, points_for, division')
        .eq('league_id', league_id)
        .order('wins', { ascending: false })
        .order('points_for', { ascending: false });

      if (!teams || teams.length < 2) return errorResponse('Not enough teams', 400);

      // Apply tiebreaker resolution
      const tiebreakerOrder: string[] = league.tiebreaker_order ?? ['head_to_head', 'points_for'];

      // Helper: rank a list of teams using tiebreaker logic
      function rankTeams(teamList: typeof teams): typeof teams {
        let ranked = teamList;

        if (tiebreakerOrder.includes('head_to_head') && h2hMatchups) {
          const wpct = (t: typeof teamList[0]) => {
            const gp = t.wins + t.losses + t.ties;
            return gp === 0 ? 0 : (t.wins + t.ties * 0.5) / gp;
          };
          const sorted = [...teamList].sort((a, b) => wpct(b) - wpct(a));
          const groups: (typeof teamList)[] = [];
          let currentGroup = [sorted[0]];
          for (let i = 1; i < sorted.length; i++) {
            if (wpct(sorted[i]) === wpct(sorted[i - 1])) {
              currentGroup.push(sorted[i]);
            } else {
              groups.push(currentGroup);
              currentGroup = [sorted[i]];
            }
          }
          groups.push(currentGroup);

          ranked = [];
          for (const group of groups) {
            if (group.length === 1) { ranked.push(group[0]); continue; }
            group.sort((a, b) => {
              for (const method of tiebreakerOrder) {
                let cmp = 0;
                if (method === 'head_to_head') cmp = getH2HWins(b.id, group) - getH2HWins(a.id, group);
                else if (method === 'points_for') cmp = b.points_for - a.points_for;
                if (cmp !== 0) return cmp;
              }
              return 0;
            });
            ranked.push(...group);
          }
        }
        return ranked;
      }

      // Fetch H2H matchups if needed
      let h2hMatchups: any[] | null = null;
      const h2hWins = new Map<string, number>();
      const h2hKey = (a: string, b: string) => `${a}:${b}`;

      if (tiebreakerOrder.includes('head_to_head')) {
        const { data: matchups } = await supabase
          .from('league_matchups')
          .select('home_team_id, away_team_id, winner_team_id')
          .eq('league_id', league_id)
          .eq('is_finalized', true)
          .is('playoff_round', null);

        h2hMatchups = matchups ?? [];
        for (const m of h2hMatchups) {
          if (!m.away_team_id || !m.winner_team_id) continue;
          const loserId = m.home_team_id === m.winner_team_id ? m.away_team_id : m.home_team_id;
          h2hWins.set(h2hKey(m.winner_team_id, loserId), (h2hWins.get(h2hKey(m.winner_team_id, loserId)) ?? 0) + 1);
        }
      }

      const getH2HWins = (teamId: string, group: typeof teams) => {
        let wins = 0;
        for (const other of group) {
          if (other.id === teamId) continue;
          wins += h2hWins.get(h2hKey(teamId, other.id)) ?? 0;
        }
        return wins;
      };

      let seeds: SeedEntry[];

      if (league.division_count === 2) {
        // Division-based seeding: division winners get seeds 1 & 2
        const div1Teams = teams.filter(t => t.division === 1);
        const div2Teams = teams.filter(t => t.division === 2);

        const div1Ranked = rankTeams(div1Teams);
        const div2Ranked = rankTeams(div2Teams);

        const div1Winner = div1Ranked[0];
        const div2Winner = div2Ranked[0];

        // Determine which division winner gets seed 1 (better record by win%)
        let seed1: typeof teams[0], seed2: typeof teams[0];
        const div1Pct = wpct(div1Winner);
        const div2Pct = wpct(div2Winner);
        if (div1Pct > div2Pct) {
          seed1 = div1Winner; seed2 = div2Winner;
        } else if (div2Pct > div1Pct) {
          seed1 = div2Winner; seed2 = div1Winner;
        } else {
          // Tied on win% — use tiebreaker between the two
          const ranked = rankTeams([div1Winner, div2Winner]);
          seed1 = ranked[0]; seed2 = ranked[1];
        }

        // Remaining spots: all other teams ranked by overall record (wild card)
        const divWinnerIds = new Set([seed1.id, seed2.id]);
        const remainingTeams = teams.filter(t => !divWinnerIds.has(t.id));
        const rankedRemaining = rankTeams(remainingTeams);

        // Build seeds: division winners first, then wild cards
        const seeded = [seed1, seed2, ...rankedRemaining.slice(0, playoffTeams - 2)];
        seeds = seeded.map((t, i) => ({ teamId: t.id, seed: i + 1 }));
      } else {
        // Standard seeding: rank all teams together
        const rankedTeams = rankTeams(teams);
        seeds = rankedTeams
          .slice(0, playoffTeams)
          .map((t, i) => ({ teamId: t.id, seed: i + 1 }));
      }

      if (format === 'higher_seed_picks' && !from_seed_picks) {
        const byes = calcByes(playoffTeams);
        const playingSeeds = seeds.slice(byes);
        const halfCount = playingSeeds.length / 2;
        const pickers = playingSeeds.slice(0, halfCount);

        const round1Pairings = buildRound1(seeds);
        const byeBracketRows = round1Pairings
          .map((p, i) => ({ pairing: p, pos: i + 1 }))
          .filter(({ pairing }) => pairing.teamB === null)
          .map(({ pairing, pos }) => ({
            league_id,
            season: league.season,
            round: 1,
            bracket_position: pos,
            team_a_id: pairing.teamA.teamId,
            team_a_seed: pairing.teamA.seed,
            team_b_id: null,
            team_b_seed: null,
            winner_id: pairing.teamA.teamId,
            is_bye: true,
            is_third_place: false,
          }));

        if (byeBracketRows.length > 0) {
          await supabase.from('playoff_bracket').insert(byeBracketRows);
        }

        const pickRows = pickers.map(s => ({
          league_id,
          season: league.season,
          round: 1,
          picking_team_id: s.teamId,
          picking_seed: s.seed,
        }));

        await supabase.from('playoff_seed_picks').insert(pickRows);

        // Notify the first seed picker
        try {
          const firstPicker = pickers.sort((a, b) => a.seed - b.seed)[0];
          if (firstPicker) {
            const ln = league.name ?? 'Your League';
            await notifyTeams(supabase, [firstPicker.teamId], 'playoffs',
              `${ln} — Your Seed Pick Turn`,
              'It\'s your turn to choose your playoff opponent.',
              { screen: 'playoff-bracket' }
            );
          }
        } catch (notifyErr) {
          console.warn('Seed pick notification failed (non-fatal):', notifyErr);
        }

        return jsonResponse({
          success: true,
          action: 'seed_picks_created',
          round: 1,
          pickers: pickers.map(p => p.seed),
          byes: byes,
        });
      }

      if (format === 'higher_seed_picks' && from_seed_picks) {
        const { data: picks } = await supabase
          .from('playoff_seed_picks')
          .select('id, picking_team_id, picking_seed, picked_opponent_id')
          .eq('league_id', league_id)
          .eq('season', league.season)
          .eq('round', 1)
          .order('picking_seed', { ascending: true });

        if (!picks) return errorResponse('No seed picks found', 400);

        const seedMap = new Map(seeds.map(s => [s.teamId, s]));

        if (auto_resolve_picks) {
          await autoAssignPendingPicks(supabase, picks, round1OpponentPool(seeds, calcByes(playoffTeams)));
        }

        for (const pick of picks) {
          if (!pick.picked_opponent_id) return errorResponse('Not all picks completed', 400);
          const picker = seedMap.get(pick.picking_team_id)!;
          const opponent = seedMap.get(pick.picked_opponent_id)!;
          pairings.push({ teamA: picker, teamB: opponent });
        }
      } else {
        pairings = format === 'fixed'
          ? buildFixedRound1(seeds)
          : buildStandardRound1(seeds);
      }
    } else {
      const { data: prevBracketData } = await supabase
        .from('playoff_bracket')
        .select('bracket_position, winner_id, team_a_seed, team_b_seed, team_a_id, team_b_id, is_bye, is_third_place')
        .eq('league_id', league_id)
        .eq('season', league.season)
        .eq('round', round - 1)
        .eq('is_third_place', false)
        .order('bracket_position', { ascending: true });
      prevBracket = prevBracketData;

      if (!prevBracket || prevBracket.length === 0) {
        return errorResponse(`Previous round ${round - 1} not found`, 400);
      }

      const unresolved = prevBracket.filter(b => !b.winner_id);
      if (unresolved.length > 0) {
        return errorResponse(`Previous round has ${unresolved.length} unresolved matchups`, 400);
      }

      if (format === 'higher_seed_picks' && !from_seed_picks) {
        const winners = prevBracket.map(b => {
          const winnerSeed = b.winner_id === b.team_a_id ? b.team_a_seed : b.team_b_seed;
          return { teamId: b.winner_id!, seed: winnerSeed! };
        }).sort((a, b) => a.seed - b.seed);

        const halfCount = winners.length / 2;
        const pickers = winners.slice(0, halfCount);

        const pickRows = pickers.map(s => ({
          league_id,
          season: league.season,
          round,
          picking_team_id: s.teamId,
          picking_seed: s.seed,
        }));

        await supabase.from('playoff_seed_picks').insert(pickRows);

        // Notify the first seed picker for this round
        try {
          const firstPicker = pickers[0];
          if (firstPicker) {
            const ln = league.name ?? 'Your League';
            await notifyTeams(supabase, [firstPicker.teamId], 'playoffs',
              `${ln} — Your Seed Pick Turn`,
              'It\'s your turn to choose your playoff opponent.',
              { screen: 'playoff-bracket' }
            );
          }
        } catch (notifyErr) {
          console.warn('Seed pick notification failed (non-fatal):', notifyErr);
        }

        return jsonResponse({
          success: true,
          action: 'seed_picks_created',
          round,
          pickers: pickers.map(p => p.seed),
        });
      }

      if (format === 'higher_seed_picks' && from_seed_picks) {
        const { data: picks } = await supabase
          .from('playoff_seed_picks')
          .select('id, picking_team_id, picking_seed, picked_opponent_id')
          .eq('league_id', league_id)
          .eq('season', league.season)
          .eq('round', round)
          .order('picking_seed', { ascending: true });

        if (!picks) return errorResponse('No seed picks found', 400);

        const allBracket = await supabase
          .from('playoff_bracket')
          .select('team_a_id, team_a_seed, team_b_id, team_b_seed, winner_id')
          .eq('league_id', league_id)
          .eq('season', league.season);

        const seedLookup = new Map<string, number>();
        for (const b of allBracket.data ?? []) {
          if (b.team_a_id && b.team_a_seed) seedLookup.set(b.team_a_id, b.team_a_seed);
          if (b.team_b_id && b.team_b_seed) seedLookup.set(b.team_b_id, b.team_b_seed);
        }

        if (auto_resolve_picks) {
          // Pool = the previous round's winners (their seeds carried forward);
          // nextRoundOpponentPool takes the bottom half — the pickers are the top.
          const winners = (prevBracket ?? [])
            .filter((b) => !b.is_bye && b.winner_id)
            .map((b) => ({
              teamId: b.winner_id as string,
              seed: (b.winner_id === b.team_a_id ? b.team_a_seed : b.team_b_seed) as number,
            }));
          await autoAssignPendingPicks(supabase, picks, nextRoundOpponentPool(winners));
        }

        for (const pick of picks) {
          if (!pick.picked_opponent_id) return errorResponse('Not all picks completed', 400);
          pairings.push({
            teamA: { teamId: pick.picking_team_id, seed: pick.picking_seed },
            teamB: {
              teamId: pick.picked_opponent_id,
              seed: seedLookup.get(pick.picked_opponent_id) ?? 0,
            },
          });
        }
      } else {
        const results: RoundResult[] = prevBracket.map(b => ({
          bracket_position: b.bracket_position,
          winner_id: b.winner_id!,
          winner_seed: b.winner_id === b.team_a_id ? b.team_a_seed! : b.team_b_seed!,
        }));

        const built = buildNextRoundPairings(format, reseed, results);
        if (!built) return errorResponse('Could not build next round', 500);
        pairings = built;
      }
    }

    // ── Insert bracket entries + matchup rows (atomically via RPC) ──

    const scheduleWeek = playoffWeeks[round - 1];
    if (!scheduleWeek) return errorResponse(`No schedule week for round ${round}`, 400);

    // bracket_position is 1-indexed by pairing order; byes carry no team_b.
    const pairingPayload = pairings.map((p, i) => ({
      bracket_position: i + 1,
      team_a_id: p.teamA.teamId,
      team_a_seed: p.teamA.seed,
      team_b_id: p.teamB?.teamId ?? null,
      team_b_seed: p.teamB?.seed ?? null,
      is_bye: p.teamB === null,
    }));

    // 3rd place game: semifinal losers, created alongside the final.
    let thirdPlacePayload: Record<string, unknown> | null = null;
    if (round === totalRounds && round > 1) {
      const losers = (prevBracket ?? [])
        .filter(b => !b.is_bye && b.winner_id && b.team_a_id && b.team_b_id)
        .map(b => {
          const isAWinner = b.winner_id === b.team_a_id;
          return {
            teamId: isAWinner ? b.team_b_id! : b.team_a_id!,
            seed: isAWinner ? b.team_b_seed! : b.team_a_seed!,
          };
        });

      if (losers.length === 2) {
        const [loserA, loserB] = losers[0].seed < losers[1].seed
          ? [losers[0], losers[1]]
          : [losers[1], losers[0]];
        thirdPlacePayload = {
          bracket_position: pairings.length + 1,
          team_a_id: loserA.teamId,
          team_a_seed: loserA.seed,
          team_b_id: loserB.teamId,
          team_b_seed: loserB.seed,
        };
      }
    }

    const { data: writeResult, error: writeErr } = await supabase.rpc('create_playoff_round_atomic', {
      p_league_id: league_id,
      p_season: league.season,
      p_round: round,
      p_schedule_id: scheduleWeek.id,
      p_week_number: scheduleWeek.week_number,
      p_pairings: pairingPayload,
      p_third_place: thirdPlacePayload,
    });
    if (writeErr) throw writeErr;

    const created = writeResult as {
      bracket_count: number;
      matchup_count: number;
      matchups: Array<{ team_a_id: string; team_b_id: string; is_third_place: boolean }>;
    };

    // Notify teams about their matchups (non-fatal). Byes are excluded server-side.
    try {
      const ln = league.name ?? 'Your League';
      for (const m of created.matchups ?? []) {
        if (m.is_third_place) {
          await notifyTeams(supabase, [m.team_a_id, m.team_b_id], 'playoffs',
            `${ln} — 3rd Place Game`,
            'You\'ve been matched up for the 3rd place game. Good luck!',
            { screen: 'playoff-bracket' }
          );
        } else {
          await notifyTeams(supabase, [m.team_a_id, m.team_b_id], 'playoffs',
            round >= totalRounds ? `${ln} — Championship Matchup!` : `${ln} — Playoff Round ${round}`,
            round >= totalRounds ? 'The championship matchup is set. Time to compete!'
              : 'Your next playoff matchup has been set. Check the bracket.',
            { screen: 'playoff-bracket' }
          );
        }
      }
    } catch (notifyErr) {
      console.warn('Playoff matchup notification failed (non-fatal):', notifyErr);
    }

    // Check if all entries this round are byes — if so, auto-generate next round
    const allByes = pairings.every(p => p.teamB === null);
    if (allByes && round < totalRounds) {
      const nextBody = JSON.stringify({ league_id, round: round + 1 });
      const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/generate-playoff-round`;
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${Deno.env.get('SB_SECRET_KEY')}`,
        },
        body: nextBody,
      });
    }

    return jsonResponse({
      success: true,
      round,
      bracket_entries: created.bracket_count,
      matchups_created: created.matchup_count,
      byes: pairings.filter(p => p.teamB === null).length,
    });
  } catch (err) {
    return handleError(err, 'generate-playoff-round');
  }
});
