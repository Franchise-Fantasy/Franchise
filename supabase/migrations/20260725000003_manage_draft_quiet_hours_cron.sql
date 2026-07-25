-- Quiet-hours driver for slow (async) drafts. A slow draft's pick clock runs
-- for hours/days, so a team can land on the clock at 3am and be auto-drafted
-- while everyone sleeps. Every 5 minutes, poke the manage-draft-quiet-hours
-- edge function, which freezes any quiet-hours-enabled draft that has crossed
-- into its nightly window (reusing the commissioner-pause machinery) and
-- re-arms the clock once the window closes. Idempotent + archived-league-aware,
-- so a run racing the boundary or a manual pause is harmless. Same cadence and
-- auth (vault cron_secret bearer) as sweep-stalled-drafts.
SELECT cron.schedule(
  'manage-draft-quiet-hours',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/manage-draft-quiet-hours',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
