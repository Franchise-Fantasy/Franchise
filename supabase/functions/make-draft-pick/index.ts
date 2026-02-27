import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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

// Find the best roster_slot for a newly drafted player
async function findBestSlot(
  supabaseAdmin: any,
  leagueId: string,
  teamId: string,
  playerPosition: string,
): Promise<string> {
  // Fetch roster config and current team roster in parallel
  const [configResult, rosterResult] = await Promise.all([
    supabaseAdmin.from('league_roster_config').select('position, slot_count').eq('league_id', leagueId),
    supabaseAdmin.from('league_players').select('roster_slot').eq('team_id', teamId).eq('league_id', leagueId),
  ]);

  const configs = configResult.data ?? [];
  const currentPlayers = rosterResult.data ?? [];

  // Track which specific slots are occupied
  const occupiedSlots = new Set<string>(
    currentPlayers.map((p: any) => p.roster_slot ?? 'BE'),
  );

  // Try starter slots first (not BE/IR), in config order
  const starterConfigs = configs.filter((c: any) => c.position !== 'BE' && c.position !== 'IR');
  for (const config of starterConfigs) {
    if (!isEligibleForSlot(playerPosition, config.position)) continue;
    if (config.position === 'UTIL') {
      // Find first available numbered UTIL slot
      for (let i = 1; i <= config.slot_count; i++) {
        const slot = `UTIL${i}`;
        if (!occupiedSlots.has(slot)) return slot;
      }
    } else {
      // Count how many players are in this slot type
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

Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
      }
    });
  }
  try {
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "", {
      global: { headers: { Authorization: token ?? "" } }
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const payload = await req.json();
    const { draft_id, player_id, player_position, league_id } = payload;

    const { data: userTeam, error: teamError } = await supabaseAdmin.from('teams').select('id').eq('league_id', league_id).eq('user_id', user.id).single();
    if (teamError || !userTeam) throw new Error('User does not have a team in this league.');

    const { data: draft, error: draftError } = await supabaseAdmin.from('drafts').select('current_pick_number, rounds, picks_per_round, time_limit, type').eq('id', draft_id).single();
    if (draftError || !draft) throw new Error('Draft not found.');

    if (draft.current_pick_number > draft.rounds * draft.picks_per_round) {
      return new Response(JSON.stringify({ message: 'Draft is already complete.' }), { status: 200 });
    }

    const { data: currentPick, error: pickError } = await supabaseAdmin.from('draft_picks').select('current_team_id, player_id').eq('draft_id', draft_id).eq('pick_number', draft.current_pick_number).single();
    if (pickError || !currentPick) throw new Error('Error fetching current pick.');

    if (currentPick.current_team_id !== userTeam.id) throw new Error('It is not your turn to pick.');
    if (currentPick.player_id) throw new Error('A player has already been selected for this pick.');

    const timestamp = new Date().toISOString();
    const isRookieDraft = draft.type === 'rookie';

    const { error: updatePickError } = await supabaseAdmin.from('draft_picks').update({
      player_id,
      selected_at: timestamp
    }).eq('draft_id', draft_id).eq('pick_number', draft.current_pick_number);
    if (updatePickError) throw updatePickError;

    const rosterSlot = await findBestSlot(supabaseAdmin, league_id, currentPick.current_team_id, player_position);

    const { error: insertPlayerError } = await supabaseAdmin.from('league_players').insert({
      league_id,
      player_id,
      team_id: currentPick.current_team_id,
      acquired_via: isRookieDraft ? 'rookie_draft' : 'draft',
      acquired_at: timestamp,
      position: player_position,
      roster_slot: rosterSlot,
    });
    if (insertPlayerError) throw insertPlayerError;

    const nextPickNumber = draft.current_pick_number + 1;
    const totalPicks = draft.rounds * draft.picks_per_round;
    const isDraftComplete = nextPickNumber > totalPicks;

    const draftUpdate: Record<string, unknown> = {
      current_pick_number: nextPickNumber,
      current_pick_timestamp: timestamp,
    };
    if (isDraftComplete) draftUpdate.status = 'complete';

    const { error: advanceDraftError } = await supabaseAdmin.from('drafts').update(draftUpdate).eq('id', draft_id);
    if (advanceDraftError) throw advanceDraftError;

    // When rookie draft completes, update offseason step
    if (isDraftComplete && isRookieDraft) {
      await supabaseAdmin
        .from('leagues')
        .update({ offseason_step: 'rookie_draft_complete' })
        .eq('id', league_id);
    }

    if (!isDraftComplete) {
      try {
        await scheduleAutodraft(draft_id, nextPickNumber, draft.time_limit);
      } catch (schedErr) {
        console.warn('Failed to schedule autodraft (non-fatal):', schedErr);
      }
    }

    // Push notifications
    try {
      const { data: leagueInfo } = await supabaseAdmin.from('leagues').select('name').eq('id', league_id).single();
      const ln = leagueInfo?.name ?? 'Your League';

      if (!isDraftComplete) {
        const { data: nextPick } = await supabaseAdmin
          .from('draft_picks')
          .select('current_team_id')
          .eq('draft_id', draft_id)
          .eq('pick_number', nextPickNumber)
          .single();

        if (nextPick) {
          await notifyTeams(supabaseAdmin, [nextPick.current_team_id], 'draft',
            isRookieDraft ? `${ln} — Rookie Draft: Your pick!` : `${ln} — Your turn to pick!`,
            'The draft clock is ticking. Make your pick.',
            { screen: 'draft-room', draft_id }
          );
        }
      } else {
        await notifyLeague(supabaseAdmin, league_id, 'draft',
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

    return new Response(JSON.stringify({
      message: isDraftComplete ? 'Draft complete!' : 'Pick successful!'
    }), { status: 200 });
  } catch (error) {
    console.error("make-draft-pick error:", error);
    return new Response(JSON.stringify({
      error: error.message,
      stack: error.stack,
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});
