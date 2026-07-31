import { supabase } from '@/lib/supabase';

/**
 * The single preflight every "join this league" entry point runs before routing.
 *
 * Why this exists: the checks used to live only in `join-league.tsx` (the
 * invite-code screen), so the invite paths that bypass it — the home
 * PendingInvitesCard and the league-invite push tap — could drop an invitee on
 * "No unclaimed teams available", or create a team in a league that was already
 * full. Every avenue now resolves through here so they agree.
 *
 * It also carries the RESERVED team through: `send-league-invite` can pin any
 * unclaimed team to an invite, and that reservation was being dropped by every
 * consumer, letting an invitee claim somebody else's roster.
 */
export type JoinRoute =
  | {
      ok: true;
      pathname: '/claim-team' | '/create-team';
      params: { leagueId: string; isCommissioner: 'false'; teamId?: string };
    }
  | { ok: false; message: string };

export async function resolveJoinRoute(params: {
  leagueId: string;
  userId: string;
  /** `invitations.team_id` — an imported team reserved for this invitee. */
  reservedTeamId?: string | null;
}): Promise<JoinRoute> {
  const { leagueId, userId, reservedTeamId } = params;

  const { data: league, error } = await supabase
    .from('leagues')
    .select('id, teams, current_teams, imported_from')
    .eq('id', leagueId)
    .maybeSingle();

  // `leagues_select` RLS hides archived leagues, so a soft-deleted league reads
  // as not-found here rather than routing the invitee into a dead league.
  if (error || !league) {
    return { ok: false, message: 'That league is no longer available.' };
  }

  const { data: existingTeam } = await supabase
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .maybeSingle();

  if (existingTeam) {
    return { ok: false, message: 'You already have a team in this league.' };
  }

  // A reserved team is an EXISTING seat that already counts toward
  // `current_teams`, so claiming it neither needs spare capacity nor cares how
  // the league was created. This has to run before both the `imported_from`
  // split and the fullness check below: commissioners hand over vacated teams
  // in ordinary leagues too, and those leagues read as full because
  // `leave_league` / `remove_member` deliberately don't decrement the count.
  if (reservedTeamId) {
    const { data: reserved } = await supabase
      .from('teams')
      .select('id, user_id, league_id')
      .eq('id', reservedTeamId)
      .maybeSingle();

    // Still held for them — send them straight to it. If it was claimed in the
    // meantime we fall through rather than dead-ending.
    if (reserved && reserved.league_id === leagueId && !reserved.user_id) {
      return {
        ok: true,
        pathname: '/claim-team',
        params: { leagueId, isCommissioner: 'false', teamId: reservedTeamId },
      };
    }
  }

  if (league.imported_from) {
    // Imported leagues pre-create every team at import time, so `current_teams`
    // is inflated on day one and the generic fullness check would block every
    // invitee. "Full" here means every pre-created team has been claimed.
    const { data: unclaimed } = await supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId)
      .is('user_id', null)
      .limit(1);

    if (!unclaimed || unclaimed.length === 0) {
      return { ok: false, message: 'All teams in this league have been claimed.' };
    }

    return {
      ok: true,
      pathname: '/claim-team',
      params: { leagueId, isCommissioner: 'false' },
    };
  }

  // Non-imported: create-team increments current_teams as members join, so the
  // generic fullness check is accurate.
  if ((league.current_teams ?? 0) >= league.teams) {
    return { ok: false, message: 'This league is already full.' };
  }

  return {
    ok: true,
    pathname: '/create-team',
    params: { leagueId, isCommissioner: 'false' },
  };
}
