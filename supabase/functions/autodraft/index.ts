import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Receiver } from 'https://esm.sh/@upstash/qstash';
import { notifyTeams, notifyLeague } from './push.ts';

// Position eligibility (mirrors utils/rosterSlots.ts)
const POSITION_SPECTRUM = ['PG', 'SG', 'SF', 'PF', 'C'];
const SLOT_ELIGIBLE_POSITIONS: Record<string, string[]> = {
  PG: ['PG'], SG: ['SG'], SF: ['SF'], PF: ['PF'], C: ['C'],
  G: ['PG', 'SG'], F: ['SF', 'PF'],
};

function getEligiblePositions(playerPosition: string): string[] {
  const parts = playerPosition.split('-');
  const indices = parts.map(p => POSITION_SPECTRUM.indexOf(p)).filter(i => i >= 0);
  if (indices.length === 0) return [];
  if (indices.length === 1) return [POSITION_SPECTRUM[indices[0]]];
  const min = Math.min(...indices);
  const max = Math.max(...indices);
  return POSITION_SPECTRUM.slice(min, max + 1);
}

function isEligibleForSlot(playerPosition: string, slotPosition: string): boolean {
  const base = /^UTIL\d+$/.test(slotPosition) ? 'UTIL' : slotPosition;
  if (['UTIL', 'BE', 'IR'].includes(base)) return true;
  const eligible = SLOT_ELIGIBLE_POSITIONS[base];
  if (!eligible) return false;
  return getEligiblePositions(playerPosition).some(pos => eligible.includes(pos));
}

async function findBestSlot(
  supabaseAdmin: any,
  leagueId: string,
  teamId: string,
  playerPosition: string,
): Promise<string> {
  const [configResult, rosterResult] = await Promise.all([
    supabaseAdmin.from('league_roster_config').select('position, slot_count').eq('league_id', leagueId),
    supabaseAdmin.from('league_players').select('roster_slot').eq('team_id', teamId).eq('league_id', leagueId),
  ]);

  const configs = configResult.data ?? [];
  const currentPlayers = rosterResult.data ?? [];

  const occupiedSlots = new Set<string>(
    currentPlayers.map((p: any) => p.roster_slot ?? 'BE'),
  );

  const starterConfigs = configs.filter((c: any) => c.position !== 'BE' && c.position !== 'IR');
  for (const config of starterConfigs) {
    if (!isEligibleForSlot(playerPosition, config.position)) continue;
    if (config.position === 'UTIL') {
      for (let i = 1; i <= config.slot_count; i++) {
        const slot = `UTIL${i}`;
        if (!occupiedSlots.has(slot)) return slot;
      }
    } else {
      let filled = 0;
      for (const p of currentPlayers) {
        if (p.roster_slot === config.position) filled++;
      }
      if (filled < config.slot_count) return config.position;
    }
  }

  return 'BE';
}

async function scheduleAutodraft(draft_id: string, pick_number: number, time_limit: number) {
  const autodraftUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/autodraft`;
  const res = await fetch(`https://qstash-us-east-1.upstash.io/v2/publish/${autodraftUrl}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('QSTASH_TOKEN')?.trim()}`,
      'Content-Type': 'application/json',
      'Upstash-Delay': `${time_limit}s`,
    },
    body: JSON.stringify({ draft_id, pick_number }),
  });
  if (!res.ok) throw new Error(`QStash error: ${await res.text()}`);
}

Deno.serve(async (req) => {
  try {
    const receiver = new Receiver({
      currentSigningKey: Deno.env.get('QSTASH_CURRENT_SIGNING_KEY') ?? '',
      nextSigningKey: Deno.env.get('QSTASH_NEXT_SIGNING_KEY') ?? '',
    });

    const bodyText = await req.text();
    const autodraftUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/autodraft`;

    try {
      await receiver.verify({
        signature: req.headers.get('Upstash-Signature') ?? '',
        body: bodyText,
        url: autodraftUrl,
      });
    } catch {
      return new Response('Unauthorized', { status: 401 });
    }

    const { draft_id, pick_number } = JSON.parse(bodyText);

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { data: draft, error: draftError } = await supabaseAdmin
      .from('drafts')
      .select('current_pick_number, rounds, picks_per_round, time_limit, league_id, type')
      .eq('id', draft_id)
      .single();

    if (draftError || !draft || draft.current_pick_number !== pick_number) {
      return new Response(JSON.stringify({ message: 'Pick already made or draft not found' }), { status: 200 });
    }

    const { data: currentPick, error: pickError } = await supabaseAdmin
      .from('draft_picks')
      .select('id, current_team_id, player_id')
      .eq('draft_id', draft_id)
      .eq('pick_number', pick_number)
      .single();

    if (pickError || !currentPick || currentPick.player_id) {
      return new Response(JSON.stringify({ message: 'Pick already made' }), { status: 200 });
    }

    const { data: draftedPlayers } = await supabaseAdmin
      .from('league_players')
      .select('player_id')
      .eq('league_id', draft.league_id);

    const draftedIds = (draftedPlayers ?? []).map((p: { player_id: string }) => String(p.player_id));

    const isRookieDraft = draft.type === 'rookie';

    let query = supabaseAdmin
      .from('player_season_stats')
      .select('player_id, position')
      .gt('games_played', 0)
      .order('avg_pts', { ascending: false })
      .limit(1);

    if (isRookieDraft) {
      query = query.eq('rookie', true);
    }

    if (draftedIds.length > 0) {
      query = query.filter('player_id', 'not.in', `(${draftedIds.join(',')})`);
    }

    const { data: topPlayer, error: playerError } = await query.single();
    if (playerError || !topPlayer) {
      return new Response(JSON.stringify({ message: 'No players available' }), { status: 200 });
    }

    const timestamp = new Date().toISOString();

    const { error: updatePickError } = await supabaseAdmin
      .from('draft_picks')
      .update({ player_id: topPlayer.player_id, selected_at: timestamp })
      .eq('draft_id', draft_id)
      .eq('pick_number', pick_number);
    if (updatePickError) throw updatePickError;
    console.log('pick made')

    const rosterSlot = await findBestSlot(supabaseAdmin, draft.league_id, currentPick.current_team_id, topPlayer.position);

    const { error: insertPlayerError } = await supabaseAdmin
      .from('league_players')
      .insert({
        league_id: draft.league_id,
        player_id: topPlayer.player_id,
        team_id: currentPick.current_team_id,
        acquired_via: isRookieDraft ? 'rookie_draft' : 'draft',
        acquired_at: timestamp,
        position: topPlayer.position,
        roster_slot: rosterSlot,
      });
    if (insertPlayerError) throw insertPlayerError;

    const nextPickNumber = pick_number + 1;
    const totalPicks = draft.rounds * draft.picks_per_round;
    const isDraftComplete = nextPickNumber > totalPicks;

    const draftUpdate: Record<string, unknown> = {
      current_pick_number: nextPickNumber,
      current_pick_timestamp: timestamp,
    };
    if (isDraftComplete) draftUpdate.status = 'complete';

    const { error: advanceDraftError } = await supabaseAdmin
      .from('drafts')
      .update(draftUpdate)
      .eq('id', draft_id);
    if (advanceDraftError) throw advanceDraftError;

    // When rookie draft completes, update offseason step
    if (isDraftComplete && isRookieDraft) {
      await supabaseAdmin
        .from('leagues')
        .update({ offseason_step: 'rookie_draft_complete' })
        .eq('id', draft.league_id);
    }

    if (!isDraftComplete) {
      try {
        await scheduleAutodraft(draft_id, nextPickNumber, draft.time_limit);
      } catch (schedErr) {
        console.warn('Failed to schedule next autodraft (non-fatal):', schedErr);
      }
    }

    // Push notifications
    try {
      const [{ data: playerInfo }, { data: leagueInfo }] = await Promise.all([
        supabaseAdmin.from('players').select('name').eq('id', topPlayer.player_id).single(),
        supabaseAdmin.from('leagues').select('name').eq('id', draft.league_id).single(),
      ]);
      const ln = leagueInfo?.name ?? 'Your League';

      // Notify the team that was autopicked
      await notifyTeams(supabaseAdmin, [currentPick.current_team_id], 'draft',
        `${ln} — Autopick Made`,
        `${playerInfo?.name ?? 'A player'} was auto-drafted for your team.`,
        { screen: 'draft-room', draft_id }
      );

      if (!isDraftComplete) {
        // Notify next picker
        const { data: nextPick } = await supabaseAdmin
          .from('draft_picks')
          .select('current_team_id')
          .eq('draft_id', draft_id)
          .eq('pick_number', nextPickNumber)
          .single();

        if (nextPick) {
          await notifyTeams(supabaseAdmin, [nextPick.current_team_id], 'draft',
            `${ln} — Your turn to pick!`,
            'The draft clock is ticking. Make your pick.',
            { screen: 'draft-room', draft_id }
          );
        }
      } else {
        await notifyLeague(supabaseAdmin, draft.league_id, 'draft',
          isRookieDraft ? `${ln} — Rookie Draft Complete!` : `${ln} — Draft Complete!`,
          isRookieDraft
            ? 'The rookie draft has finished. Check your new players.'
            : 'Your league\'s draft has finished. Check your roster.',
          { screen: 'roster' }
        );
      }
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ message: isDraftComplete ? 'Draft complete!' : 'Autodrafted!' }),
      { status: 200 }
    );
  } catch (error) {
    console.error('autodraft error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }
});
