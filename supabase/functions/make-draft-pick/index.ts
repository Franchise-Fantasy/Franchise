import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { checkPositionLimits } from '../_shared/positionLimits.ts';
import { notifyTeams, notifyLeague } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';
import { isEligibleForSlot } from '../../../utils/roster/rosterSlotsShared.ts';

const Body = z.object({
  draft_id: z.string().uuid(),
  player_id: z.string().uuid(),
  player_position: z.string().min(1),
  league_id: z.string().uuid(),
});

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

async function scheduleAutodraft(draft_id: string, pick_number: number, time_limit: number, autopick_triggered = false) {
  const autodraftUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/autodraft`;
  const res = await fetch(`https://qstash-us-east-1.upstash.io/v2/publish/${autodraftUrl}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${Deno.env.get('QSTASH_TOKEN')?.trim()}`,
      'Content-Type': 'application/json',
      'Upstash-Delay': `${time_limit}s`,
    },
    body: JSON.stringify({ draft_id, pick_number, autopick_triggered }),
  });
  if (!res.ok) throw new Error(`QStash error: ${await res.text()}`);
}

Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return corsResponse();
  try {
    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SB_SECRET_KEY') ?? '');
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SB_PUBLISHABLE_KEY") ?? "", {
      global: { headers: { Authorization: token ?? "" } }
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new HttpError('Unauthorized', 401);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'make-draft-pick');
    if (rateLimited) return rateLimited;

    const { draft_id, player_id, player_position, league_id } = parseBody(Body, await req.json());

    const { data: userTeam, error: teamError } = await supabaseAdmin.from('teams').select('id').eq('league_id', league_id).eq('user_id', user.id).single();
    if (teamError || !userTeam) throw new HttpError('User does not have a team in this league.', 403);

    const { data: draft, error: draftError } = await supabaseAdmin.from('drafts').select('current_pick_number, rounds, picks_per_round, time_limit, type').eq('id', draft_id).single();
    if (draftError || !draft) throw new HttpError('Draft not found.', 404);

    if (draft.current_pick_number > draft.rounds * draft.picks_per_round) {
      return jsonResponse({ message: 'Draft is already complete.' });
    }

    const { data: currentPick, error: pickError } = await supabaseAdmin.from('draft_picks').select('current_team_id, player_id').eq('draft_id', draft_id).eq('pick_number', draft.current_pick_number).single();
    if (pickError || !currentPick) throw new HttpError('Error fetching current pick.');

    if (currentPick.current_team_id !== userTeam.id) throw new HttpError('It is not your turn to pick.', 403);
    if (currentPick.player_id) throw new HttpError('A player has already been selected for this pick.', 409);

    // Verify player isn't already on a roster in this league
    const { data: alreadyRostered } = await supabaseAdmin
      .from('league_players').select('id').eq('league_id', league_id).eq('player_id', player_id).limit(1);
    if (alreadyRostered && alreadyRostered.length > 0) {
      throw new HttpError('This player is already on a roster in this league.', 409);
    }

    // Position limit check
    const { data: leagueForLimits } = await supabaseAdmin
      .from('leagues').select('position_limits').eq('id', league_id).single();
    const posLimits = leagueForLimits?.position_limits as Record<string, number> | null;
    if (posLimits && Object.keys(posLimits).length > 0) {
      const { data: teamRoster } = await supabaseAdmin
        .from('league_players')
        .select('position, roster_slot')
        .eq('league_id', league_id)
        .eq('team_id', currentPick.current_team_id);
      const violation = checkPositionLimits(posLimits, teamRoster ?? [], player_position);
      if (violation) {
        throw new HttpError(
          `Cannot draft this player: your roster already has the maximum ${violation.max} players eligible at ${violation.position}.`,
        );
      }
    }

    const isRookieDraft = draft.type === 'rookie';
    const rosterSlot = await findBestSlot(supabaseAdmin, league_id, currentPick.current_team_id, player_position);

    // Execute all mutations atomically via RPC
    const { data: pickResult, error: rpcError } = await supabaseAdmin.rpc('execute_draft_pick', {
      p_draft_id: draft_id,
      p_pick_number: draft.current_pick_number,
      p_player_id: player_id,
      p_league_id: league_id,
      p_team_id: currentPick.current_team_id,
      p_roster_slot: rosterSlot,
      p_player_position: player_position,
      p_is_rookie_draft: isRookieDraft,
    });
    if (rpcError) {
      // Unique constraint means another pick claimed this player first
      if (rpcError.code === '23505') {
        throw new HttpError('This player was just drafted by another team.', 409);
      }
      throw rpcError;
    }

    const isDraftComplete = pickResult.is_complete;
    const nextPickNumber = pickResult.next_pick_number;

    if (!isDraftComplete) {
      try {
        // Check if the next team has autopick enabled — if so, fire immediately
        let delay = draft.time_limit;
        let nextIsAutopick = false;
        const { data: nextPick } = await supabaseAdmin
          .from('draft_picks')
          .select('current_team_id')
          .eq('draft_id', draft_id)
          .eq('pick_number', nextPickNumber)
          .single();

        if (nextPick) {
          const { data: teamStatus } = await supabaseAdmin
            .from('draft_team_status')
            .select('autopick_on')
            .eq('draft_id', draft_id)
            .eq('team_id', nextPick.current_team_id)
            .maybeSingle();

          if (teamStatus?.autopick_on) {
            delay = 1;
            nextIsAutopick = true;
          }
        }

        await scheduleAutodraft(draft_id, nextPickNumber, delay, nextIsAutopick);

        // Snapshot the limit for the new current pick so a mid-draft time
        // change only affects future picks (on-the-clock pick keeps its clock).
        await supabaseAdmin
          .from('drafts')
          .update({ current_pick_time_limit: draft.time_limit })
          .eq('id', draft_id);
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

    return jsonResponse({
      message: isDraftComplete ? 'Draft complete!' : 'Pick successful!'
    });
  } catch (error) {
    return handleError(error, 'make-draft-pick');
  }
});
