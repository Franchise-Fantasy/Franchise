-- Quarter-by-quarter scores for NFL playoff games. The bracket card detail
-- view shows per-quarter scoring instead of NBA-style series pips (since
-- NFL "series" are single-elimination), so we need 1-4 + OT scores per
-- side. All nullable — pre-1985 Wikipedia articles don't always carry
-- linescore tables, and pre-merger SBs ran 4 quarters but data fidelity is
-- spottier. Importer fills with NULL when unknown.

BEGIN;

ALTER TABLE public.nfl_playoff_game
  ADD COLUMN q1_home int,
  ADD COLUMN q1_away int,
  ADD COLUMN q2_home int,
  ADD COLUMN q2_away int,
  ADD COLUMN q3_home int,
  ADD COLUMN q3_away int,
  ADD COLUMN q4_home int,
  ADD COLUMN q4_away int,
  ADD COLUMN ot_home int,
  ADD COLUMN ot_away int;

-- Replace nfl_archive_bracket to surface the new columns. Same envelope
-- shape as before with an added per-game `quarter_scores` object.
CREATE OR REPLACE FUNCTION public.nfl_archive_bracket(p_season int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'year', (SELECT to_jsonb(y) FROM public.nfl_playoff_year y WHERE y.season = p_season),
    'franchises', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'franchise_id',    fs.franchise_id,
          'name',            fs.name,
          'city',            fs.city,
          'tricode',         fs.tricode,
          'primary_color',   fs.primary_color,
          'secondary_color', fs.secondary_color,
          'logo_key',        fs.logo_key,
          'conference',      fs.conference,
          'division',        fs.division,
          'current_name',    f.current_name,
          'current_city',    f.current_city
        )
      )
      FROM public.nfl_franchise_season fs
      JOIN public.nfl_franchise f ON f.id = fs.franchise_id
      WHERE fs.season = p_season
    ), '[]'::jsonb),
    'series', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.round, s.conference, s.bracket_position)
      FROM public.nfl_playoff_series s
      WHERE s.season = p_season
    ), '[]'::jsonb),
    'games', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'series_id',         g.series_id,
          'game_num',          g.game_num,
          'home_franchise_id', g.home_franchise_id,
          'away_franchise_id', g.away_franchise_id,
          'home_score',        g.home_score,
          'away_score',        g.away_score,
          'ot_periods',        g.ot_periods,
          'played_on',         g.played_on,
          'venue',             g.venue,
          'attendance',        g.attendance,
          'quarter_scores', jsonb_build_object(
            'q1_home', g.q1_home, 'q1_away', g.q1_away,
            'q2_home', g.q2_home, 'q2_away', g.q2_away,
            'q3_home', g.q3_home, 'q3_away', g.q3_away,
            'q4_home', g.q4_home, 'q4_away', g.q4_away,
            'ot_home', g.ot_home, 'ot_away', g.ot_away
          ),
          'box', jsonb_build_object(
            'a', COALESCE((
              SELECT jsonb_agg(to_jsonb(b) ORDER BY b.rank)
              FROM public.nfl_playoff_game_box b
              WHERE b.series_id = g.series_id
                AND b.game_num  = g.game_num
                AND b.side      = 'a'
            ), '[]'::jsonb),
            'b', COALESCE((
              SELECT jsonb_agg(to_jsonb(b) ORDER BY b.rank)
              FROM public.nfl_playoff_game_box b
              WHERE b.series_id = g.series_id
                AND b.game_num  = g.game_num
                AND b.side      = 'b'
            ), '[]'::jsonb)
          )
        )
        ORDER BY g.series_id, g.game_num
      )
      FROM public.nfl_playoff_game g
      JOIN public.nfl_playoff_series s ON s.id = g.series_id
      WHERE s.season = p_season
    ), '[]'::jsonb)
  );
$$;

COMMIT;
