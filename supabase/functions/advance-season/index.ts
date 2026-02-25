import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from './push.ts';

function nextSeason(current: string): string {
  const [startStr] = current.split('-');
  const startYear = parseInt(startStr, 10);
  const next = startYear + 1;
  return `${next}-${String(next + 1).slice(2)}`;
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

    // Auth
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

    // Fetch league config
    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, season, teams, playoff_teams, playoff_weeks, rookie_draft_order, rookie_draft_rounds, lottery_draws, lottery_odds, waiver_type, faab_budget, offseason_step')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new Error('League not found');
    if (league.created_by !== user.id) throw new Error('Only the commissioner can advance the season');
    if (league.offseason_step !== null) throw new Error('League is already in the offseason');

    const currentSeason = league.season;
    const newSeason = nextSeason(currentSeason);

    // ── 1. Calculate final standings ──
    const { data: allTeams, error: teamsErr } = await supabaseAdmin
      .from('teams')
      .select('id, name, wins, losses, ties, points_for, points_against')
      .eq('league_id', league_id)
      .order('wins', { ascending: false })
      .order('points_for', { ascending: false });
    if (teamsErr || !allTeams) throw new Error('Failed to fetch teams');

    // ── 2. Determine playoff results from bracket ──
    const { data: bracket } = await supabaseAdmin
      .from('playoff_bracket')
      .select('round, team_a_id, team_b_id, winner_id, is_bye')
      .eq('league_id', league_id)
      .eq('season', currentSeason)
      .order('round', { ascending: true });

    const playoffTeamIds = new Set<string>();
    const eliminatedInRound = new Map<string, number>();
    let championId: string | null = null;
    let runnerUpId: string | null = null;
    let maxRound = 0;

    if (bracket && bracket.length > 0) {
      for (const slot of bracket) {
        if (slot.team_a_id) playoffTeamIds.add(slot.team_a_id);
        if (slot.team_b_id) playoffTeamIds.add(slot.team_b_id);
        if (slot.round > maxRound) maxRound = slot.round;
      }

      for (const slot of bracket) {
        if (slot.is_bye || !slot.winner_id) continue;
        const loserId = slot.team_a_id === slot.winner_id ? slot.team_b_id : slot.team_a_id;
        if (loserId && !eliminatedInRound.has(loserId)) {
          eliminatedInRound.set(loserId, slot.round);
        }
      }

      const finalSlots = bracket.filter(s => s.round === maxRound && s.winner_id);
      if (finalSlots.length > 0) {
        championId = finalSlots[0].winner_id;
        const finalSlot = finalSlots[0];
        runnerUpId = finalSlot.team_a_id === championId ? finalSlot.team_b_id : finalSlot.team_a_id;
      }
    }

    // ── 3. Insert team_seasons rows ──
    const teamSeasonRows = allTeams.map((t, idx) => {
      let playoffResult = 'missed_playoffs';
      if (t.id === championId) playoffResult = 'champion';
      else if (t.id === runnerUpId) playoffResult = 'runner_up';
      else if (playoffTeamIds.has(t.id)) {
        const elimRound = eliminatedInRound.get(t.id);
        if (elimRound != null) playoffResult = `eliminated_round_${elimRound}`;
        else playoffResult = 'playoff_participant';
      }

      return {
        team_id: t.id,
        league_id,
        season: currentSeason,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        points_for: t.points_for,
        points_against: t.points_against,
        final_standing: idx + 1,
        playoff_result: playoffResult,
      };
    });

    const { error: archiveErr } = await supabaseAdmin
      .from('team_seasons')
      .upsert(teamSeasonRows, { onConflict: 'team_id,season' });
    if (archiveErr) throw new Error(`Failed to archive stats: ${archiveErr.message}`);

    // ── 4. Set champion ──
    const leagueUpdates: Record<string, any> = {
      champion_team_id: championId,
      season: newSeason,
      schedule_generated: false,
      lottery_status: 'pending',
      lottery_date: null,
    };

    // ── 5. Reset all team stats ──
    const teamIds = allTeams.map(t => t.id);
    const { error: resetErr } = await supabaseAdmin
      .from('teams')
      .update({ wins: 0, losses: 0, ties: 0, points_for: 0, points_against: 0, streak: '' })
      .in('id', teamIds);
    if (resetErr) throw new Error(`Failed to reset team stats: ${resetErr.message}`);

    // ── 6. Cancel pending trade proposals ──
    await supabaseAdmin
      .from('trade_proposals')
      .update({ status: 'cancelled' })
      .eq('league_id', league_id)
      .in('status', ['pending', 'accepted', 'in_review']);

    // ── 7. Cancel pending waiver claims ──
    await supabaseAdmin
      .from('waiver_claims')
      .update({ status: 'cancelled' })
      .eq('league_id', league_id)
      .eq('status', 'pending');

    // ── 8. Cancel pending transactions ──
    await supabaseAdmin
      .from('pending_transactions')
      .update({ status: 'cancelled' })
      .eq('league_id', league_id)
      .eq('status', 'pending');

    // ── 9. Clear league_waivers ──
    await supabaseAdmin
      .from('league_waivers')
      .delete()
      .eq('league_id', league_id);

    // ── 10. Reset waiver priority by reverse final standings ──
    for (let i = 0; i < allTeams.length; i++) {
      const team = allTeams[allTeams.length - 1 - i];
      await supabaseAdmin
        .from('waiver_priority')
        .update({ priority: i + 1, faab_remaining: league.faab_budget ?? 100 })
        .eq('league_id', league_id)
        .eq('team_id', team.id);
    }

    // ── 11. Determine offseason step ──
    if (league.rookie_draft_order === 'lottery') {
      leagueUpdates.offseason_step = 'lottery_pending';
    } else {
      const reversedTeams = [...allTeams].reverse();
      for (let pos = 0; pos < reversedTeams.length; pos++) {
        const team = reversedTeams[pos];
        for (let round = 1; round <= (league.rookie_draft_rounds ?? 2); round++) {
          await supabaseAdmin
            .from('draft_picks')
            .update({
              pick_number: (round - 1) * reversedTeams.length + (pos + 1),
              slot_number: pos + 1,
            })
            .eq('league_id', league_id)
            .eq('season', newSeason)
            .eq('round', round)
            .eq('current_team_id', team.id)
            .is('draft_id', null);
        }
      }
      leagueUpdates.offseason_step = 'rookie_draft_pending';
    }

    // ── 12. Update league ──
    const { error: leagueUpdateErr } = await supabaseAdmin
      .from('leagues')
      .update(leagueUpdates)
      .eq('id', league_id);
    if (leagueUpdateErr) throw new Error(`Failed to update league: ${leagueUpdateErr.message}`);

    // ── 13. Notify league ──
    try {
      const champName = championId
        ? allTeams.find(t => t.id === championId)?.name ?? 'The champion'
        : 'No champion';
      await notifyLeague(supabaseAdmin, league_id, 'league_activity',
        'Season Over — Offseason Begins!',
        `${champName} won the ${currentSeason} championship. The offseason is now underway.`,
        { screen: 'home' }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({
        message: 'Season advanced successfully',
        previous_season: currentSeason,
        new_season: newSeason,
        champion_team_id: championId,
        offseason_step: leagueUpdates.offseason_step,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('advance-season error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
