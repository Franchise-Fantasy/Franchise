-- Enable pgmq for reliable job processing with retry/dead-letter support.
-- Replaces direct net.http_post cron calls for critical jobs where a single
-- missed execution matters (waivers, finalize-week, pending transactions,
-- standings, daily records).
-- High-frequency polling jobs (every 1min) are left as-is since the next
-- tick acts as a natural retry.

CREATE EXTENSION IF NOT EXISTS pgmq;

-- Create queues for critical scheduled jobs
SELECT pgmq.create('process_waivers');
SELECT pgmq.create('finalize_week');
SELECT pgmq.create('process_pending_transactions');
SELECT pgmq.create('update_standings');
SELECT pgmq.create('update_daily_records');
SELECT pgmq.create('dead_letter');

-- Thin RPC wrappers so supabase-js can call pgmq functions via .rpc()

-- Read one message from a queue with visibility timeout
CREATE OR REPLACE FUNCTION pgmq_read(
  queue_name text,
  visibility_timeout int DEFAULT 120,
  qty int DEFAULT 1
)
RETURNS TABLE(msg_id bigint, read_ct int, message jsonb)
LANGUAGE sql SECURITY DEFINER SET search_path = 'pgmq', 'public' AS $$
  SELECT msg_id, read_ct, message FROM pgmq.read(queue_name, visibility_timeout, qty);
$$;

-- Archive (acknowledge) a processed message
CREATE OR REPLACE FUNCTION pgmq_archive(queue_name text, msg_id bigint)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path = 'pgmq', 'public' AS $$
  SELECT pgmq.archive(queue_name, msg_id);
$$;

-- Send a message to a queue
CREATE OR REPLACE FUNCTION pgmq_send(queue_name text, message jsonb)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = 'pgmq', 'public' AS $$
  SELECT pgmq.send(queue_name, message);
$$;

-- Revoke from anon (queue operations are service-role only)
REVOKE ALL ON FUNCTION pgmq_read(text, int, int) FROM anon;
REVOKE ALL ON FUNCTION pgmq_archive(text, bigint) FROM anon;
REVOKE ALL ON FUNCTION pgmq_send(text, jsonb) FROM anon;

-- Replace direct HTTP cron jobs with enqueue calls.
-- The queue-worker edge function (triggered every 30s) dequeues and dispatches.

-- process-waivers: daily at 6am UTC
SELECT cron.unschedule('process-waivers');
SELECT cron.schedule(
  'enqueue-process-waivers',
  '0 6 * * *',
  $$SELECT pgmq.send('process_waivers', '{"function":"process-waivers"}'::jsonb);$$
);

-- finalize-week: daily at 9am UTC
SELECT cron.unschedule('finalize-week');
SELECT cron.schedule(
  'enqueue-finalize-week',
  '0 9 * * *',
  $$SELECT pgmq.send('finalize_week', '{"function":"finalize-week","body":{"source":"cron"}}'::jsonb);$$
);

-- process-pending-transactions: every 15 min
SELECT cron.unschedule('process-pending-transactions');
SELECT cron.schedule(
  'enqueue-process-pending-transactions',
  '5,20,35,50 * * * *',
  $$SELECT pgmq.send('process_pending_transactions', '{"function":"process-pending-transactions"}'::jsonb);$$
);

-- update-standings: daily at 8am UTC
SELECT cron.unschedule('update-standings');
SELECT cron.schedule(
  'enqueue-update-standings',
  '0 8 * * *',
  $$SELECT pgmq.send('update_standings', '{"function":"update-standings"}'::jsonb);$$
);

-- update-daily-records: daily at 8am UTC
SELECT cron.unschedule('update-daily-records');
SELECT cron.schedule(
  'enqueue-update-daily-records',
  '0 8 * * *',
  $$SELECT pgmq.send('update_daily_records', '{"function":"update-daily-records"}'::jsonb);$$
);

-- Queue worker cron: runs every minute to dequeue and dispatch jobs
SELECT cron.schedule(
  'queue-worker',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/queue-worker',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Fix poll-injuries cron to use Vault instead of hardcoded secret
SELECT cron.unschedule('poll-injuries');
SELECT cron.schedule(
  'poll-injuries',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'project_url' LIMIT 1)
           || '/functions/v1/poll-injuries',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret' LIMIT 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
