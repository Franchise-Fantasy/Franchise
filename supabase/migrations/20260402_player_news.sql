-- Player news from RSS feeds (RotoWire, FantasyPros)

CREATE TABLE player_news (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id              text NOT NULL UNIQUE,
  title                    text NOT NULL,
  description              text,
  link                     text NOT NULL,
  source                   text NOT NULL,
  published_at             timestamptz NOT NULL,
  fetched_at               timestamptz NOT NULL DEFAULT now(),
  has_minutes_restriction   boolean NOT NULL DEFAULT false,
  return_estimate          text,
  mentioned_players        jsonb NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE player_news_mentions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  news_id    uuid NOT NULL REFERENCES player_news(id) ON DELETE CASCADE,
  player_id  uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  UNIQUE (news_id, player_id)
);

CREATE INDEX idx_pnm_player    ON player_news_mentions(player_id);
CREATE INDEX idx_pnm_news      ON player_news_mentions(news_id);
CREATE INDEX idx_pn_published   ON player_news(published_at DESC);

-- RLS: read-only for authenticated users; edge function writes via service role
ALTER TABLE player_news ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_news_mentions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read news"
  ON player_news FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can read news mentions"
  ON player_news_mentions FOR SELECT TO authenticated USING (true);

-- News accumulates indefinitely during the season; archived at end-of-season.
