import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyTeams } from './push.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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

interface SeedEntry { teamId: string; seed: number; }
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

// ── Main handler ──

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { league_id, round: requestedRound, from_seed_picks } = await req.json();
    if (!league_id) return json({ error: 'league_id required' }, 400);

    const { data: league, error: leagueErr } = await supabase
      .from('leagues')
      .select('id, name, season, playoff_teams, playoff_weeks, regular_season_weeks, playoff_seeding_format, reseed_each_round')
      .eq('id', league_id)
      .single();

    if (leagueErr || !league) return json({ error: 'League not found' }, 404);

    const playoffTeams = league.playoff_teams ?? 8;
    const totalRounds = calcRounds(playoffTeams);
    const format = league.playoff_seeding_format ?? 'standard';
    const reseed = league.reseed_each_round ?? false;

    const round = requestedRound ?? 1;

    const { data: playoffWeeks } = await supabase
      .from('league_schedule')
      .select('id, week_number')
      .eq('league_id', league_id)
      .eq('is_playoff', true)
      .order('week_number', { ascending: true });

    if (!playoffWeeks || playoffWeeks.length === 0) {
      return json({ error: 'No playoff weeks in schedule' }, 400);
    }

    const { data: existingBracket } = await supabase
      .from('playoff_bracket')
      .select('id')
      .eq('league_id', league_id)
      .eq('season', league.season)
      .eq('round', round)
      .limit(1);

    if (existingBracket && existingBracket.length > 0) {
      return json({ error: `Round ${round} already generated` }, 409);
    }

    let pairings: BracketPairing[] = [];

    if (round === 1) {
      const { data: teams } = await supabase
        .from('teams')
        .select('id, wins, points_for')
        .eq('league_id', league_id)
        .order('wins', { ascending: false })
        .order('points_for', { ascending: false });

      if (!teams || teams.length < 2) return json({ error: 'Not enough teams' }, 400);

      const seeds: SeedEntry[] = teams
        .slice(0, playoffTeams)
        .map((t, i) => ({ teamId: t.id, seed: i + 1 }));

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

        return json({
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
          .select('picking_team_id, picking_seed, picked_opponent_id')
          .eq('league_id', league_id)
          .eq('season', league.season)
          .eq('round', 1)
          .order('picking_seed', { ascending: true });

        if (!picks) return json({ error: 'No seed picks found' }, 400);

        const seedMap = new Map(seeds.map(s => [s.teamId, s]));
        for (const pick of picks) {
          if (!pick.picked_opponent_id) return json({ error: 'Not all picks completed' }, 400);
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
      const { data: prevBracket } = await supabase
        .from('playoff_bracket')
        .select('bracket_position, winner_id, team_a_seed, team_b_seed, team_a_id, team_b_id, is_bye')
        .eq('league_id', league_id)
        .eq('season', league.season)
        .eq('round', round - 1)
        .order('bracket_position', { ascending: true });

      if (!prevBracket || prevBracket.length === 0) {
        return json({ error: `Previous round ${round - 1} not found` }, 400);
      }

      const unresolved = prevBracket.filter(b => !b.winner_id);
      if (unresolved.length > 0) {
        return json({ error: `Previous round has ${unresolved.length} unresolved matchups` }, 400);
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

        return json({
          success: true,
          action: 'seed_picks_created',
          round,
          pickers: pickers.map(p => p.seed),
        });
      }

      if (format === 'higher_seed_picks' && from_seed_picks) {
        const { data: picks } = await supabase
          .from('playoff_seed_picks')
          .select('picking_team_id, picking_seed, picked_opponent_id')
          .eq('league_id', league_id)
          .eq('season', league.season)
          .eq('round', round)
          .order('picking_seed', { ascending: true });

        if (!picks) return json({ error: 'No seed picks found' }, 400);

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

        for (const pick of picks) {
          if (!pick.picked_opponent_id) return json({ error: 'Not all picks completed' }, 400);
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
        if (!built) return json({ error: 'Could not build next round' }, 500);
        pairings = built;
      }
    }

    // ── Insert bracket entries + matchup rows ──

    const scheduleWeek = playoffWeeks[round - 1];
    if (!scheduleWeek) return json({ error: `No schedule week for round ${round}` }, 400);

    const bracketRows = [];
    const matchupInserts = [];

    for (let i = 0; i < pairings.length; i++) {
      const { teamA, teamB } = pairings[i];
      const isBye = teamB === null;
      const bracketPos = i + 1;

      if (isBye) {
        bracketRows.push({
          league_id,
          season: league.season,
          round,
          bracket_position: bracketPos,
          matchup_id: null,
          team_a_id: teamA.teamId,
          team_a_seed: teamA.seed,
          team_b_id: null,
          team_b_seed: null,
          winner_id: teamA.teamId,
          is_bye: true,
        });
      } else {
        matchupInserts.push({
          league_id,
          schedule_id: scheduleWeek.id,
          week_number: scheduleWeek.week_number,
          home_team_id: teamA.teamId,
          away_team_id: teamB.teamId,
          playoff_round: round,
          bracketPos,
          teamA,
          teamB,
        });
      }
    }

    if (matchupInserts.length > 0) {
      const matchupRows = matchupInserts.map(m => ({
        league_id: m.league_id,
        schedule_id: m.schedule_id,
        week_number: m.week_number,
        home_team_id: m.home_team_id,
        away_team_id: m.away_team_id,
        playoff_round: m.playoff_round,
      }));

      const { data: insertedMatchups, error: mErr } = await supabase
        .from('league_matchups')
        .insert(matchupRows)
        .select('id, home_team_id, away_team_id');

      if (mErr) return json({ error: 'Failed to insert matchups', detail: mErr }, 500);

      for (const ins of matchupInserts) {
        const matchup = insertedMatchups?.find(
          (m: any) => m.home_team_id === ins.teamA.teamId && m.away_team_id === ins.teamB.teamId
        );
        bracketRows.push({
          league_id,
          season: league.season,
          round,
          bracket_position: ins.bracketPos,
          matchup_id: matchup?.id ?? null,
          team_a_id: ins.teamA.teamId,
          team_a_seed: ins.teamA.seed,
          team_b_id: ins.teamB.teamId,
          team_b_seed: ins.teamB.seed,
          winner_id: null,
          is_bye: false,
        });
      }
    }

    if (bracketRows.length > 0) {
      const { error: bErr } = await supabase.from('playoff_bracket').insert(bracketRows);
      if (bErr) return json({ error: 'Failed to insert bracket', detail: bErr }, 500);
    }

    // Notify teams about their playoff matchups
    try {
      const ln = league.name ?? 'Your League';
      for (const ins of matchupInserts) {
        await notifyTeams(supabase, [ins.teamA.teamId, ins.teamB.teamId], 'playoffs',
          round >= totalRounds ? `${ln} — Championship Matchup!` : `${ln} — Playoff Round ${round}`,
          round >= totalRounds ? 'The championship matchup is set. Time to compete!'
            : 'Your next playoff matchup has been set. Check the bracket.',
          { screen: 'playoff-bracket' }
        );
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
          Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: nextBody,
      });
    }

    return json({
      success: true,
      round,
      bracket_entries: bracketRows.length,
      matchups_created: matchupInserts.length,
      byes: pairings.filter(p => p.teamB === null).length,
    });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});
