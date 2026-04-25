-- Mirror the NBA polling cron jobs with WNBA equivalents. Each polling edge
-- function (sync-players, poll-live-stats, poll-injuries, poll-news) accepts
-- a `sport` body param and defaults to 'nba' when absent — so the existing
-- NBA crons keep working untouched, and we only need new entries that pass
-- `{"sport":"wnba"}`.
--
-- Schedule choice: WNBA crons run on the same cadence as NBA. The functions
-- themselves short-circuit (empty BDL response, no live weeks, off-hours)
-- when nothing is happening, so out-of-season runs are cheap.

-- WNBA: poll-injuries every 15 min
SELECT cron.schedule(
  'poll-injuries-wnba',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/poll-injuries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"wnba"}'::jsonb
  );
  $$
);

-- WNBA: poll-live-stats every minute
SELECT cron.schedule(
  'poll-live-stats-wnba',
  '* * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-live-stats',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body    := '{"sport":"wnba"}'::jsonb
  );
  $$
);

-- WNBA: poll-news every minute
SELECT cron.schedule(
  'poll-news-wnba',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"wnba"}'::jsonb
  );
  $$
);

-- WNBA: sync-players daily at 19:08 UTC (one minute offset from NBA so the
-- two BDL syncs don't hit at the same instant).
SELECT cron.schedule(
  'sync-players-wnba',
  '8 19 * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/sync-players',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"wnba"}'::jsonb
  );
  $$
);
