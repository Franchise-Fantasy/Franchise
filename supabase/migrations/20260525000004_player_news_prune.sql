-- Player-news pruning: same-event dedup + per-player cap, at the MENTION level.
--
-- Problem: one event (a game, an injury announcement) gets covered by many
-- outlets within a few hours. Each is a distinct article (distinct source/url),
-- so external_id dedup can't merge them, and they all pass the fantasy-relevance
-- gate ("return", "debut", "injury"). A rostered player's feed (MY TEAM /
-- MATCHUP, which read through player_news_mentions) becomes a wall of the same
-- story.
--
-- Fix: per player, when a more-recent article exists within a short window,
-- treat the older one as the same event and drop that player's MENTION of it.
-- Mention-level (not article-level) so:
--   * co-mentioned players keep their own copy,
--   * the article row survives (no freed external_id → no re-insert / re-notify churn),
--   * the "all news" tab — which reads player_news directly — is unaffected.
--
-- Supersedes the article-level cap_player_news_per_player from 20260525000003.

DROP FUNCTION IF EXISTS public.cap_player_news_per_player(integer);
SELECT cron.unschedule('player-news-per-player-cap')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'player-news-per-player-cap');

CREATE OR REPLACE FUNCTION public.prune_player_news(p_window_hours int DEFAULT 6, p_keep int DEFAULT 15)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_deleted integer := 0;
  v_step    integer;
BEGIN
  -- 1. Same-event dedup: drop a mention when the SAME player has a more-recent
  --    article within p_window_hours. Adjacent (LEAD) comparison collapses a
  --    dense cluster to its newest item, while gaps larger than the window keep
  --    genuinely separate updates.
  WITH adj AS (
    SELECT m.id AS mention_id,
           LEAD(pn.published_at) OVER (PARTITION BY m.player_id ORDER BY pn.published_at)
             - pn.published_at AS gap_to_newer
    FROM player_news_mentions m
    JOIN player_news pn ON pn.id = m.news_id
  ),
  del AS (
    DELETE FROM player_news_mentions
    WHERE id IN (
      SELECT mention_id FROM adj
      WHERE gap_to_newer IS NOT NULL
        AND gap_to_newer < make_interval(hours => p_window_hours)
    )
    RETURNING 1
  )
  SELECT count(*) INTO v_step FROM del;
  v_deleted := v_deleted + v_step;

  -- 2. Per-player cap: keep each player's most-recent p_keep mentions.
  WITH ranked AS (
    SELECT m.id AS mention_id,
           row_number() OVER (PARTITION BY m.player_id ORDER BY pn.published_at DESC, pn.id) AS rn
    FROM player_news_mentions m
    JOIN player_news pn ON pn.id = m.news_id
  ),
  del2 AS (
    DELETE FROM player_news_mentions
    WHERE id IN (SELECT mention_id FROM ranked WHERE rn > p_keep)
    RETURNING 1
  )
  SELECT count(*) INTO v_step FROM del2;
  v_deleted := v_deleted + v_step;

  RETURN v_deleted;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.prune_player_news(integer, integer) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.prune_player_news(integer, integer) TO service_role;

-- No dedicated cron: poll-news-google calls prune_player_news() at the top of
-- every run (it fires ~once a minute across the two sports), so the feeds stay
-- deduped without an extra scheduled job.

-- Trim once on install.
SELECT public.prune_player_news(6, 15);
