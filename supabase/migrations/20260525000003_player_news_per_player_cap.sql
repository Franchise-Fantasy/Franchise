-- Per-player news cap: keep each player's most-recent N articles, deleting only
-- mentioned articles that fall outside the top N for EVERY player they mention.
--
-- Why per-player and not a flat "older than X days" cutoff: a time cutoff can
-- delete an injured player's only (older) note, leaving them with no news. This
-- cap never empties a player — a player with fewer than N articles keeps them
-- all. It bounds table growth and the "one event recapped by many outlets"
-- clutter. Articles with no mentions are left alone (they never appear in any
-- feed; orphan cleanup, if ever needed, is a separate concern).

CREATE OR REPLACE FUNCTION public.cap_player_news_per_player(p_keep integer DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer;
BEGIN
  WITH ranked AS (
    SELECT m.news_id,
           row_number() OVER (
             PARTITION BY m.player_id
             ORDER BY pn.published_at DESC, pn.id
           ) AS rn
    FROM player_news_mentions m
    JOIN player_news pn ON pn.id = m.news_id
  ),
  keep AS (
    SELECT DISTINCT news_id FROM ranked WHERE rn <= p_keep
  ),
  del AS (
    DELETE FROM player_news pn
    WHERE EXISTS (SELECT 1 FROM player_news_mentions m WHERE m.news_id = pn.id)
      AND pn.id NOT IN (SELECT news_id FROM keep)
    RETURNING 1
  )
  SELECT count(*) INTO v_deleted FROM del;
  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cap_player_news_per_player(integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cap_player_news_per_player(integer) TO service_role;

-- Daily at 07:30 UTC (off-peak, after the 06:30 cron-watchdog).
SELECT cron.schedule(
  'player-news-per-player-cap',
  '30 7 * * *',
  $$ SELECT public.cap_player_news_per_player(15); $$
);

-- Trim once on install.
SELECT public.cap_player_news_per_player(15);
