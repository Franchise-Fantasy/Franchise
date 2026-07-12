-- Atomic commissioner config replacement (roster slots, scoring).
--
-- EditRosterModal and EditScoringModal both saved by DELETING every config row
-- for the league and then INSERTing the new set. Between those two commits the
-- league has NO roster configuration / NO scoring settings at all — and if the
-- insert fails (bad row, constraint, dropped connection, app backgrounded), it
-- stays that way. That is not a degraded state, it's a broken league: lineups
-- can't resolve slots and nothing can be scored, and the only recovery is for
-- the commissioner to open the modal and save again — assuming they realize
-- that's what happened.
--
-- Delete-then-insert is the right shape (the new config is authoritative, and
-- diffing rows would be more code for no benefit); it just has to be one
-- transaction, so the old config survives a failed save.

CREATE OR REPLACE FUNCTION public.replace_roster_config(
  p_league_id uuid,
  p_rows jsonb,                      -- [{position, slot_count}]
  p_roster_size integer,
  p_position_limits jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only the commissioner can edit roster settings'
      USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'empty_config: a league must have at least one roster slot'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM league_roster_config WHERE league_id = p_league_id;

  INSERT INTO league_roster_config (league_id, position, slot_count)
  SELECT p_league_id, r->>'position', (r->>'slot_count')::integer
    FROM jsonb_array_elements(p_rows) AS r;

  UPDATE leagues
     SET roster_size = p_roster_size,
         position_limits = p_position_limits
   WHERE id = p_league_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_scoring_settings(
  p_league_id uuid,
  p_rows jsonb                       -- [{stat_name, point_value, is_enabled, inverse}]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM leagues WHERE id = p_league_id AND created_by = auth.uid()) THEN
    RAISE EXCEPTION 'not_authorized: only the commissioner can edit scoring'
      USING ERRCODE = '42501';
  END IF;

  IF p_rows IS NULL OR jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'empty_config: a league must have at least one scoring rule'
      USING ERRCODE = 'P0001';
  END IF;

  DELETE FROM league_scoring_settings WHERE league_id = p_league_id;

  INSERT INTO league_scoring_settings (league_id, stat_name, point_value, is_enabled, inverse)
  SELECT p_league_id,
         r->>'stat_name',
         (r->>'point_value')::numeric,
         coalesce((r->>'is_enabled')::boolean, true),
         coalesce((r->>'inverse')::boolean, false)
    FROM jsonb_array_elements(p_rows) AS r;
END;
$$;

GRANT EXECUTE ON FUNCTION public.replace_roster_config(uuid, jsonb, integer, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_roster_config(uuid, jsonb, integer, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.replace_roster_config(uuid, jsonb, integer, jsonb) FROM anon;

GRANT EXECUTE ON FUNCTION public.replace_scoring_settings(uuid, jsonb) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.replace_scoring_settings(uuid, jsonb) FROM public;
REVOKE ALL ON FUNCTION public.replace_scoring_settings(uuid, jsonb) FROM anon;
