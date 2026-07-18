-- Fix the sync-players (NBA) cron job's auth.
--
-- jobid 17 predates the vault-secret convention and hardcoded a CRON_SECRET
-- value that has since rotated — every daily run 401s, so the NBA player pool
-- hasn't synced and its heartbeat has never recorded. The WNBA/NFL sibling
-- jobs already read vault.decrypted_secrets; this brings the NBA job in line
-- (and makes the sport explicit instead of relying on the default).

SELECT cron.alter_job(
  (SELECT jobid FROM cron.job WHERE jobname = 'sync-players'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/sync-players',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"nba"}'::jsonb
  );
  $cmd$
);
