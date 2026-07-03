-- Down-to-the-wire close-matchup scanner.
--
-- Replaces the single Sunday 23:00 UTC fire with a poll across the game window.
-- The scanner now gates on (a) today == the matchup week's end_date and (b) the
-- matchup's remaining starter games being live/imminent, so frequent polling is
-- what lets it land the push right before each matchup's actual deciding games
-- instead of at one fixed clock hour (which arrived after some matchups were
-- already decided and hours before others). Off-window and non-last-day polls
-- early-exit after a single cheap query.
--
-- Window: every 30 min, 15:00–05:30 UTC (≈ 11am ET early afternoon games
-- through ~1am ET late West-coast games), covering NBA + WNBA tipoff ranges.

-- Unschedule by jobid so this is a no-op if the job is somehow already gone
-- (cron.unschedule(name) raises if the name doesn't exist).
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'scan-close-matchups';

SELECT cron.schedule(
  'scan-close-matchups',
  '*/30 15-23,0-5 * * *',
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

-- Heartbeat now expects frequent runs; widen just enough to absorb the ~9h
-- daily quiet window (05:30 → 15:00 UTC) without the watchdog false-alarming.
UPDATE public.cron_job_runs
SET expected_interval = interval '13 hours'
WHERE job_name = 'scan-close-matchups';
