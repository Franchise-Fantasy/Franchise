-- Real NBA playoff history archive — fully decoupled from the fantasy schema.
-- v1 ingests a single season (2024–25); the schema supports any season from
-- the 1976–77 NBA-ABA merger forward, populated by
-- scripts/import-nba-playoff-archive.mjs (Basketball-Reference scrape).
--
-- Reads: any authenticated user (UI gating is handled in-app via a feature
-- flag — the *content* itself isn't sensitive).
-- Writes: service role only (no RLS write policies).

BEGIN;

-- ── 1. pro_franchise ────────────────────────────────────────────────────────
-- Abstract franchise identity. Sonics→Thunder share id 'OKC'. The two
-- Charlotte Hornets eras get separate ids since the 2004 expansion is a
-- distinct franchise that adopted the original Hornets identity in 2014.
CREATE TABLE public.pro_franchise (
  id           text PRIMARY KEY,
  current_name text NOT NULL,
  current_city text NOT NULL,
  founded_year int  NOT NULL,
  notes        text
);

-- ── 2. pro_franchise_season ─────────────────────────────────────────────────
-- Per-season skin. Lets us render the right name/colors for any historical
-- year without losing the abstract franchise identity.
CREATE TABLE public.pro_franchise_season (
  franchise_id    text NOT NULL REFERENCES public.pro_franchise(id) ON DELETE CASCADE,
  season          int  NOT NULL,
  name            text NOT NULL,
  city            text NOT NULL,
  tricode         text NOT NULL,
  primary_color   text,
  secondary_color text,
  logo_key        text,
  conference      text NOT NULL CHECK (conference IN ('East','West')),
  PRIMARY KEY (franchise_id, season)
);

CREATE INDEX idx_pro_franchise_season_by_season
  ON public.pro_franchise_season(season);

-- ── 3. pro_playoff_year ─────────────────────────────────────────────────────
-- Per-year format metadata. Bracket shape changed several times since '77:
-- 1977–83 = 12 teams w/ first-round byes; 1984+ = 16 teams; 2020+ = play-in.
CREATE TABLE public.pro_playoff_year (
  season                int  PRIMARY KEY,
  num_teams             int  NOT NULL,
  has_play_in           bool NOT NULL DEFAULT false,
  first_round_format    text NOT NULL
                        CHECK (first_round_format IN ('best_of_3','best_of_5','best_of_7')),
  champion_franchise_id text REFERENCES public.pro_franchise(id)
);

CREATE INDEX idx_pro_playoff_year_champion
  ON public.pro_playoff_year(champion_franchise_id);

-- ── 4. pro_playoff_series ───────────────────────────────────────────────────
-- One row per series. Stable text id like '2025-East-R1-0' so re-imports
-- upsert idempotently and game rows can FK by a single column.
CREATE TABLE public.pro_playoff_series (
  id                  text PRIMARY KEY,
  season              int  NOT NULL REFERENCES public.pro_playoff_year(season) ON DELETE CASCADE,
  round               int  NOT NULL,
  conference          text NOT NULL CHECK (conference IN ('East','West','Finals')),
  bracket_position    int  NOT NULL,
  franchise_a_id      text REFERENCES public.pro_franchise(id),
  franchise_b_id      text REFERENCES public.pro_franchise(id),
  seed_a              int,
  seed_b              int,
  winner_franchise_id text REFERENCES public.pro_franchise(id),
  wins_a              int  NOT NULL DEFAULT 0,
  wins_b              int  NOT NULL DEFAULT 0,
  UNIQUE (season, round, conference, bracket_position)
);

CREATE INDEX idx_pro_playoff_series_by_season ON public.pro_playoff_series(season);
CREATE INDEX idx_pro_playoff_series_franchise_a ON public.pro_playoff_series(franchise_a_id);
CREATE INDEX idx_pro_playoff_series_franchise_b ON public.pro_playoff_series(franchise_b_id);
CREATE INDEX idx_pro_playoff_series_winner ON public.pro_playoff_series(winner_franchise_id);

-- ── 5. pro_playoff_game ─────────────────────────────────────────────────────
CREATE TABLE public.pro_playoff_game (
  series_id         text NOT NULL REFERENCES public.pro_playoff_series(id) ON DELETE CASCADE,
  game_num          int  NOT NULL,
  home_franchise_id text REFERENCES public.pro_franchise(id),
  away_franchise_id text REFERENCES public.pro_franchise(id),
  home_score        int,
  away_score        int,
  ot_periods        int  NOT NULL DEFAULT 0,
  played_on         date,
  PRIMARY KEY (series_id, game_num)
);

CREATE INDEX idx_pro_playoff_game_home ON public.pro_playoff_game(home_franchise_id);
CREATE INDEX idx_pro_playoff_game_away ON public.pro_playoff_game(away_franchise_id);

-- ── 6. pro_playoff_player_stats ─────────────────────────────────────────────
-- Decoupled from the fantasy `players` table. bbref_player_id is the
-- Basketball-Reference slug (e.g. 'jokicni01').
CREATE TABLE public.pro_playoff_player_stats (
  season          int  NOT NULL REFERENCES public.pro_playoff_year(season) ON DELETE CASCADE,
  franchise_id    text NOT NULL REFERENCES public.pro_franchise(id),
  bbref_player_id text NOT NULL,
  player_name     text NOT NULL,
  gp              int  NOT NULL DEFAULT 0,
  min_per         numeric(5,1),
  pts_per         numeric(5,1),
  reb_per         numeric(5,1),
  ast_per         numeric(5,1),
  stl_per         numeric(4,1),
  blk_per         numeric(4,1),
  fg_pct          numeric(4,3),
  tp_pct          numeric(4,3),
  ft_pct          numeric(4,3),
  PRIMARY KEY (season, franchise_id, bbref_player_id)
);

CREATE INDEX idx_pro_playoff_player_stats_franchise
  ON public.pro_playoff_player_stats(franchise_id);

-- ── 7. pro_regular_season_standing ──────────────────────────────────────────
CREATE TABLE public.pro_regular_season_standing (
  season               int  NOT NULL REFERENCES public.pro_playoff_year(season) ON DELETE CASCADE,
  franchise_id         text NOT NULL REFERENCES public.pro_franchise(id),
  wins                 int  NOT NULL,
  losses               int  NOT NULL,
  conference           text NOT NULL CHECK (conference IN ('East','West')),
  conference_seed      int  NOT NULL,
  pts_per_game         numeric(5,1),
  pts_allowed_per_game numeric(5,1),
  srs                  numeric(5,2),
  PRIMARY KEY (season, franchise_id)
);

CREATE INDEX idx_pro_regular_season_standing_seed
  ON public.pro_regular_season_standing(season, conference, conference_seed);
CREATE INDEX idx_pro_regular_season_standing_franchise
  ON public.pro_regular_season_standing(franchise_id);

-- ── 8. RLS ──────────────────────────────────────────────────────────────────
ALTER TABLE public.pro_franchise               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_franchise_season        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_playoff_year            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_playoff_series          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_playoff_game            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_playoff_player_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pro_regular_season_standing ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read pro_franchise"
  ON public.pro_franchise FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read pro_franchise_season"
  ON public.pro_franchise_season FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read pro_playoff_year"
  ON public.pro_playoff_year FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read pro_playoff_series"
  ON public.pro_playoff_series FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read pro_playoff_game"
  ON public.pro_playoff_game FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read pro_playoff_player_stats"
  ON public.pro_playoff_player_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read pro_regular_season_standing"
  ON public.pro_regular_season_standing FOR SELECT TO authenticated USING (true);

-- ── 9. RPCs ─────────────────────────────────────────────────────────────────
-- All read-only, SECURITY INVOKER so RLS still applies. Fully qualified refs
-- with empty search_path per the project's hardening convention.

CREATE OR REPLACE FUNCTION public.pro_archive_seasons()
RETURNS TABLE (season int)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT y.season FROM public.pro_playoff_year y ORDER BY y.season DESC;
$$;

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
      SELECT jsonb_agg(to_jsonb(g) ORDER BY g.series_id, g.game_num)
      FROM public.pro_playoff_game g
      JOIN public.pro_playoff_series s ON s.id = g.series_id
      WHERE s.season = p_season
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.pro_archive_standings(p_season int)
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
          'franchise_id', st.franchise_id,
          'wins', st.wins,
          'losses', st.losses,
          'conference', st.conference,
          'conference_seed', st.conference_seed,
          'pts_per_game', st.pts_per_game,
          'pts_allowed_per_game', st.pts_allowed_per_game,
          'srs', st.srs,
          'name', fs.name,
          'city', fs.city,
          'tricode', fs.tricode,
          'primary_color', fs.primary_color,
          'secondary_color', fs.secondary_color,
          'logo_key', fs.logo_key
        )
        ORDER BY st.conference, st.conference_seed
      )
      FROM public.pro_regular_season_standing st
      JOIN public.pro_franchise_season fs
        ON fs.franchise_id = st.franchise_id AND fs.season = st.season
      WHERE st.season = p_season
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.pro_archive_team_run(p_season int, p_franchise_id text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'franchise', (
      SELECT jsonb_build_object(
        'franchise_id', fs.franchise_id,
        'name', fs.name,
        'city', fs.city,
        'tricode', fs.tricode,
        'primary_color', fs.primary_color,
        'secondary_color', fs.secondary_color,
        'logo_key', fs.logo_key,
        'conference', fs.conference
      )
      FROM public.pro_franchise_season fs
      WHERE fs.franchise_id = p_franchise_id AND fs.season = p_season
    ),
    'standing', (
      SELECT to_jsonb(st)
      FROM public.pro_regular_season_standing st
      WHERE st.franchise_id = p_franchise_id AND st.season = p_season
    ),
    'series', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.round, s.bracket_position)
      FROM public.pro_playoff_series s
      WHERE s.season = p_season
        AND (s.franchise_a_id = p_franchise_id OR s.franchise_b_id = p_franchise_id)
    ), '[]'::jsonb),
    'top_players', COALESCE((
      SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.pts_per DESC NULLS LAST)
      FROM (
        SELECT * FROM public.pro_playoff_player_stats
        WHERE season = p_season AND franchise_id = p_franchise_id
        ORDER BY pts_per DESC NULLS LAST
        LIMIT 5
      ) ps
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.pro_archive_seasons()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.pro_archive_bracket(int)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.pro_archive_standings(int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.pro_archive_team_run(int, text)         TO authenticated;

COMMIT;
