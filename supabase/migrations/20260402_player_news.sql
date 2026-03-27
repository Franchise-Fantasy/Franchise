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
  return_estimate          text
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

-- Cleanup: delete articles older than 14 days UNLESS they are the most recent
-- article for any player they mention (preserves context for injured/inactive players).
CREATE OR REPLACE FUNCTION cleanup_old_news() RETURNS void LANGUAGE sql AS $$
  DELETE FROM player_news
  WHERE published_at < now() - interval '14 days'
    AND id NOT IN (
      SELECT DISTINCT ON (pnm.player_id) pn.id
      FROM player_news pn
      JOIN player_news_mentions pnm ON pnm.news_id = pn.id
      ORDER BY pnm.player_id, pn.published_at DESC
    );
$$;
