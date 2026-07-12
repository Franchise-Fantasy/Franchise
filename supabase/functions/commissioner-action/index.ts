import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { deferWork } from '../_shared/background.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyTeams } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  action: z.enum(['force_add', 'force_drop', 'force_move']),
  league_id: z.string().uuid(),
  team_id: z.string().uuid(),
  player_id: z.string().uuid(),
  position: z.string().optional(),
  target_slot: z.string().optional(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'commissioner-action');
    if (rateLimited) return rateLimited;

    const { action, league_id, team_id, player_id, position, target_slot } = parseBody(Body, await req.json());

    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name')
      .eq('id', league_id)
      .single();
    if (league?.created_by !== user.id) {
      throw new HttpError('Only the commissioner can perform this action.', 403);
    }

    const { data: player } = await supabaseAdmin.from('players').select('name').eq('id', player_id).single();
    const { data: team } = await supabaseAdmin.from('teams').select('name, league_id').eq('id', team_id).single();
    if (!team || team.league_id !== league_id) {
      throw new HttpError('Team does not belong to this league.');
    }
    const playerName = player?.name ?? 'Unknown';
    const teamName = team?.name ?? 'Unknown';

    if (action === 'force_add' && !position) {
      throw new HttpError('position is required for force_add');
    }
    if (action === 'force_move' && !target_slot) {
      throw new HttpError('target_slot is required for force_move');
    }

    const notes =
      action === 'force_add'
        ? `Commissioner added ${playerName} to ${teamName}`
        : action === 'force_drop'
          ? `Commissioner dropped ${playerName} from ${teamName}`
          : `Commissioner moved ${playerName} to ${target_slot} on ${teamName}`;

    // The roster change and its ledger entry commit together. Previously the
    // roster write, the transaction, and its item were three commits — a failure
    // after the first mutated a GM's roster with no audit trail, which is the
    // one write that most needs one.
    const { error: actionError } = await supabaseAdmin.rpc('commissioner_roster_action', {
      p_league_id: league_id,
      p_team_id: team_id,
      p_player_id: player_id,
      p_action: action,
      p_position: position ?? null,
      p_target_slot: target_slot ?? null,
      p_notes: notes,
    });
    if (actionError) {
      if (actionError.message?.includes('player_not_on_roster')) {
        throw new HttpError('That player is not on this team.', 404);
      }
      throw actionError;
    }

    // Notify the affected team. Deferred so the response returns before the
    // push round-trips (deferWork logs any failure, non-fatal).
    const ln = league?.name ?? 'Your League';
    deferWork(
      notifyTeams(supabaseAdmin, [team_id], 'commissioner',
        `${ln} — Commissioner Action`,
        notes,
        { screen: 'roster' }),
      'commissioner-action team push',
    );

    return jsonResponse({ message: notes });
  } catch (error) {
    return handleError(error, 'commissioner-action');
  }
});
