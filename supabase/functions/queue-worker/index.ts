import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Generic queue worker that dequeues messages from pgmq and dispatches them
// to the appropriate edge function. Called every minute by pg_cron.
//
// Message format: { "function": "process-waivers", "body": { ... } }
//
// On success: archives the message.
// On failure: message becomes visible again after visibility timeout (120s).
// After MAX_RETRIES failures: moved to the dead_letter queue.

const MAX_RETRIES = 5;
const VISIBILITY_TIMEOUT = 120; // seconds

const QUEUES = [
  "process_waivers",
  "finalize_week",
  "process_pending_transactions",
  "update_standings",
  "update_daily_records",
];

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

interface QueueMessage {
  msg_id: number;
  read_ct: number;
  message: {
    function: string;
    body?: Record<string, unknown>;
  };
}

async function invokeFunction(
  fnName: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const projectUrl = Deno.env.get("SUPABASE_URL")!;
  const cronSecret = Deno.env.get("CRON_SECRET")!;

  const resp = await fetch(`${projectUrl}/functions/v1/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cronSecret}`,
    },
    body: JSON.stringify(body),
  });

  if (resp.ok) return { ok: true, status: resp.status };

  const text = await resp.text().catch(() => "");
  return { ok: false, status: resp.status, error: text.slice(0, 500) };
}

Deno.serve(async (req: Request) => {
  // Authenticate: only pg_cron (via CRON_SECRET) should call this
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const results: Array<{
    queue: string;
    msg_id?: number;
    status: string;
    error?: string;
  }> = [];

  // Process one message per queue per invocation to keep execution time short
  for (const queue of QUEUES) {
    try {
      const { data: messages, error: readErr } = await supabase.rpc(
        "pgmq_read",
        { queue_name: queue, visibility_timeout: VISIBILITY_TIMEOUT, qty: 1 },
      );

      if (readErr) {
        console.warn(`Queue ${queue} read error:`, readErr.message);
        results.push({ queue, status: "read_error", error: readErr.message });
        continue;
      }

      if (!messages || messages.length === 0) {
        results.push({ queue, status: "empty" });
        continue;
      }

      const msg = messages[0] as QueueMessage;
      await processMessage(queue, msg, results);
    } catch (err) {
      console.error(`Queue ${queue} processing error:`, err);
      results.push({
        queue,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return new Response(JSON.stringify({ ok: true, results }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function processMessage(
  queue: string,
  msg: QueueMessage,
  results: Array<{ queue: string; msg_id?: number; status: string; error?: string }>,
) {
  const { msg_id, read_ct, message } = msg;
  const fnName = message?.function;

  if (!fnName) {
    await archiveMessage(queue, msg_id);
    results.push({ queue, msg_id, status: "archived_malformed" });
    return;
  }

  // Too many retries — move to dead letter queue
  if (read_ct > MAX_RETRIES) {
    await moveToDeadLetter(queue, msg_id, message);
    results.push({ queue, msg_id, status: "dead_lettered" });
    return;
  }

  const result = await invokeFunction(fnName, message.body ?? {});

  if (result.ok) {
    await archiveMessage(queue, msg_id);
    results.push({ queue, msg_id, status: "success" });
  } else {
    // Leave the message in the queue — it becomes visible again after
    // VISIBILITY_TIMEOUT expires, allowing automatic retry
    console.warn(
      `Queue ${queue} msg ${msg_id} failed (attempt ${read_ct}/${MAX_RETRIES}):`,
      result.error,
    );
    results.push({
      queue,
      msg_id,
      status: "failed",
      error: `HTTP ${result.status}: ${result.error?.slice(0, 200)}`,
    });
  }
}

async function archiveMessage(queue: string, msgId: number) {
  const { error } = await supabase.rpc("pgmq_archive", {
    queue_name: queue,
    msg_id: msgId,
  });
  if (error) console.warn(`Failed to archive msg ${msgId} from ${queue}:`, error.message);
}

async function moveToDeadLetter(
  queue: string,
  msgId: number,
  message: Record<string, unknown>,
) {
  // Send to dead_letter queue with metadata for debugging
  const { error } = await supabase.rpc("pgmq_send", {
    queue_name: "dead_letter",
    message: {
      original_queue: queue,
      original_msg_id: msgId,
      message,
      dead_lettered_at: new Date().toISOString(),
    },
  });
  if (error) console.warn(`Failed to dead-letter msg ${msgId}:`, error.message);

  await archiveMessage(queue, msgId);
}
