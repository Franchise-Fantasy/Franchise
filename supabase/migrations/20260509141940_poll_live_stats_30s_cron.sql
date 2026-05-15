-- Bump poll-live-stats cron from every-minute to every-30-seconds.
-- Halves the average "cron miss" window between when a play actually
-- happens and when our diff cycle picks it up. Combined with BDL's own
-- 30–60s feed lag, this brings end-to-end ticker latency from ~2 min
-- worst-case down to ~45–75s.
--
-- pg_cron supports sub-minute schedules via the "N seconds" syntax.
-- Replaces the 5-field cron expressions ('* * * * *') used before.

SELECT cron.unschedule('poll-live-stats');
SELECT cron.unschedule('poll-live-stats-wnba');

SELECT cron.schedule(
  'poll-live-stats',
  '30 seconds',
  $$
    SELECT net.http_post(
      url     := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-live-stats',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
      ),
      body    := '{}'::jsonb
    );
  $$
);

SELECT cron.schedule(
  'poll-live-stats-wnba',
  '30 seconds',
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
