-- Sunday 23:00 UTC = Sunday 6pm ET / 3pm PT — NBA Sunday primetime is hitting
-- but it isn't East-Coast bedtime yet. Scanner finds close matchups, sends one
-- nudge per matchup per week (dedup table guarantees), and lights up the Go
-- Live CTA via the deep-link prompt_live_activity flag.

SELECT cron.schedule(
  'scan-close-matchups',
  '0 23 * * 0',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/scan-close-matchups',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Seed heartbeat row so cron_watchdog can flag missed Sunday runs (expected
-- weekly cadence ≈ 168h; we set a generous 200h to absorb DST shifts without
-- false alarms).
INSERT INTO public.cron_job_runs (job_name, expected_interval)
VALUES ('scan-close-matchups', interval '200 hours')
ON CONFLICT (job_name) DO NOTHING;
