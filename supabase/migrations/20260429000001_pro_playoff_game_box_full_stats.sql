-- Extend the per-game box with the standard 5-stat line (PTS/REB/AST/STL/BLK)
-- so the UI can render full horizontal stat rows. The legacy `stat_line`
-- text column stays for now — the scraper still emits it for any caller
-- that wants the pre-formatted string.

BEGIN;

ALTER TABLE public.pro_playoff_game_box
  ADD COLUMN pts int,
  ADD COLUMN reb int,
  ADD COLUMN ast int,
  ADD COLUMN stl int,
  ADD COLUMN blk int;

CREATE OR REPLACE FUNCTION public.pro_archive_bracket(p_season int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'year', (SELECT to_jsonb(y) FROM public.pro_playoff_year y WHERE y.season = p_season),
    'franchises', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'franchise_id', fs.franchise_id,
          'name', fs.name,
          'city', fs.city,
          'tricode', fs.tricode,
          'primary_color', fs.primary_color,
          'secondary_color', fs.secondary_color,
          'logo_key', fs.logo_key,
          'conference', fs.conference,
          'current_name', f.current_name,
          'current_city', f.current_city
        )
      )
      FROM public.pro_franchise_season fs
      JOIN public.pro_franchise f ON f.id = fs.franchise_id
      WHERE fs.season = p_season
    ), '[]'::jsonb),
    'series', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.round, s.conference, s.bracket_position)
      FROM public.pro_playoff_series s
      WHERE s.season = p_season
    ), '[]'::jsonb),
    'games', COALESCE((
      SELECT jsonb_agg(
        to_jsonb(g) || jsonb_build_object('box', jsonb_build_object(
          'a', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'rank', b.rank,
                'player_id', b.player_id,
                'player_name', b.player_name,
                'minutes_seconds', b.minutes_seconds,
                'pts', b.pts,
                'reb', b.reb,
                'ast', b.ast,
                'stl', b.stl,
                'blk', b.blk,
                'plus_minus', b.plus_minus,
                'stat_line', b.stat_line
              ) ORDER BY b.rank
            )
            FROM public.pro_playoff_game_box b
            WHERE b.series_id = g.series_id
              AND b.game_num = g.game_num
              AND b.side = 'a'
          ), '[]'::jsonb),
          'b', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'rank', b.rank,
                'player_id', b.player_id,
                'player_name', b.player_name,
                'minutes_seconds', b.minutes_seconds,
                'pts', b.pts,
                'reb', b.reb,
                'ast', b.ast,
                'stl', b.stl,
                'blk', b.blk,
                'plus_minus', b.plus_minus,
                'stat_line', b.stat_line
              ) ORDER BY b.rank
            )
            FROM public.pro_playoff_game_box b
            WHERE b.series_id = g.series_id
              AND b.game_num = g.game_num
              AND b.side = 'b'
          ), '[]'::jsonb)
        ))
        ORDER BY g.series_id, g.game_num
      )
      FROM public.pro_playoff_game g
      JOIN public.pro_playoff_series s ON s.id = g.series_id
      WHERE s.season = p_season
    ), '[]'::jsonb)
  );
$$;

COMMIT;
