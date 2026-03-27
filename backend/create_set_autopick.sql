CREATE OR REPLACE FUNCTION set_autopick(
  p_draft_id uuid,
  p_team_id uuid,
  p_enabled boolean
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO draft_team_status (draft_id, team_id, autopick_on, last_seen_at)
  VALUES (p_draft_id, p_team_id, p_enabled, now())
  ON CONFLICT (draft_id, team_id) DO UPDATE SET
    autopick_on = p_enabled,
    last_seen_at = now();
END;
$$;
GRANT EXECUTE ON FUNCTION set_autopick(uuid, uuid, boolean) TO authenticated, anon;
