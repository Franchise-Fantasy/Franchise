import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireUser } from '../_shared/auth.ts';
import { deferWork } from '../_shared/background.ts';
import { corsResponse } from '../_shared/cors.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyUsers } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';
import type { Database } from '../../../types/database.types.ts';

// Phase 1: a commissioner invites the owner of a specific unclaimed imported
// team. If that email has a Franchise account we push them a notification that
// deep-links into the existing claim flow; emailing users who DON'T have an
// account (with a store download link) is Phase 2.
const Body = z.object({
  league_id: z.string().uuid(),
  team_id: z.string().uuid(),
  email: z.string().email(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? '',
    );

    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'send-league-invite');
    if (rateLimited) return rateLimited;

    const { league_id, team_id, email } = parseBody(Body, await req.json());
    const normalizedEmail = email.trim().toLowerCase();

    // League must exist and be live — archived leagues have no reachable UI.
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, archived_at')
      .eq('id', league_id)
      .single();
    if (!league || league.archived_at) throw new HttpError('League not found.', 404);

    // Commissioner = league creator OR a member holding the commissioner flag
    // (covers reassign_commissioner). The creator often hasn't claimed a team
    // yet mid-import, so created_by is the primary check.
    let isCommissioner = league.created_by === user.id;
    if (!isCommissioner) {
      const { data: commTeam } = await supabaseAdmin
        .from('teams')
        .select('id')
        .eq('league_id', league_id)
        .eq('user_id', user.id)
        .eq('is_commissioner', true)
        .maybeSingle();
      isCommissioner = !!commTeam;
    }
    if (!isCommissioner) throw new HttpError('Only the commissioner can invite members.', 403);

    // The target team must belong to this league and still be unclaimed.
    const { data: team } = await supabaseAdmin
      .from('teams')
      .select('name, league_id, user_id')
      .eq('id', team_id)
      .single();
    if (!team || team.league_id !== league_id) {
      throw new HttpError('Team does not belong to this league.', 400);
    }
    if (team.user_id) throw new HttpError('That team has already been claimed.', 409);

    // Resolve the email to a Franchise account via the case-insensitive,
    // index-backed lookup (profile_id_for_email). Phase 1 only reaches existing
    // accounts; the emailed download invite for non-users is Phase 2.
    const { data: invitedUserId, error: lookupError } = await supabaseAdmin
      .rpc('profile_id_for_email', { p_email: normalizedEmail });
    if (lookupError) throw lookupError;

    if (!invitedUserId) return jsonResponse({ status: 'no_account' });
    if (invitedUserId === user.id) throw new HttpError("You can't invite yourself.", 400);

    // Already in the league — nothing to send.
    const { data: existing } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', invitedUserId)
      .maybeSingle();
    if (existing) throw new HttpError('That person is already in this league.', 409);

    // Deferred so the response returns before the Expo round-trip. The tap
    // deep-links into the claim flow, where the invitee picks up their team.
    deferWork(
      notifyUsers(
        supabaseAdmin,
        [invitedUserId],
        league_id,
        'commissioner',
        `${league.name} — You're invited`,
        `You've been invited to claim ${team.name}. Tap to join the league.`,
        { type: 'league_invite', screen: 'claim-team', league_id, team_id },
      ),
      'send-league-invite push',
    );

    return jsonResponse({ status: 'notified' });
  } catch (error) {
    return handleError(error, 'send-league-invite');
  }
});
