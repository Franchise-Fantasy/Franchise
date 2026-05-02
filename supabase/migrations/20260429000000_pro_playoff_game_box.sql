-- Top 5 box-score lines per game per side, ranked by minutes played.
-- Captures the rotation regulars (good and bad nights both) without the
-- selection bias of only-best-performers — a starter with -22 in 32 min
-- shows up here, where they wouldn't if we sorted by Game Score.
--
-- The legacy top_a_* / top_a_secondary_* columns on pro_playoff_game stay
-- in place for back-compat during the rollout. A future migration can drop
-- them once every season has been re-scraped into this table.

BEGIN;

CREATE TABLE public.pro_playoff_game_box (
  series_id       text NOT NULL,
  game_num        int  NOT NULL,
  side            text NOT NULL CHECK (side IN ('a', 'b')),
  rank            int  NOT NULL CHECK (rank BETWEEN 1 AND 5),
  player_id       text,
  player_name     text NOT NULL,
  minutes_seconds int,
  plus_minus      int,
  stat_line       text,
  PRIMARY KEY (series_id, game_num, side, rank),
  FOREIGN KEY (series_id, game_num)
    REFERENCES public.pro_playoff_game(series_id, game_num)
    ON DELETE CASCADE
);

CREATE INDEX idx_pro_playoff_game_box_lookup
  ON public.pro_playoff_game_box(series_id, game_num);

ALTER TABLE public.pro_playoff_game_box ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pro_playoff_game_box"
  ON public.pro_playoff_game_box
  FOR SELECT
  TO authenticated
  USING (true);

-- Bracket RPC now embeds the per-game box lines under games[i].box.{a,b}
-- so the client gets everything in one round-trip.
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
