-- ============================================================
-- Prospects: extend players table + new tables for boards & news
-- ============================================================

-- 1. Extend players table with prospect-specific columns
ALTER TABLE players
  ADD COLUMN IF NOT EXISTS contentful_entry_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS is_prospect boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS school text,
  ADD COLUMN IF NOT EXISTS dynasty_value_score smallint;

-- Index for Prospects Hub query (is_prospect + status filter)
CREATE INDEX IF NOT EXISTS idx_players_prospect
  ON players (is_prospect, status)
  WHERE is_prospect = true;

-- Validate dynasty score range via check constraint
ALTER TABLE players
  ADD CONSTRAINT chk_dynasty_score
  CHECK (dynasty_value_score IS NULL OR (dynasty_value_score >= 1 AND dynasty_value_score <= 100));

-- 2. Prospect boards (My Board — personal prospect rankings)
CREATE TABLE prospect_boards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  rank smallint NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, player_id)
);

CREATE INDEX idx_prospect_boards_user ON prospect_boards(user_id);

ALTER TABLE prospect_boards ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own board"
  ON prospect_boards FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- 3. Prospect news (separate from player_news — different RSS sources)
CREATE TABLE prospect_news (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id text NOT NULL UNIQUE,
  title text NOT NULL,
  description text,
  link text NOT NULL,
  source text NOT NULL,
  published_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE prospect_news_mentions (
  news_id uuid NOT NULL REFERENCES prospect_news(id) ON DELETE CASCADE,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (news_id, player_id)
);

CREATE INDEX idx_prospect_news_mentions_player ON prospect_news_mentions(player_id);

-- RLS: prospect news is read-only for authenticated users
ALTER TABLE prospect_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospect_news_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users read prospect news"
  ON prospect_news FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users read prospect news mentions"
  ON prospect_news_mentions FOR SELECT
  USING (auth.role() = 'authenticated');
