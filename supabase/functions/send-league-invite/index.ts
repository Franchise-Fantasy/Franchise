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

// A commissioner invites a specific person by email to any live league they run.
// If that email has a Franchise account we persist an `invitations` record (the
// invitee's in-app "You're invited" card reads it) AND push a best-effort
// notification that deep-links into the claim/create flow. Emailing users who
// DON'T have an account (with a store download link) is a documented Phase 2 —
// today they get the "share your invite code" fallback.
//
// `team_id` is optional: set it to reserve a specific unclaimed imported team
// (the invitee lands in the claim flow); omit it for an open league (they create
// a team). The persisted row + card make the invite survive a missed push.
const Body = z.object({
  league_id: z.string().uuid(),
  team_id: z.string().uuid().optional(),
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
      .select('created_by, name, archived_at, teams, current_teams')
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

    // Two shapes of invite. With a team_id, reserve a specific unclaimed imported
    // team (invitee lands in the claim flow). Without one, it's an open-league
    // invite (they'll create a team) — guard capacity here, since join_league_team
    // has no capacity gate of its own.
    let teamName: string | null = null;
    if (team_id) {
      const { data: team } = await supabaseAdmin
        .from('teams')
        .select('name, league_id, user_id')
        .eq('id', team_id)
        .single();
      if (!team || team.league_id !== league_id) {
        throw new HttpError('Team does not belong to this league.', 400);
      }
      if (team.user_id) throw new HttpError('That team has already been claimed.', 409);
      teamName = team.name;
    } else if ((league.current_teams ?? 0) >= league.teams) {
      throw new HttpError('League is full.', 409);
    }

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

    // Persist the invite BEFORE the push — the row is state the invitee's card
    // reads next, so it must not be deferred, and it's the durable record that
    // survives a missed/undelivered push. supabase-js can't drive the partial
    // unique index, so this goes through the create_league_invite RPC.
    const { data: inviteId, error: inviteError } = await supabaseAdmin
      .rpc('create_league_invite', {
        p_league_id: league_id,
        p_invited_user_id: invitedUserId,
        p_invited_email: normalizedEmail,
        p_invited_by: user.id,
        // Omit (undefined drops out of the JSON payload) for an open-league
        // invite so the SQL DEFAULT NULL applies — the gen-typed param is
        // `string | undefined`, not nullable.
        p_team_id: team_id,
      });
    if (inviteError) throw inviteError;

    // Best-effort push on top of the persisted record. Deferred so the response
    // returns before the Expo round-trip. A team-specific invite deep-links into
    // the claim flow; an open-league invite routes into create-team.
    const body = teamName
      ? `You've been invited to claim ${teamName}. Tap to join the league.`
      : `You've been invited to join. Tap to create your team.`;
    deferWork(
      notifyUsers(
        supabaseAdmin,
        [invitedUserId],
        league_id,
        'commissioner',
        `${league.name} — You're invited`,
        body,
        {
          type: 'league_invite',
          screen: team_id ? 'claim-team' : 'create-team',
          league_id,
          ...(team_id ? { team_id } : {}),
        },
      ),
      'send-league-invite push',
    );

    return jsonResponse({ status: 'notified', invite_id: inviteId });
  } catch (error) {
    return handleError(error, 'send-league-invite');
  }
});
