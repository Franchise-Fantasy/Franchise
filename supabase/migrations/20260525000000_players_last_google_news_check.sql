-- Schema additions required by the poll-news-google Edge Function.
--
-- Adds a per-player "when did we last ask Google News about this player"
-- timestamp so the function can rotate through eligible players fairly
-- (oldest checked first) instead of repeatedly hammering the same names.
--
-- ADD COLUMN with no default is a metadata-only change (instant, no table
-- rewrite).
--
-- No index: poll-news-google loads every player for the sport anyway (needed
-- for the article-text name match) and selects/orders the batch in memory, so
-- an index on this column would never be read — it would only add write cost on
-- the daily player sync and the per-run "mark checked" UPDATE.

ALTER TABLE players
  ADD COLUMN IF NOT EXISTS last_google_news_check_at TIMESTAMPTZ;
