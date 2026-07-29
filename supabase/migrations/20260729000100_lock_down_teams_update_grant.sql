-- Blocker: `authenticated` held UPDATE on ALL columns of public.teams, and the
-- teams_update_own policy only pins user_id in its WITH CHECK. So any user could
-- UPDATE their OWN team row to set is_commissioner=true (self-promote to
-- commissioner), move league_id into another (private) league — which grants
-- membership everywhere, since is_league_member() is just a teams-row lookup —
-- or rewrite their own wins/points_for (tamper standings). Restrict the column
-- grant to the genuinely user-editable fields. Every other column on teams is
-- written only by SECURITY DEFINER RPCs (reassign_commissioner, join_league_team,
-- assign_team_divisions, …) or service-role edge functions (finalize-week,
-- update-standings), all of which bypass this role grant.
REVOKE UPDATE ON public.teams FROM authenticated;
GRANT UPDATE (name, tricode, logo_key, division) ON public.teams TO authenticated;

-- The one legit client write to is_commissioner was claim-team flipping it from
-- a CLIENT-SUPPLIED URL param after an import — itself an escalation path (any
-- user could pass isCommissioner=true). Move it server-side: only the league's
-- creator (the importer, created_by) can flag their own claimed team as
-- commissioner. Fully qualified refs + empty search_path (injection-safe).
CREATE OR REPLACE FUNCTION public.become_league_commissioner(p_team_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_league_id uuid;
  v_owner uuid;
  v_creator uuid;
BEGIN
  SELECT t.league_id, t.user_id INTO v_league_id, v_owner
  FROM public.teams t WHERE t.id = p_team_id;

  IF v_league_id IS NULL THEN
    RAISE EXCEPTION 'Team not found';
  END IF;

  IF v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Not your team';
  END IF;

  SELECT l.created_by INTO v_creator FROM public.leagues l WHERE l.id = v_league_id;
  IF v_creator IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the league creator can self-assign commissioner';
  END IF;

  UPDATE public.teams SET is_commissioner = true WHERE id = p_team_id;
END;
$$;

-- Default grants on a new public function reach anon+authenticated AND PUBLIC;
-- strip anon + PUBLIC so only authenticated (and the definer/service_role) can call.
REVOKE EXECUTE ON FUNCTION public.become_league_commissioner(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.become_league_commissioner(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.become_league_commissioner(uuid) TO authenticated;
