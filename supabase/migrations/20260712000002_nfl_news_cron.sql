-- NFL news polling.
--
-- The NFL feed was left unscheduled when the NFL crons landed (20260710000007)
-- because poll-news had no NFL source configured — an nfl call was a clean
-- no-op. RotoWire's NFL RSS + HTML news pages are now wired in poll-news, so
-- schedule the poll the same way NBA/WNBA are.
--
-- Once a minute, matching the other sports: RotoWire's RSS window holds only
-- the latest 5 items and a Sunday slate dumps dozens of blurbs in minutes, so a
-- slower cadence would silently drop the tail (the HTML page's ~25-item window
-- is the real backstop — see the RotoWire capture-gap note).

SELECT cron.schedule(
  'poll-news-nfl',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://iuqbossmnsezzgocpcbo.supabase.co/functions/v1/poll-news',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{"sport":"nfl"}'::jsonb
  );
  $$
);

-- Register with the dead-man-switch so a silently-failing NFL news poll is
-- surfaced like every other cron rather than just going quiet.
INSERT INTO public.cron_job_runs (job_name, expected_interval)
VALUES ('poll-news:nfl', interval '1 minute')
ON CONFLICT (job_name) DO UPDATE SET expected_interval = EXCLUDED.expected_interval;
