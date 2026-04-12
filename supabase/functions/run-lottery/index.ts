import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { runLotteryDraw } from '../_shared/lottery.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'run-lottery');
    if (rateLimited) return rateLimited;

    const { league_id, season } = await req.json();
    if (!league_id || !season) throw new Error('league_id and season are required');

    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, teams, playoff_weeks, playoff_teams, lottery_draws, lottery_odds, rookie_draft_rounds, offseason_step')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new Error('League not found');

    if (league.created_by !== user.id) {
      throw new Error('Only the commissioner can run the lottery');
    }

    const validSteps = ['lottery_pending', 'lottery_scheduled'];
    if (league.offseason_step && !validSteps.includes(league.offseason_step)) {
      throw new Error(`Cannot run lottery during offseason step: ${league.offseason_step}`);
    }

    const { data: allTeams, error: teamsErr } = await supabaseAdmin
      .from('teams')
      .select('id, name, wins, points_for')
      .eq('league_id', league_id)
      .order('wins', { ascending: true })
      .order('points_for', { ascending: true });
    if (teamsErr || !allTeams) throw new Error('Failed to fetch teams');

    const totalTeams = allTeams.length;
    const playoffTeams = league.playoff_teams ?? Math.min(2 ** (league.playoff_weeks ?? 3), totalTeams);
    const lotteryPoolSize = Math.max(0, totalTeams - playoffTeams);

    if (lotteryPoolSize === 0) {
      throw new Error('No lottery pool: all teams make the playoffs');
    }

    const lotteryPool = allTeams.slice(0, lotteryPoolSize).map(t => ({
      ...t, points_for: Number(t.points_for),
    }));

    const finalOrder = runLotteryDraw(lotteryPool, league.lottery_odds, league.lottery_draws ?? 4);

    const { error: resultErr } = await supabaseAdmin
      .from('lottery_results')
      .upsert({ league_id, season, results: finalOrder }, { onConflict: 'league_id,season' });
    if (resultErr) throw new Error(`Failed to save lottery results: ${resultErr.message}`);

    for (let pos = 0; pos < finalOrder.length; pos++) {
      const entry = finalOrder[pos];
      for (let round = 1; round <= (league.rookie_draft_rounds ?? 2); round++) {
        await supabaseAdmin.from('draft_picks').update({
          pick_number: (round - 1) * lotteryPoolSize + (pos + 1),
          slot_number: pos + 1,
        }).eq('league_id', league_id).eq('season', season).eq('round', round)
          .eq('current_team_id', entry.team_id).is('draft_id', null);
      }
    }

    try {
      const topPick = finalOrder[0];
      const ln = league.name ?? 'Your League';
      await notifyLeague(supabaseAdmin, league_id, 'lottery',
        `${ln} — Lottery Results Are In!`,
        `${topPick.team_name} wins the #1 pick. Check the full results.`,
        { screen: 'league-info' }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ message: 'Lottery completed!', results: finalOrder }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('run-lottery error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
