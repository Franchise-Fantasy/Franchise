-- Cron for poll-news-google — the FALLBACK / gap-fill news poller.
--
-- RotoWire (poll-news) stays the preferred source: it runs every minute, while
-- this runs every 2 minutes and only queries players RotoWire hasn't covered in
-- the last 24h. NBA fires on even minutes, WNBA on odd minutes so the two
-- sports never hit Google News (or the DB) in the same tick. Reuses the shared
-- cron_secret in Vault, same as poll-news.

-- Seed heartbeat rows so the cron-watchdog monitors this job too (the edge fn
-- only UPDATEs cron_job_runs, never INSERTs — an unseeded job silently no-ops).
INSERT INTO public.cron_job_runs (job_name, expected_interval) VALUES
  ('poll-news-google:nba',  interval '2 minutes'),
  ('poll-news-google:wnba', interval '2 minutes')
ON CONFLICT (job_name) DO NOTHING;

SELECT cron.schedule(
  'poll-news-google-nba',
  '*/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-news-google',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"nba"}'::jsonb
  );
  $$
);

SELECT cron.schedule(
  'poll-news-google-wnba',
  '1-59/2 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-news-google',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"wnba"}'::jsonb
  );
  $$
);
