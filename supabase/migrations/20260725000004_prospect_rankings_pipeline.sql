-- ============================================================
-- Prospect rankings pipeline (CMS/Noah handoff — "adopt his model")
--
-- The weekly scraper (franchise-fantasy-rankings GitHub Action) blends public
-- NBA draft boards into one consensus rank per draft year and writes it here,
-- joining to Contentful's `prospectProfile` entries on the player SLUG. This
-- migration adds the pipeline's tables AND the `players.player_slug` bridge so
-- a published prospect still mints a draftable `players` row (see the rewired
-- sync-prospect webhook). Runner writes with the service_role key (bypasses
-- RLS); the app reads as an authenticated user.
--
-- Differences from Noah's sql/schema.sql, on purpose:
--   * RLS read policies gate to `authenticated` (matches prospect_news), not
--     his public `using (true)` — the app's users are always signed in.
--   * Adds the `players.player_slug` join bridge + per-sport unique index.
-- ============================================================

-- ── Bridge: slug ↔ players.id ────────────────────────────────
-- The scraper/Contentful join key. Populated by the sync-prospect webhook from
-- the published entry's `slug` field (no SQL slugify — the slug is authoritative
-- from Contentful, avoiding TS↔SQL drift). Unique per sport (NBA/WNBA/NFL share
-- this table and can legitimately reuse a slug); partial so non-prospects stay
-- NULL without tripping the constraint.
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS player_slug text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_players_sport_slug
  ON players (sport, player_slug)
  WHERE player_slug IS NOT NULL;

-- ── Consensus board: one row per player per draft year ───────
CREATE TABLE IF NOT EXISTS prospect_rankings (
  player_slug text NOT NULL,
  draft_year int NOT NULL,
  full_name text NOT NULL,
  position text,
  school text,
  team text,                        -- actual current NBA team once drafted (updates weekly, tracks trades)
  display_rank int NOT NULL,        -- 1..N within draft_year; what the app sorts by
  consensus_score numeric NOT NULL, -- blended cross-source score (internal — never surfaced in UI)
  source_ranks jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"nbadraft":3,"tankathon":5} (internal)
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_slug, draft_year)
);

-- One snapshot per player per scrape run; powers the riser/faller arrows.
CREATE TABLE IF NOT EXISTS rank_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_slug text NOT NULL,
  draft_year int NOT NULL,
  display_rank int NOT NULL,
  consensus_score numeric NOT NULL,
  scraped_on date NOT NULL DEFAULT current_date,
  UNIQUE (player_slug, draft_year, scraped_on)
);

CREATE INDEX IF NOT EXISTS rank_history_lookup
  ON rank_history (player_slug, draft_year, scraped_on DESC);

-- What the app reads: current board + movement vs. the previous snapshot.
-- rank_change > 0 rose (green ▲), < 0 fell (red ▼), 0 steady, NULL new ("NEW").
-- consensus_score / source_ranks are deliberately NOT projected here — the UI
-- only ever shows the blended display_rank (legal posture; see README).
CREATE OR REPLACE VIEW prospect_board
WITH (security_invoker = on) AS
SELECT
  r.player_slug,
  r.draft_year,
  r.full_name,
  r.position,
  r.school,
  r.team,
  r.display_rank,
  r.updated_at,
  prev.display_rank - r.display_rank AS rank_change
FROM prospect_rankings r
LEFT JOIN LATERAL (
  SELECT h.display_rank
  FROM rank_history h
  WHERE h.player_slug = r.player_slug
    AND h.draft_year = r.draft_year
    AND h.scraped_on < (
      SELECT max(scraped_on) FROM rank_history
      WHERE player_slug = r.player_slug AND draft_year = r.draft_year
    )
  ORDER BY h.scraped_on DESC
  LIMIT 1
) prev ON true;

-- ── Recent game lines (ESPN public APIs) ─────────────────────
-- ESPN athlete id mapping, resolved automatically by roster name-match.
CREATE TABLE IF NOT EXISTS player_ids (
  player_slug text PRIMARY KEY,
  espn_college_id text,
  espn_nba_id text,
  resolved_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS recent_games (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  player_slug text NOT NULL,
  competition text NOT NULL,        -- 'college' | 'summer-league' | 'nba'
  game_date date NOT NULL,
  opponent text,
  minutes int,
  points int,
  rebounds int,
  assists int,
  steals int,
  blocks int,
  turnovers int,
  fg text,                          -- "6-9"
  fg3 text,                         -- "1-2"
  ft text,                          -- "3-3"
  synced_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (player_slug, competition, game_date)
);

CREATE INDEX IF NOT EXISTS recent_games_lookup
  ON recent_games (player_slug, game_date DESC);

-- Newest 3 game lines per player across all competitions — the app's
-- "Recent games" card section.
CREATE OR REPLACE VIEW player_last_games
WITH (security_invoker = on) AS
SELECT * FROM (
  SELECT rg.*,
         row_number() OVER (PARTITION BY player_slug ORDER BY game_date DESC) AS game_no
  FROM recent_games rg
) g
WHERE game_no <= 3;

-- ── RLS: authenticated read; only service_role (the weekly job) writes ────
ALTER TABLE prospect_rankings ENABLE ROW LEVEL SECURITY;
ALTER TABLE rank_history      ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_ids        ENABLE ROW LEVEL SECURITY;
ALTER TABLE recent_games      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read prospect rankings" ON prospect_rankings;
CREATE POLICY "Authenticated read prospect rankings" ON prospect_rankings
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated read rank history" ON rank_history;
CREATE POLICY "Authenticated read rank history" ON rank_history
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated read player ids" ON player_ids;
CREATE POLICY "Authenticated read player ids" ON player_ids
  FOR SELECT USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Authenticated read recent games" ON recent_games;
CREATE POLICY "Authenticated read recent games" ON recent_games
  FOR SELECT USING (auth.role() = 'authenticated');
