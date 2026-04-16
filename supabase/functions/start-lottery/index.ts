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
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error('Missing authorization header');
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'start-lottery');
    if (rateLimited) return rateLimited;

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

    const finalOrder = runLotteryDraw(lotteryPool, league.lottery_odds, league.lottery_draws ?? 4);

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

    // Reorder draft picks for ALL teams. Slot/pick number is determined by
    // the ORIGINATING team (whose standing/lottery position produced the slot),
    // NOT by who currently owns the pick — otherwise traded picks get stamped
    // with the wrong slot (the new owner's standing instead of the original's).
    for (let pos = 0; pos < fullDraftOrder.length; pos++) {
      const teamId = fullDraftOrder[pos];
      for (let round = 1; round <= (league.rookie_draft_rounds ?? 2); round++) {
        await supabaseAdmin.from('draft_picks').update({
          pick_number: (round - 1) * fullDraftOrder.length + (pos + 1),
          slot_number: pos + 1,
        }).eq('league_id', league_id).eq('season', season).eq('round', round)
          .eq('original_team_id', teamId).is('draft_id', null);
      }
    }

    // --- Resolve protections ---
    const { data: protectedPicks } = await supabaseAdmin
      .from('draft_picks')
      .select('id, season, round, slot_number, current_team_id, original_team_id, protection_threshold, protection_owner_id')
      .eq('league_id', league_id)
      .eq('season', season)
      .not('protection_threshold', 'is', null);

    for (const pick of protectedPicks ?? []) {
      if (pick.slot_number != null && pick.slot_number <= pick.protection_threshold) {
        // Protected: revert ownership to protection_owner
        await supabaseAdmin.from('draft_picks').update({
          current_team_id: pick.protection_owner_id,
          protection_threshold: null,
          protection_owner_id: null,
        }).eq('id', pick.id);
      } else {
        // Conveyed: clear protection columns, ownership stays
        await supabaseAdmin.from('draft_picks').update({
          protection_threshold: null,
          protection_owner_id: null,
        }).eq('id', pick.id);
      }
    }

    // --- Resolve swaps ---
    const { data: unresolvedSwaps } = await supabaseAdmin
      .from('pick_swaps')
      .select('id, season, round, beneficiary_team_id, counterparty_team_id')
      .eq('league_id', league_id)
      .eq('season', season)
      .eq('resolved', false);

    const teamNameMap = new Map(orderedTeams.map(t => [t.id, t.name]));
    const swapWarnings: string[] = [];

    for (const swap of unresolvedSwaps ?? []) {
      // Find both teams' picks in this round
      const { data: benefPick } = await supabaseAdmin
        .from('draft_picks')
        .select('id, slot_number, current_team_id')
        .eq('league_id', league_id).eq('season', season).eq('round', swap.round)
        .eq('current_team_id', swap.beneficiary_team_id)
        .is('player_id', null)
        .maybeSingle();
      const { data: counterPick } = await supabaseAdmin
        .from('draft_picks')
        .select('id, slot_number, current_team_id')
        .eq('league_id', league_id).eq('season', season).eq('round', swap.round)
        .eq('current_team_id', swap.counterparty_team_id)
        .is('player_id', null)
        .maybeSingle();

      if (benefPick && counterPick) {
        const benefSlot = benefPick.slot_number ?? 999;
        const counterSlot = counterPick.slot_number ?? 999;
        if (counterSlot < benefSlot) {
          // Counterparty has the better pick — swap ownership
          await supabaseAdmin.from('draft_picks').update({ current_team_id: swap.beneficiary_team_id }).eq('id', counterPick.id);
          await supabaseAdmin.from('draft_picks').update({ current_team_id: swap.counterparty_team_id }).eq('id', benefPick.id);
        }
      } else {
        // Swap voided — one or both teams no longer own a pick in this round (likely due to protection)
        const benefName = teamNameMap.get(swap.beneficiary_team_id) ?? 'Unknown';
        const counterName = teamNameMap.get(swap.counterparty_team_id) ?? 'Unknown';
        const missing = !benefPick && !counterPick ? 'both teams' : !benefPick ? benefName : counterName;
        swapWarnings.push(`Rd ${swap.round} swap between ${benefName} and ${counterName} voided — ${missing} no longer holds a pick in this round (protection triggered).`);
        console.warn(`Swap voided: Rd ${swap.round} ${benefName} vs ${counterName} — ${missing} missing pick`);
      }
      // Mark swap as resolved
      await supabaseAdmin.from('pick_swaps').update({ resolved: true }).eq('id', swap.id);
    }

    // Notify commissioner if any swaps were voided
    if (swapWarnings.length > 0) {
      try {
        const ln = league.name ?? 'Your League';
        await notifyLeague(supabaseAdmin, league_id, 'draft',
          `${ln} — Lottery Notice`,
          `${swapWarnings.length} pick swap(s) voided due to protection: ${swapWarnings.join(' ')}`,
          { screen: 'home' }
        );
      } catch (notifyErr) {
        console.warn('Swap warning notification failed (non-fatal):', notifyErr);
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
        message: swapWarnings.length > 0
          ? `Lottery completed! Note: ${swapWarnings.length} pick swap(s) voided due to protection.`
          : 'Lottery completed!',
        results: finalOrder,
        lottery_pool_size: lotteryPoolSize,
        draws: league.lottery_draws ?? 4,
        swap_warnings: swapWarnings,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('start-lottery error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
