import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from './push.ts';

function generateDefaultOdds(numTeams: number): number[] {
  if (numTeams <= 0) return [];
  if (numTeams === 1) return [100];
  const weights = Array.from({ length: numTeams }, (_, i) => numTeams - i);
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map(w => Math.round((w / total) * 1000) / 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const { league_id } = await req.json();
    if (!league_id) throw new Error('league_id is required');

    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, season, teams, playoff_teams, playoff_weeks, lottery_draws, lottery_odds, rookie_draft_rounds, offseason_step')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new Error('League not found');
    if (league.created_by !== user.id) throw new Error('Only the commissioner can run the lottery');

    // Validate offseason state
    const validSteps = ['lottery_pending', 'lottery_scheduled'];
    if (!validSteps.includes(league.offseason_step ?? '')) {
      throw new Error(`Cannot run lottery in current state: ${league.offseason_step}`);
    }

    const season = league.season;

    // Get archived standings from team_seasons (previous season)
    const { data: archivedStats } = await supabaseAdmin
      .from('team_seasons')
      .select('team_id, wins, points_for')
      .eq('league_id', league_id)
      .order('wins', { ascending: true })
      .order('points_for', { ascending: true });

    let orderedTeams: Array<{ id: string; name: string; wins: number; points_for: number }>;

    if (archivedStats && archivedStats.length > 0) {
      const teamIds = archivedStats.map(s => s.team_id);
      const { data: teamNames } = await supabaseAdmin
        .from('teams')
        .select('id, name')
        .in('id', teamIds);
      const nameMap = new Map((teamNames ?? []).map(t => [t.id, t.name]));

      orderedTeams = archivedStats.map(s => ({
        id: s.team_id,
        name: nameMap.get(s.team_id) ?? 'Unknown',
        wins: s.wins,
        points_for: Number(s.points_for),
      }));
    } else {
      const { data: allTeams } = await supabaseAdmin
        .from('teams')
        .select('id, name, wins, points_for')
        .eq('league_id', league_id)
        .order('wins', { ascending: true })
        .order('points_for', { ascending: true });
      orderedTeams = (allTeams ?? []).map(t => ({ ...t, points_for: Number(t.points_for) }));
    }

    const totalTeams = orderedTeams.length;
    const playoffTeams = league.playoff_teams ?? Math.min(2 ** (league.playoff_weeks ?? 3), totalTeams);
    const lotteryPoolSize = Math.max(0, totalTeams - playoffTeams);

    if (lotteryPoolSize === 0) {
      throw new Error('No lottery pool: all teams make the playoffs');
    }

    const lotteryPool = orderedTeams.slice(0, lotteryPoolSize);

    let odds: number[] = league.lottery_odds ?? generateDefaultOdds(lotteryPoolSize);
    if (odds.length > lotteryPoolSize) odds = odds.slice(0, lotteryPoolSize);
    else if (odds.length < lotteryPoolSize) odds = generateDefaultOdds(lotteryPoolSize);

    const oddsTotal = odds.reduce((a, b) => a + b, 0);
    const normalizedOdds = odds.map(o => o / oddsTotal);

    const lotteryDraws = Math.min(league.lottery_draws ?? 4, lotteryPoolSize);
    const drawnTeams: typeof lotteryPool = [];
    const remainingPool = [...lotteryPool];
    let remainingOdds = [...normalizedOdds];

    for (let draw = 0; draw < lotteryDraws; draw++) {
      const rand = Math.random();
      let cumulative = 0;
      let selectedIdx = remainingPool.length - 1;

      for (let i = 0; i < remainingOdds.length; i++) {
        cumulative += remainingOdds[i];
        if (rand <= cumulative) { selectedIdx = i; break; }
      }

      drawnTeams.push(remainingPool[selectedIdx]);
      remainingPool.splice(selectedIdx, 1);
      remainingOdds.splice(selectedIdx, 1);

      const remTotal = remainingOdds.reduce((a, b) => a + b, 0);
      if (remTotal > 0) remainingOdds = remainingOdds.map(o => o / remTotal);
    }

    const finalOrder = [
      ...drawnTeams.map((t, i) => ({
        team_id: t.id, team_name: t.name,
        original_standing: lotteryPool.findIndex(p => p.id === t.id) + 1,
        lottery_position: i + 1, was_drawn: true,
      })),
      ...remainingPool.map((t, i) => ({
        team_id: t.id, team_name: t.name,
        original_standing: lotteryPool.findIndex(p => p.id === t.id) + 1,
        lottery_position: drawnTeams.length + i + 1, was_drawn: false,
      })),
    ];

    // Store results
    const { error: resultErr } = await supabaseAdmin
      .from('lottery_results')
      .upsert({ league_id, season, results: finalOrder }, { onConflict: 'league_id,season' });
    if (resultErr) throw new Error(`Failed to save lottery results: ${resultErr.message}`);

    // Build full draft order: lottery teams first, then playoff teams (best record last)
    const lotteryTeamIds = new Set(finalOrder.map(e => e.team_id));
    const playoffTeamsPicks = orderedTeams
      .filter(t => !lotteryTeamIds.has(t.id))
      .reverse(); // best record picks last

    const fullDraftOrder = [
      ...finalOrder.map(e => e.team_id),
      ...playoffTeamsPicks.map(t => t.id),
    ];

    // Reorder draft picks for ALL teams
    for (let pos = 0; pos < fullDraftOrder.length; pos++) {
      const teamId = fullDraftOrder[pos];
      for (let round = 1; round <= (league.rookie_draft_rounds ?? 2); round++) {
        await supabaseAdmin.from('draft_picks').update({
          pick_number: (round - 1) * fullDraftOrder.length + (pos + 1),
          slot_number: pos + 1,
        }).eq('league_id', league_id).eq('season', season).eq('round', round)
          .eq('current_team_id', teamId).is('draft_id', null);
      }
    }

    // Update league state
    await supabaseAdmin
      .from('leagues')
      .update({
        lottery_status: 'complete',
        offseason_step: 'lottery_complete',
      })
      .eq('id', league_id);

    return new Response(
      JSON.stringify({
        message: 'Lottery completed!',
        results: finalOrder,
        lottery_pool_size: lotteryPoolSize,
        draws: lotteryDraws,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('start-lottery error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
