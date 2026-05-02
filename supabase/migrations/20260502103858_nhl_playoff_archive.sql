-- Real NHL playoff history archive — fully decoupled from the fantasy schema
-- and from the parallel NBA archive (`pro_*` tables). Schema mirrors the NBA
-- archive shape so the React layer can stay consistent, but with NHL-specific
-- fields (division, OTL, points, shootout, position-based player stats).
--
-- v1 covers the modern divisional-bracket era (2014–present); the schema
-- supports the conference-bracket era (1994–2013) and divisional-bracket era
-- (1980–1993) via the `format` column on nhl_playoff_year.
--
-- Reads: any authenticated user (UI gating handled in-app via a
-- developer-only feature flag — content itself isn't sensitive).
-- Writes: service role only (no RLS write policies).

BEGIN;

-- ── 1. nhl_franchise ────────────────────────────────────────────────────────
-- Abstract franchise identity. Whalers→Hurricanes share id 'CAR'. The
-- Atlanta Thrashers → Winnipeg Jets is its own id ('WPG') since the
-- original Winnipeg Jets relocated to Phoenix→Arizona→Utah ('UTA').
CREATE TABLE public.nhl_franchise (
  id           text PRIMARY KEY,
  current_name text NOT NULL,
  current_city text NOT NULL,
  founded_year int  NOT NULL,
  notes        text
);

-- ── 2. nhl_franchise_season ─────────────────────────────────────────────────
-- Per-season skin. NHL needs a `division` column in addition to `conference`
-- because the divisional-bracket era seeds within division. Conference and
-- division checks are intentionally permissive (no CHECK constraint) since
-- both have changed multiple times since 1980.
CREATE TABLE public.nhl_franchise_season (
  franchise_id    text NOT NULL REFERENCES public.nhl_franchise(id) ON DELETE CASCADE,
  season          int  NOT NULL,
  name            text NOT NULL,
  city            text NOT NULL,
  tricode         text NOT NULL,
  primary_color   text,
  secondary_color text,
  logo_key        text,
  conference      text NOT NULL,
  division        text NOT NULL,
  PRIMARY KEY (franchise_id, season)
);

CREATE INDEX idx_nhl_franchise_season_by_season
  ON public.nhl_franchise_season(season);

-- ── 3. nhl_playoff_year ─────────────────────────────────────────────────────
-- Per-year format metadata + champion + Conn Smythe (playoffs MVP, the NHL
-- equivalent of NBA's Finals MVP). The `format` enum captures bracket-shape
-- eras since the schema supports any season from 1980 forward.
CREATE TABLE public.nhl_playoff_year (
  season                    int  PRIMARY KEY,
  num_teams                 int  NOT NULL,
  format                    text NOT NULL CHECK (format IN (
                              'division_bracket_1980_1993',
                              'conference_bracket_1994_2013',
                              'divisional_2014_present'
                            )),
  champion_franchise_id     text REFERENCES public.nhl_franchise(id),
  conn_smythe_player_name   text,
  conn_smythe_hr_id         text,
  conn_smythe_franchise_id  text REFERENCES public.nhl_franchise(id),
  conn_smythe_stat_line     text
);

CREATE INDEX idx_nhl_playoff_year_champion
  ON public.nhl_playoff_year(champion_franchise_id);

-- ── 4. nhl_playoff_series ───────────────────────────────────────────────────
-- One row per series. Stable text id like '2025-East-R1-0' (or
-- '2025-East-Atlantic-R1-0' for divisional-bracket rounds) so re-imports
-- upsert idempotently. All NHL playoff rounds are best-of-7 in the modern
-- era, so no series-format column is needed at v1.
CREATE TABLE public.nhl_playoff_series (
  id                  text PRIMARY KEY,
  season              int  NOT NULL REFERENCES public.nhl_playoff_year(season) ON DELETE CASCADE,
  round               int  NOT NULL,
  conference          text NOT NULL,
  division            text,
  bracket_position    int  NOT NULL,
  franchise_a_id      text REFERENCES public.nhl_franchise(id),
  franchise_b_id      text REFERENCES public.nhl_franchise(id),
  seed_a              int,
  seed_b              int,
  winner_franchise_id text REFERENCES public.nhl_franchise(id),
  wins_a              int  NOT NULL DEFAULT 0,
  wins_b              int  NOT NULL DEFAULT 0,
  UNIQUE (season, round, conference, division, bracket_position)
);

CREATE INDEX idx_nhl_playoff_series_by_season   ON public.nhl_playoff_series(season);
CREATE INDEX idx_nhl_playoff_series_franchise_a ON public.nhl_playoff_series(franchise_a_id);
CREATE INDEX idx_nhl_playoff_series_franchise_b ON public.nhl_playoff_series(franchise_b_id);
CREATE INDEX idx_nhl_playoff_series_winner      ON public.nhl_playoff_series(winner_franchise_id);

-- ── 5. nhl_playoff_game ─────────────────────────────────────────────────────
-- ot_periods captures any OT (regular season SO doesn't apply in playoffs).
-- shootout column is reserved for the rare regular-season-rule playoff games
-- (none in modern NHL playoffs) — keeping it simplifies any future expansion.
CREATE TABLE public.nhl_playoff_game (
  series_id         text NOT NULL REFERENCES public.nhl_playoff_series(id) ON DELETE CASCADE,
  game_num          int  NOT NULL,
  home_franchise_id text REFERENCES public.nhl_franchise(id),
  away_franchise_id text REFERENCES public.nhl_franchise(id),
  home_score        int,
  away_score        int,
  ot_periods        int  NOT NULL DEFAULT 0,
  shootout          bool NOT NULL DEFAULT false,
  played_on         date,
  PRIMARY KEY (series_id, game_num)
);

CREATE INDEX idx_nhl_playoff_game_home ON public.nhl_playoff_game(home_franchise_id);
CREATE INDEX idx_nhl_playoff_game_away ON public.nhl_playoff_game(away_franchise_id);

-- ── 6. nhl_playoff_player_stats ─────────────────────────────────────────────
-- Single table for both skaters and goalies, disambiguated by `position`.
-- Skater rows populate goals/assists/points/plus_minus/pim/sog with goalie
-- columns NULL; goalie rows populate gaa/sv_pct/shutouts with skater columns
-- NULL. Cleaner for the UI than two separate tables when rendering "top
-- playoff performers" lists.
CREATE TABLE public.nhl_playoff_player_stats (
  season       int  NOT NULL REFERENCES public.nhl_playoff_year(season) ON DELETE CASCADE,
  franchise_id text NOT NULL REFERENCES public.nhl_franchise(id),
  hr_player_id text NOT NULL,
  player_name  text NOT NULL,
  position     text NOT NULL CHECK (position IN ('F','D','G')),
  gp           int  NOT NULL DEFAULT 0,
  -- Skater stats
  goals        int,
  assists      int,
  points       int,
  plus_minus   int,
  pim          int,
  sog          int,
  -- Goalie stats
  wins         int,
  losses       int,
  gaa          numeric(4,2),
  sv_pct       numeric(4,3),
  shutouts     int,
  PRIMARY KEY (season, franchise_id, hr_player_id)
);

CREATE INDEX idx_nhl_playoff_player_stats_franchise
  ON public.nhl_playoff_player_stats(franchise_id);

-- ── 7. nhl_regular_season_standing ──────────────────────────────────────────
-- Points-based standings (W=2, OTL=1) since 2005-06. Pre-lockout is W/L only
-- but fits in the same shape (otl=0). Includes both conference and division
-- seeds since the divisional-bracket era uses division seed for matchups.
CREATE TABLE public.nhl_regular_season_standing (
  season           int  NOT NULL REFERENCES public.nhl_playoff_year(season) ON DELETE CASCADE,
  franchise_id     text NOT NULL REFERENCES public.nhl_franchise(id),
  wins             int  NOT NULL,
  losses           int  NOT NULL,
  otl              int  NOT NULL DEFAULT 0,
  points           int  NOT NULL,
  conference       text NOT NULL,
  division         text NOT NULL,
  conference_seed  int  NOT NULL,
  division_seed    int  NOT NULL,
  goals_for        int,
  goals_against    int,
  PRIMARY KEY (season, franchise_id)
);

CREATE INDEX idx_nhl_regular_season_standing_seed
  ON public.nhl_regular_season_standing(season, conference, conference_seed);
CREATE INDEX idx_nhl_regular_season_standing_franchise
  ON public.nhl_regular_season_standing(franchise_id);

-- ── 8. nhl_season_award ─────────────────────────────────────────────────────
-- One row per (season, award_type, rank). Solo awards use rank=1; selection
-- teams (all_star_first/second, all_rookie) use rank=1..6 (NHL all-star teams
-- are 6 players: G/2D/3F).
CREATE TABLE public.nhl_season_award (
  season         int  NOT NULL REFERENCES public.nhl_playoff_year(season) ON DELETE CASCADE,
  award_type     text NOT NULL CHECK (award_type IN (
    'hart', 'norris', 'vezina', 'calder', 'selke', 'lady_byng',
    'jack_adams', 'ted_lindsay', 'rocket_richard', 'art_ross',
    'conn_smythe', 'presidents_trophy',
    'all_star_first', 'all_star_second', 'all_rookie'
  )),
  rank           int  NOT NULL DEFAULT 1,
  player_name    text NOT NULL,
  hr_player_id   text,
  franchise_id   text REFERENCES public.nhl_franchise(id),
  position       text,
  stat_line      text,
  PRIMARY KEY (season, award_type, rank)
);

CREATE INDEX idx_nhl_season_award_franchise
  ON public.nhl_season_award(season, franchise_id);

-- ── 9. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.nhl_franchise               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_franchise_season        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_playoff_year            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_playoff_series          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_playoff_game            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_playoff_player_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_regular_season_standing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nhl_season_award            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read nhl_franchise"
  ON public.nhl_franchise FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nhl_franchise_season"
  ON public.nhl_franchise_season FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nhl_playoff_year"
  ON public.nhl_playoff_year FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nhl_playoff_series"
  ON public.nhl_playoff_series FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nhl_playoff_game"
  ON public.nhl_playoff_game FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nhl_playoff_player_stats"
  ON public.nhl_playoff_player_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nhl_regular_season_standing"
  ON public.nhl_regular_season_standing FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nhl_season_award"
  ON public.nhl_season_award FOR SELECT TO authenticated USING (true);

-- ── 10. RPCs ────────────────────────────────────────────────────────────────
-- All read-only, SECURITY INVOKER so RLS still applies. Fully qualified refs
-- with empty search_path per the project's hardening convention.

CREATE OR REPLACE FUNCTION public.nhl_archive_seasons()
RETURNS TABLE (
  season                   int,
  champion_franchise_id    text,
  champion_tricode         text,
  champion_city            text,
  champion_name            text,
  champion_logo_key        text,
  champion_primary_color   text,
  champion_secondary_color text
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT y.season,
         y.champion_franchise_id,
         fs.tricode         AS champion_tricode,
         fs.city            AS champion_city,
         fs.name            AS champion_name,
         fs.logo_key        AS champion_logo_key,
         fs.primary_color   AS champion_primary_color,
         fs.secondary_color AS champion_secondary_color
    FROM public.nhl_playoff_year y
    LEFT JOIN public.nhl_franchise_season fs
      ON fs.franchise_id = y.champion_franchise_id
     AND fs.season       = y.season
   ORDER BY y.season DESC;
$$;

CREATE OR REPLACE FUNCTION public.nhl_archive_bracket(p_season int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'year', (SELECT to_jsonb(y) FROM public.nhl_playoff_year y WHERE y.season = p_season),
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
      FROM public.nhl_franchise_season fs
      JOIN public.nhl_franchise f ON f.id = fs.franchise_id
      WHERE fs.season = p_season
    ), '[]'::jsonb),
    'series', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.round, s.conference, s.division NULLS LAST, s.bracket_position)
      FROM public.nhl_playoff_series s
      WHERE s.season = p_season
    ), '[]'::jsonb),
    'games', COALESCE((
      SELECT jsonb_agg(to_jsonb(g) ORDER BY g.series_id, g.game_num)
      FROM public.nhl_playoff_game g
      JOIN public.nhl_playoff_series s ON s.id = g.series_id
      WHERE s.season = p_season
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.nhl_archive_standings(p_season int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'standings', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'franchise_id',    st.franchise_id,
          'wins',            st.wins,
          'losses',          st.losses,
          'otl',             st.otl,
          'points',          st.points,
          'conference',      st.conference,
          'division',        st.division,
          'conference_seed', st.conference_seed,
          'division_seed',   st.division_seed,
          'goals_for',       st.goals_for,
          'goals_against',   st.goals_against,
          'name',            fs.name,
          'city',            fs.city,
          'tricode',         fs.tricode,
          'primary_color',   fs.primary_color,
          'secondary_color', fs.secondary_color,
          'logo_key',        fs.logo_key
        )
        ORDER BY st.conference, st.conference_seed
      )
      FROM public.nhl_regular_season_standing st
      JOIN public.nhl_franchise_season fs
        ON fs.franchise_id = st.franchise_id AND fs.season = st.season
      WHERE st.season = p_season
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.nhl_archive_awards(p_season int)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT COALESCE(
    jsonb_object_agg(award_type, rows),
    '{}'::jsonb
  )
  FROM (
    SELECT
      a.award_type,
      jsonb_agg(
        jsonb_build_object(
          'rank',         a.rank,
          'player_name',  a.player_name,
          'hr_player_id', a.hr_player_id,
          'franchise_id', a.franchise_id,
          'position',     a.position,
          'stat_line',    a.stat_line
        )
        ORDER BY a.rank
      ) AS rows
    FROM public.nhl_season_award a
    WHERE a.season = p_season
    GROUP BY a.award_type
  ) grouped;
$$;

CREATE OR REPLACE FUNCTION public.nhl_archive_team_run(p_season int, p_franchise_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'franchise', (
      SELECT jsonb_build_object(
        'franchise_id',    fs.franchise_id,
        'name',            fs.name,
        'city',            fs.city,
        'tricode',         fs.tricode,
        'primary_color',   fs.primary_color,
        'secondary_color', fs.secondary_color,
        'logo_key',        fs.logo_key,
        'conference',      fs.conference,
        'division',        fs.division
      )
      FROM public.nhl_franchise_season fs
      WHERE fs.franchise_id = p_franchise_id AND fs.season = p_season
    ),
    'standing', (
      SELECT to_jsonb(st)
      FROM public.nhl_regular_season_standing st
      WHERE st.franchise_id = p_franchise_id AND st.season = p_season
    ),
    'series', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.round, s.bracket_position)
      FROM public.nhl_playoff_series s
      WHERE s.season = p_season
        AND (s.franchise_a_id = p_franchise_id OR s.franchise_b_id = p_franchise_id)
    ), '[]'::jsonb),
    'top_players', COALESCE((
      SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.points DESC NULLS LAST)
      FROM (
        SELECT * FROM public.nhl_playoff_player_stats
        WHERE season = p_season AND franchise_id = p_franchise_id
        ORDER BY points DESC NULLS LAST
        LIMIT 5
      ) ps
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.nhl_archive_seasons()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.nhl_archive_bracket(int)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.nhl_archive_standings(int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.nhl_archive_awards(int)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.nhl_archive_team_run(int, text)         TO authenticated;

COMMIT;
