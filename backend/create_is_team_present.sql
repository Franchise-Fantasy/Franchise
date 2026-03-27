CREATE OR REPLACE FUNCTION is_team_present(
  p_draft_id uuid,
  p_team_id uuid
) RETURNS boolean
LANGUAGE sql SECURITY DEFINER STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM draft_team_status
    WHERE draft_id = p_draft_id
      AND team_id = p_team_id
      AND last_seen_at > now() - interval '2 minutes'
  );
$$;

GRANT EXECUTE ON FUNCTION is_team_present(uuid, uuid) TO authenticated, anon, service_role;
