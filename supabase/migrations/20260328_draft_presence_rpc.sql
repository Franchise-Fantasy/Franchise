-- RPC for heartbeat pings that uses the DB's clock for last_seen_at.
-- Avoids client/server clock skew issues.
CREATE OR REPLACE FUNCTION ping_draft_presence(
  p_draft_id uuid,
  p_team_id uuid,
  p_reset_autopick boolean DEFAULT false
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO draft_team_status (draft_id, team_id, autopick_on, last_seen_at)
  VALUES (p_draft_id, p_team_id, false, now())
  ON CONFLICT (draft_id, team_id) DO UPDATE SET
    last_seen_at = now(),
    autopick_on = CASE WHEN p_reset_autopick THEN false ELSE draft_team_status.autopick_on END;
END;
$$;

GRANT EXECUTE ON FUNCTION ping_draft_presence(uuid, uuid, boolean) TO authenticated, anon;
