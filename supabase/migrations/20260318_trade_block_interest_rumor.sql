-- When 2+ teams express interest in a trade-block player, auto-create a rumor.
-- Adds rumor logic inside toggle_trade_block_interest so it's atomic.

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
  v_new_len int;
  v_auto_rumors boolean;
  v_existing int;
  v_player_name text;
  v_conv_id uuid;
  v_template text := '{player} is attracting attention on the trade block — multiple teams have expressed interest';
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

    -- Check if we just crossed the 2-team threshold for an auto rumor
    v_new_len := coalesce(array_length(v_current, 1), 0) + 1;

    IF v_new_len >= 2 THEN
      SELECT auto_rumors_enabled INTO v_auto_rumors
      FROM leagues
      WHERE id = p_league_id;

      IF v_auto_rumors THEN
        -- Only create one rumor per player per league for this trigger type
        SELECT count(*) INTO v_existing
        FROM trade_rumors
        WHERE league_id = p_league_id
          AND player_id = p_player_id
          AND trigger_type = 'auto_block_interest';

        IF v_existing = 0 THEN
          SELECT name INTO v_player_name
          FROM players
          WHERE id = p_player_id;

          INSERT INTO trade_rumors (league_id, player_id, trigger_type, template)
          VALUES (p_league_id, p_player_id, 'auto_block_interest', v_template);

          -- Post rumor to the league chat
          SELECT id INTO v_conv_id
          FROM chat_conversations
          WHERE league_id = p_league_id AND type = 'league'
          LIMIT 1;

          IF v_conv_id IS NOT NULL THEN
            INSERT INTO chat_messages (conversation_id, team_id, content, type, league_id)
            VALUES (
              v_conv_id,
              null,
              json_build_object(
                'player_name', coalesce(v_player_name, 'Unknown'),
                'template', v_template
              )::text,
              'rumor',
              p_league_id
            );
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN NOT v_interested;
END;
$$;
