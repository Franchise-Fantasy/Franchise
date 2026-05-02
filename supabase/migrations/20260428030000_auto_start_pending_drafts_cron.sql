-- Auto-start any draft whose scheduled time has passed but is still pending.
-- Previously start-draft only fired from the commissioner's client, so if
-- nobody was in the draft room when draft_date hit, the draft would sit in
-- 'pending' indefinitely and any team that later joined would see a stuck
-- "Pick is in" placeholder (timer expired but no QStash schedule existed).
--
-- Granularity: 1 minute (pg_cron's minimum). This means a draft might start
-- up to ~60s after its scheduled time when no one is in the room — acceptable
-- for the fallback path. The client-side fast-path still triggers immediately
-- when any league member is present.
--
-- The start-draft edge function accepts CRON_SECRET-authenticated calls and
-- skips the user-membership check on this path; the scheduler is the
-- authority once draft_date has passed.

SELECT cron.schedule(
  'auto-start-pending-drafts',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/start-draft',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := jsonb_build_object('draft_id', d.id)
  )
  FROM drafts d
  WHERE d.status = 'pending'
    AND d.draft_date IS NOT NULL
    AND d.draft_date <= now();
  $$
);
