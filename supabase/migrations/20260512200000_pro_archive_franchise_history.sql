-- Franchise History RPC for the NBA Playoff Archive.
-- Returns one row per season this franchise has existed, with regular-season
-- record, playoff path (as JSON), and the season's headline player by VORP.
-- Used by app/franchise/[id].tsx to render the year-by-year overview.

CREATE OR REPLACE FUNCTION pro_archive_franchise_history(p_franchise_id text)
RETURNS TABLE (
  season int,
  wins int,
  losses int,
  conference text,
  conference_seed int,
  series jsonb,
  top_player jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    fs.season,
    st.wins,
    st.losses,
    st.conference,
    st.conference_seed,
    -- Series JSON array: round, opponent, this-team's W-L, winner_id.
    -- Empty array when the team missed the playoffs that year.
    COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'round', ps.round,
          'opponent_id',
          CASE WHEN ps.franchise_a_id = p_franchise_id
               THEN ps.franchise_b_id
               ELSE ps.franchise_a_id
          END,
          'my_wins',
          CASE WHEN ps.franchise_a_id = p_franchise_id
               THEN ps.wins_a
               ELSE ps.wins_b
          END,
          'opp_wins',
          CASE WHEN ps.franchise_a_id = p_franchise_id
               THEN ps.wins_b
               ELSE ps.wins_a
          END,
          'winner_id', ps.winner_franchise_id
        )
        ORDER BY ps.round
      )
      FROM pro_playoff_series ps
      WHERE ps.season = fs.season
        AND (ps.franchise_a_id = p_franchise_id OR ps.franchise_b_id = p_franchise_id)
    ), '[]'::jsonb) AS series,
    -- Top player by VORP for this (season, team). Same filter as the
    -- rotation table: mpg >= 15, gp >= 25. Null when no rotation data
    -- exists for this season yet (older years not scraped).
    (
      SELECT jsonb_build_object(
        'bbref_player_id', tp.bbref_player_id,
        'player_name', tp.player_name,
        'vorp', tp.vorp,
        'is_all_star', tp.is_all_star
      )
      FROM pro_franchise_season_player_stats tp
      WHERE tp.season = fs.season
        AND tp.franchise_id = p_franchise_id
        AND COALESCE(tp.mpg, 0) >= 15
        AND COALESCE(tp.gp, 0) >= 25
      ORDER BY tp.vorp DESC NULLS LAST
      LIMIT 1
    ) AS top_player
  FROM pro_franchise_season fs
  LEFT JOIN pro_regular_season_standing st
    ON st.season = fs.season
   AND st.franchise_id = p_franchise_id
  WHERE fs.franchise_id = p_franchise_id
  ORDER BY fs.season DESC;
$$;

GRANT EXECUTE ON FUNCTION pro_archive_franchise_history(text) TO authenticated;
