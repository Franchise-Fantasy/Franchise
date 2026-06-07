-- Auto-end stale Matchup Live Activities every 15 minutes. The function
-- itself short-circuits when there are no active matchup tokens, so this
-- cron is cheap year-round — the cron-watchdog backstop catches drift
-- with a 30-minute expected interval.

SELECT cron.schedule(
  'end-stale-live-activities',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/end-stale-live-activities',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

INSERT INTO public.cron_job_runs (job_name, expected_interval)
VALUES ('end-stale-live-activities', interval '30 minutes')
ON CONFLICT (job_name) DO NOTHING;
