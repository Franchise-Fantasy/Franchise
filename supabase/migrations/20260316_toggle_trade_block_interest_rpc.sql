CREATE OR REPLACE FUNCTION toggle_trade_block_interest(
  p_league_id uuid,
  p_player_id uuid,
  p_team_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_current uuid[];
  v_interested boolean;
BEGIN
  SELECT trade_block_interest INTO v_current
  FROM league_players
  WHERE league_id = p_league_id AND player_id = p_player_id AND on_trade_block = true;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  v_interested := p_team_id = ANY(v_current);

  IF v_interested THEN
    UPDATE league_players
    SET trade_block_interest = array_remove(trade_block_interest, p_team_id)
    WHERE league_id = p_league_id AND player_id = p_player_id;
  ELSE
    UPDATE league_players
    SET trade_block_interest = array_append(trade_block_interest, p_team_id)
    WHERE league_id = p_league_id AND player_id = p_player_id;
  END IF;

  RETURN NOT v_interested;
END;
$$;
