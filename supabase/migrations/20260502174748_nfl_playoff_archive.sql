-- Real NFL playoff history archive — fully decoupled from the fantasy schema
-- and from the parallel NBA/NHL archives (`pro_*` and `nhl_*`). Schema mirrors
-- the NHL archive shape so the React layer can stay consistent, but with
-- NFL-specific fields (single-game series, ties in standings, curated headline
-- box rows by category, position-aware All-Pro selections).
--
-- Scope covers the entire Super Bowl era (1966 NFL season → present). The
-- `format` enum on nfl_playoff_year captures the six bracket eras (pre-merger
-- AFL/NFL → 4-team-per-conf 1970-77 → 5-team 1978-89 → 6-team 1990-2001
-- → 6-team-4-div 2002-2019 → 7-team modern). v0 ships only standings; series
-- and awards are populated as the corpus is hand-curated/scraped.
--
-- Reads: any authenticated user (UI gating handled in-app via a
-- developer-only feature flag — content itself isn't sensitive).
-- Writes: service role only (no RLS write policies).

BEGIN;

-- ── 1. nfl_franchise ────────────────────────────────────────────────────────
-- Abstract franchise identity. Pre-merger AFL identities resolve to their
-- modern franchise IDs: Boston Patriots → NE, NY Titans → NYJ, Houston
-- Oilers → TEN, Dallas Texans → KC, Baltimore Colts → IND, San Diego →
-- LAC, Oakland → LV, St Louis Rams → LAR, St Louis Cardinals → ARI.
-- The Cleveland Browns 1996-1998 hiatus and 1999 expansion both share id
-- 'CLE' (the hiatus era is captured via gaps in nfl_franchise_season).
CREATE TABLE public.nfl_franchise (
  id           text PRIMARY KEY,
  current_name text NOT NULL,
  current_city text NOT NULL,
  founded_year int  NOT NULL,
  notes        text
);

-- ── 2. nfl_franchise_season ─────────────────────────────────────────────────
-- Per-season skin. Conference is permissive ('AFC'/'NFC' post-merger;
-- 'AFL'/'NFL' for 1966-69) and division varies by era ('AFC East/Central/West'
-- 1970-2001, 'AFC East/North/South/West' 2002+, AFL-era division names like
-- 'AFL East' / 'NFL Capitol' etc). No CHECK constraints — data drives layout.
CREATE TABLE public.nfl_franchise_season (
  franchise_id    text NOT NULL REFERENCES public.nfl_franchise(id) ON DELETE CASCADE,
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

CREATE INDEX idx_nfl_franchise_season_by_season
  ON public.nfl_franchise_season(season);

-- ── 3. nfl_playoff_year ─────────────────────────────────────────────────────
-- Per-year format metadata + champion + Super Bowl MVP (the NFL equivalent
-- of NBA's Finals MVP / NHL's Conn Smythe). The `format` enum captures
-- bracket-shape eras since the schema covers any Super Bowl-era season.
-- super_bowl_number stored as int (e.g. 59 for SB LIX) so consumers can
-- format the Roman numeral in the UI.
CREATE TABLE public.nfl_playoff_year (
  season                    int  PRIMARY KEY,
  num_teams                 int  NOT NULL,
  format                    text NOT NULL CHECK (format IN (
                              'pre_merger_1966_1969',
                              'four_team_1970_1977',
                              'five_team_1978_1989',
                              'six_team_1990_2001',
                              'six_team_2002_2019',
                              'modern_seven_2020'
                            )),
  champion_franchise_id     text REFERENCES public.nfl_franchise(id),
  super_bowl_number         int,
  sb_mvp_player_name        text,
  sb_mvp_pfr_id             text,
  sb_mvp_franchise_id       text REFERENCES public.nfl_franchise(id),
  sb_mvp_stat_line          text
);

CREATE INDEX idx_nfl_playoff_year_champion
  ON public.nfl_playoff_year(champion_franchise_id);

-- ── 4. nfl_playoff_series ───────────────────────────────────────────────────
-- One row per bracket slot. NFL playoffs are single-elimination so each
-- series has exactly one game — wins_a/wins_b will always be 0/1 — but the
-- table exists so the bracket-render shape stays parallel to NBA/NHL.
-- Stable text id like '2024-AFC-WC-0' / '2024-SB' / '1968-AFL-CG' so
-- re-imports upsert idempotently.
CREATE TABLE public.nfl_playoff_series (
  id                  text PRIMARY KEY,
  season              int  NOT NULL REFERENCES public.nfl_playoff_year(season) ON DELETE CASCADE,
  round               int  NOT NULL,
  conference          text NOT NULL,
  bracket_position    int  NOT NULL,
  franchise_a_id      text REFERENCES public.nfl_franchise(id),
  franchise_b_id      text REFERENCES public.nfl_franchise(id),
  seed_a              int,
  seed_b              int,
  winner_franchise_id text REFERENCES public.nfl_franchise(id),
  wins_a              int  NOT NULL DEFAULT 0,
  wins_b              int  NOT NULL DEFAULT 0,
  UNIQUE (season, round, conference, bracket_position)
);

CREATE INDEX idx_nfl_playoff_series_by_season   ON public.nfl_playoff_series(season);
CREATE INDEX idx_nfl_playoff_series_franchise_a ON public.nfl_playoff_series(franchise_a_id);
CREATE INDEX idx_nfl_playoff_series_franchise_b ON public.nfl_playoff_series(franchise_b_id);
CREATE INDEX idx_nfl_playoff_series_winner      ON public.nfl_playoff_series(winner_franchise_id);

-- ── 5. nfl_playoff_game ─────────────────────────────────────────────────────
-- One row per series in NFL. ot_periods captures recurring playoff OT
-- (rarer than NHL but possible). Venue + attendance are nice-to-haves
-- since SB venues are part of the cultural memory.
CREATE TABLE public.nfl_playoff_game (
  series_id         text NOT NULL REFERENCES public.nfl_playoff_series(id) ON DELETE CASCADE,
  game_num          int  NOT NULL,
  home_franchise_id text REFERENCES public.nfl_franchise(id),
  away_franchise_id text REFERENCES public.nfl_franchise(id),
  home_score        int,
  away_score        int,
  ot_periods        int  NOT NULL DEFAULT 0,
  played_on         date,
  venue             text,
  attendance        int,
  PRIMARY KEY (series_id, game_num)
);

CREATE INDEX idx_nfl_playoff_game_home ON public.nfl_playoff_game(home_franchise_id);
CREATE INDEX idx_nfl_playoff_game_away ON public.nfl_playoff_game(away_franchise_id);

-- ── 6. nfl_playoff_game_box ─────────────────────────────────────────────────
-- Curated headline rows per game side. ~3-5 rows per side covering passer,
-- lead rusher, lead receiver, defensive standout, kicker if relevant. Free
-- stat_line text is the source of truth; structured columns are populated
-- by category for sortability/comparison.
CREATE TABLE public.nfl_playoff_game_box (
  series_id     text NOT NULL,
  game_num      int  NOT NULL,
  side          text NOT NULL CHECK (side IN ('a','b')),
  rank          int  NOT NULL,
  category      text NOT NULL CHECK (category IN (
                  'passer','rusher','receiver','defense','kicker','returner','team'
                )),
  player_id     text,
  player_name   text NOT NULL,
  position      text,
  stat_line     text NOT NULL,
  -- Passing
  pass_att      int,
  pass_cmp      int,
  pass_yds      int,
  pass_td       int,
  pass_int      int,
  -- Rushing
  rush_att      int,
  rush_yds      int,
  rush_td       int,
  -- Receiving
  rec           int,
  rec_yds       int,
  rec_td        int,
  -- Defense
  tackles       int,
  sacks         numeric(3,1),
  int_def       int,
  ff            int,
  fr            int,
  td_def        int,
  PRIMARY KEY (series_id, game_num, side, rank),
  FOREIGN KEY (series_id, game_num)
    REFERENCES public.nfl_playoff_game(series_id, game_num) ON DELETE CASCADE
);

CREATE INDEX idx_nfl_playoff_game_box_by_game
  ON public.nfl_playoff_game_box(series_id, game_num);

-- ── 7. nfl_playoff_player_stats ─────────────────────────────────────────────
-- Generic per-player series-aggregated line. Sorted by `approx_value` (PFR
-- AV) for "top performers" lists; structured rollups duplicated from box so
-- team-sheet rendering doesn't need joins.
CREATE TABLE public.nfl_playoff_player_stats (
  season         int  NOT NULL REFERENCES public.nfl_playoff_year(season) ON DELETE CASCADE,
  franchise_id   text NOT NULL REFERENCES public.nfl_franchise(id),
  pfr_player_id  text NOT NULL,
  player_name    text NOT NULL,
  position       text NOT NULL,
  gp             int  NOT NULL DEFAULT 0,
  approx_value   numeric(4,1),
  stat_line      text,
  -- Passing
  pass_yds       int,
  pass_td        int,
  pass_int       int,
  -- Rushing
  rush_yds       int,
  rush_td        int,
  -- Receiving
  rec            int,
  rec_yds        int,
  rec_td         int,
  -- Defense
  tackles        int,
  sacks          numeric(3,1),
  int_def        int,
  ff             int,
  fr             int,
  td_def         int,
  PRIMARY KEY (season, franchise_id, pfr_player_id)
);

CREATE INDEX idx_nfl_playoff_player_stats_franchise
  ON public.nfl_playoff_player_stats(franchise_id);

-- ── 8. nfl_regular_season_standing ──────────────────────────────────────────
-- W-L-T standings (ties are real in NFL). 17/16/14-game seasons depending
-- on era; UI computes GP from wins+losses+ties. Both conference and division
-- seeds stored since the bracket post-2002 seeds within division-winners +
-- wild cards.
CREATE TABLE public.nfl_regular_season_standing (
  season           int  NOT NULL REFERENCES public.nfl_playoff_year(season) ON DELETE CASCADE,
  franchise_id     text NOT NULL REFERENCES public.nfl_franchise(id),
  wins             int  NOT NULL,
  losses           int  NOT NULL,
  ties             int  NOT NULL DEFAULT 0,
  points_for       int,
  points_against   int,
  conference       text NOT NULL,
  division         text NOT NULL,
  conference_seed  int  NOT NULL,
  division_seed    int  NOT NULL,
  PRIMARY KEY (season, franchise_id)
);

CREATE INDEX idx_nfl_regular_season_standing_seed
  ON public.nfl_regular_season_standing(season, conference, conference_seed);
CREATE INDEX idx_nfl_regular_season_standing_franchise
  ON public.nfl_regular_season_standing(franchise_id);

-- ── 9. nfl_season_award ─────────────────────────────────────────────────────
-- One row per (season, award_type, unit, rank). Solo awards default unit=''
-- and rank=1; All-Pro selections use unit='offense'/'defense'/'st' to split
-- the team and rank=1..N within unit.
CREATE TABLE public.nfl_season_award (
  season         int  NOT NULL REFERENCES public.nfl_playoff_year(season) ON DELETE CASCADE,
  award_type     text NOT NULL CHECK (award_type IN (
    'mvp','opoy','dpoy','oroy','droy','coty','comeback',
    'walter_payton','sb_mvp','all_pro_first','all_pro_second'
  )),
  unit           text NOT NULL DEFAULT '' CHECK (unit IN ('','offense','defense','st')),
  rank           int  NOT NULL DEFAULT 1,
  player_name    text NOT NULL,
  pfr_player_id  text,
  franchise_id   text REFERENCES public.nfl_franchise(id),
  position       text,
  stat_line      text,
  PRIMARY KEY (season, award_type, unit, rank)
);

CREATE INDEX idx_nfl_season_award_franchise
  ON public.nfl_season_award(season, franchise_id);

-- ── 10. RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.nfl_franchise               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_franchise_season        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_playoff_year            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_playoff_series          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_playoff_game            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_playoff_game_box        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_playoff_player_stats    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_regular_season_standing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nfl_season_award            ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read nfl_franchise"
  ON public.nfl_franchise FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nfl_franchise_season"
  ON public.nfl_franchise_season FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nfl_playoff_year"
  ON public.nfl_playoff_year FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nfl_playoff_series"
  ON public.nfl_playoff_series FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nfl_playoff_game"
  ON public.nfl_playoff_game FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nfl_playoff_game_box"
  ON public.nfl_playoff_game_box FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nfl_playoff_player_stats"
  ON public.nfl_playoff_player_stats FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nfl_regular_season_standing"
  ON public.nfl_regular_season_standing FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated can read nfl_season_award"
  ON public.nfl_season_award FOR SELECT TO authenticated USING (true);

-- ── 11. RPCs ────────────────────────────────────────────────────────────────
-- All read-only, SECURITY INVOKER so RLS still applies. Fully qualified refs
-- with empty search_path per the project's hardening convention.

CREATE OR REPLACE FUNCTION public.nfl_archive_seasons()
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
    FROM public.nfl_playoff_year y
    LEFT JOIN public.nfl_franchise_season fs
      ON fs.franchise_id = y.champion_franchise_id
     AND fs.season       = y.season
   ORDER BY y.season DESC;
$$;

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

CREATE OR REPLACE FUNCTION public.nfl_archive_standings(p_season int)
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
          'ties',            st.ties,
          'points_for',      st.points_for,
          'points_against',  st.points_against,
          'conference',      st.conference,
          'division',        st.division,
          'conference_seed', st.conference_seed,
          'division_seed',   st.division_seed,
          'name',            fs.name,
          'city',            fs.city,
          'tricode',         fs.tricode,
          'primary_color',   fs.primary_color,
          'secondary_color', fs.secondary_color,
          'logo_key',        fs.logo_key
        )
        ORDER BY st.conference, st.conference_seed
      )
      FROM public.nfl_regular_season_standing st
      JOIN public.nfl_franchise_season fs
        ON fs.franchise_id = st.franchise_id AND fs.season = st.season
      WHERE st.season = p_season
    ), '[]'::jsonb)
  );
$$;

CREATE OR REPLACE FUNCTION public.nfl_archive_awards(p_season int)
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
          'rank',          a.rank,
          'unit',          a.unit,
          'player_name',   a.player_name,
          'pfr_player_id', a.pfr_player_id,
          'franchise_id',  a.franchise_id,
          'position',      a.position,
          'stat_line',     a.stat_line
        )
        ORDER BY a.unit, a.rank
      ) AS rows
    FROM public.nfl_season_award a
    WHERE a.season = p_season
    GROUP BY a.award_type
  ) grouped;
$$;

CREATE OR REPLACE FUNCTION public.nfl_archive_team_run(p_season int, p_franchise_id text)
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
      FROM public.nfl_franchise_season fs
      WHERE fs.franchise_id = p_franchise_id AND fs.season = p_season
    ),
    'standing', (
      SELECT to_jsonb(st)
      FROM public.nfl_regular_season_standing st
      WHERE st.franchise_id = p_franchise_id AND st.season = p_season
    ),
    'series', COALESCE((
      SELECT jsonb_agg(to_jsonb(s) ORDER BY s.round, s.bracket_position)
      FROM public.nfl_playoff_series s
      WHERE s.season = p_season
        AND (s.franchise_a_id = p_franchise_id OR s.franchise_b_id = p_franchise_id)
    ), '[]'::jsonb),
    'top_players', COALESCE((
      SELECT jsonb_agg(to_jsonb(ps) ORDER BY ps.approx_value DESC NULLS LAST)
      FROM (
        SELECT * FROM public.nfl_playoff_player_stats
        WHERE season = p_season AND franchise_id = p_franchise_id
        ORDER BY approx_value DESC NULLS LAST
        LIMIT 5
      ) ps
    ), '[]'::jsonb)
  );
$$;

GRANT EXECUTE ON FUNCTION public.nfl_archive_seasons()                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.nfl_archive_bracket(int)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.nfl_archive_standings(int)              TO authenticated;
GRANT EXECUTE ON FUNCTION public.nfl_archive_awards(int)                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.nfl_archive_team_run(int, text)         TO authenticated;

COMMIT;
