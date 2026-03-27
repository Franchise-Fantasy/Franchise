-- RPC for commissioner to transfer team ownership
CREATE OR REPLACE FUNCTION transfer_team_ownership(
  p_league_id UUID,
  p_team_id UUID,
  p_new_owner_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_commissioner_id UUID;
  v_new_user_id UUID;
  v_existing_team_id UUID;
BEGIN
  -- Verify caller is commissioner
  SELECT created_by INTO v_commissioner_id
  FROM leagues WHERE id = p_league_id;

  IF v_commissioner_id IS NULL OR v_commissioner_id != auth.uid() THEN
    RAISE EXCEPTION 'Only the commissioner can transfer team ownership';
  END IF;

  -- Verify team belongs to this league
  IF NOT EXISTS (SELECT 1 FROM teams WHERE id = p_team_id AND league_id = p_league_id) THEN
    RAISE EXCEPTION 'Team not found in this league';
  END IF;

  -- Look up user by email
  SELECT id INTO v_new_user_id
  FROM profiles WHERE LOWER(email) = LOWER(p_new_owner_email);

  IF v_new_user_id IS NULL THEN
    RETURN jsonb_build_object('error', 'No account found with that email. The user must create an account first.');
  END IF;

  -- Check if user already owns a team in this league
  SELECT id INTO v_existing_team_id
  FROM teams WHERE league_id = p_league_id AND user_id = v_new_user_id;

  IF v_existing_team_id IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'This user already owns a team in this league.');
  END IF;

  -- Transfer ownership
  UPDATE teams SET user_id = v_new_user_id WHERE id = p_team_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;
