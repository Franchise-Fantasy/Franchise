-- League Invitations — a persistent, in-app record of a targeted invite.
--
-- Why this exists: the app had two invite paths and neither reliably reached the
-- invitee. The invite code/link is a pure pull model (notifies nobody, and being
-- anonymous it CAN'T target a user). The email invite (send-league-invite) sent a
-- push only — no persistent record — so a missed/undelivered push left zero in-app
-- trace, and it only surfaced inside import setup. This adds the missing durable
-- record + the RPCs the invitee/commissioner surfaces read and write.
--
-- Model: the edge function (service_role, does its own commissioner auth) CREATES
-- invites; clients only READ (RLS) and change status via the SD RPCs below. A row
-- policy can't constrain which columns a role writes, so there are no client write
-- grants — every status flip goes through a SECURITY DEFINER RPC (project rule).
--
-- Acceptance is trigger-driven, not an RPC: a status-only "accept" could lie
-- (say accepted with no team). The teams trigger flips the invite the moment a
-- real membership commit lands, covering claim/join/assign/transfer uniformly.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.invitations (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id        uuid NOT NULL REFERENCES public.leagues(id)  ON DELETE CASCADE,
  -- Reserve a specific unclaimed imported team. SET NULL (not CASCADE) so a team
  -- being reassigned/retired doesn't silently delete the invite record.
  team_id          uuid          REFERENCES public.teams(id)    ON DELETE SET NULL,
  invited_user_id  uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  invited_email    text NOT NULL,
  invited_by       uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  responded_at     timestamptz
);

-- One LIVE invite per (league, invitee). Declined/cancelled rows don't block a
-- resend, and this partial index is the ON CONFLICT arbiter for create_league_invite.
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending_unique
  ON public.invitations (league_id, invited_user_id) WHERE status = 'pending';
-- The invitee's "my pending invites" query.
CREATE INDEX IF NOT EXISTS invitations_invitee_pending_idx
  ON public.invitations (invited_user_id) WHERE status = 'pending';
-- The commissioner's "sent invites for this league" query.
CREATE INDEX IF NOT EXISTS invitations_league_idx ON public.invitations (league_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. RLS — clients read only; all writes via service_role edge fn + SD RPCs
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS invitations_select ON public.invitations;
CREATE POLICY invitations_select ON public.invitations
  FOR SELECT TO authenticated
  USING (
    invited_user_id = (SELECT auth.uid())
    OR is_league_commissioner(league_id)
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. create_league_invite — insert/refresh a pending invite (service_role only).
--    Raw SQL owns the partial-index arbiter; supabase-js .upsert() cannot emit a
--    partial ON CONFLICT predicate, which is why creation is an RPC.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_league_invite(
  p_league_id uuid,
  p_invited_user_id uuid,
  p_invited_email text,
  p_invited_by uuid,
  p_team_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  INSERT INTO invitations (league_id, team_id, invited_user_id, invited_email, invited_by)
  VALUES (p_league_id, p_team_id, p_invited_user_id, p_invited_email, p_invited_by)
  ON CONFLICT (league_id, invited_user_id) WHERE status = 'pending'
  DO UPDATE SET
    team_id       = EXCLUDED.team_id,
    invited_email = EXCLUDED.invited_email,
    invited_by    = EXCLUDED.invited_by,
    created_at    = now()
  RETURNING id;
$$;

REVOKE ALL ON FUNCTION public.create_league_invite(uuid, uuid, text, uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_league_invite(uuid, uuid, text, uuid, uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Auto-accept on membership commit.
--    Fires on any real teams.user_id write (claim/join/assign/transfer). The WHEN
--    guard skips the vacate path (user_id -> NULL) and the bulk imported-team
--    inserts (all user_id NULL), so it only enters for an actual membership gain.
--    SECURITY DEFINER so it can update invitations regardless of the caller's role.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.auto_accept_league_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE invitations
     SET status = 'accepted', responded_at = now()
   WHERE league_id = NEW.league_id
     AND invited_user_id = NEW.user_id
     AND status = 'pending';
  RETURN NULL; -- AFTER trigger
END;
$$;

REVOKE ALL ON FUNCTION public.auto_accept_league_invite() FROM public, anon, authenticated;

DROP TRIGGER IF EXISTS teams_auto_accept_invite ON public.teams;
CREATE TRIGGER teams_auto_accept_invite
  AFTER INSERT OR UPDATE OF user_id ON public.teams
  FOR EACH ROW WHEN (NEW.user_id IS NOT NULL)
  EXECUTE FUNCTION public.auto_accept_league_invite();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. respond_to_league_invite — invitee declines (accept is trigger-only).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.respond_to_league_invite(p_invite_id uuid, p_action text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_action <> 'decline' THEN
    RAISE EXCEPTION 'unsupported_action: only decline is supported' USING ERRCODE = '22023';
  END IF;

  UPDATE invitations
     SET status = 'declined', responded_at = now()
   WHERE id = p_invite_id
     AND invited_user_id = v_uid
     AND status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found_or_not_pending');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.respond_to_league_invite(uuid, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.respond_to_league_invite(uuid, text) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. cancel_league_invite — commissioner cancels a pending invite.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_league_invite(p_invite_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_league_id uuid;
BEGIN
  SELECT league_id INTO v_league_id
    FROM invitations WHERE id = p_invite_id AND status = 'pending';
  IF v_league_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found_or_not_pending');
  END IF;

  IF NOT is_league_commissioner(v_league_id) THEN
    RAISE EXCEPTION 'not_authorized: only the commissioner can cancel invites'
      USING ERRCODE = '42501';
  END IF;

  UPDATE invitations
     SET status = 'cancelled', responded_at = now()
   WHERE id = p_invite_id AND status = 'pending';
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_league_invite(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.cancel_league_invite(uuid) TO authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. archive_league — also cancel dangling pending invites.
--    Archive is a soft-delete, so the leagues FK CASCADE never fires; without this
--    a pending invite would deep-link into a now-hidden league. Mirrors how this
--    function already clears favorite_league_id. (Full body re-declared to add the
--    one line; keep in sync with 20260608002000_league_leave_archive.sql.)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_league(p_league_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  v_created_by uuid;
  v_archived_at timestamptz;
BEGIN
  SELECT created_by, archived_at INTO v_created_by, v_archived_at
  FROM leagues WHERE id = p_league_id;

  IF v_created_by IS NULL THEN
    RETURN jsonb_build_object('error', 'league_not_found');
  END IF;
  IF v_created_by != v_user_id THEN
    RAISE EXCEPTION 'Only the commissioner can archive this league';
  END IF;

  IF v_archived_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true); -- already archived
  END IF;

  UPDATE leagues SET archived_at = now(), archived_by = v_user_id WHERE id = p_league_id;
  UPDATE profiles SET favorite_league_id = NULL WHERE favorite_league_id = p_league_id;
  UPDATE invitations SET status = 'cancelled', responded_at = now()
   WHERE league_id = p_league_id AND status = 'pending';

  RETURN jsonb_build_object('ok', true);
END;
$function$;
