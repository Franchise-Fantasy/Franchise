-- Hourly sweep that un-sticks stalled `higher_seed_picks` playoff brackets.
-- A higher seed that never chooses its opponent otherwise stalls the whole
-- bracket forever (no matchups, no scoring — the "your turn" push is
-- best-effort). resolve-stale-seed-picks finds any pick pending > 24h and
-- defaults it to the lowest available seed via generate-playoff-round.
--
-- Runs at :05 every hour so it never races the daily finalize-week rollover
-- (~09:00 UTC) that CREATES the picks.

SELECT cron.schedule(
  'resolve-stale-seed-picks',
  '5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/resolve-stale-seed-picks',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Seed heartbeat row so cron_watchdog can flag missed runs. Expected cadence
-- is hourly; 3h absorbs an occasional skipped run without a false alarm.
INSERT INTO public.cron_job_runs (job_name, expected_interval)
VALUES ('resolve-stale-seed-picks', interval '3 hours')
ON CONFLICT (job_name) DO NOTHING;
