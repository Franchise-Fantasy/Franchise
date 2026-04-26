import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { recordHeartbeat } from "../_shared/heartbeat.ts";

// Generic queue worker that dequeues messages from pgmq and dispatches them
// to the appropriate edge function. Called every minute by pg_cron.
//
// Message format: { "function": "process-waivers", "body": { ... } }
//
// On success: archives the message.
// On failure: message becomes visible again after visibility timeout (120s).
// After MAX_RETRIES failures: moved to the dead_letter queue, recorded in
// dead_letter_alerts, and admins are pushed.

const MAX_RETRIES = 5;
const VISIBILITY_TIMEOUT = 120; // seconds
const BATCH_QTY = 5;            // messages per queue per cron tick
const TIME_BUDGET_MS = 50_000;  // soft budget — break out before next cron tick

const QUEUES = [
  "process_waivers",
  "finalize_week",
  "process_pending_transactions",
  "update_standings",
  "update_daily_records",
];

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

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

  const startedAt = Date.now();
  const results: Array<{
    queue: string;
    msg_id?: number;
    status: string;
    error?: string;
  }> = [];

  for (const queue of QUEUES) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      results.push({ queue, status: "skipped_time_budget" });
      continue;
    }

    try {
      const { data: messages, error: readErr } = await supabase.rpc(
        "pgmq_read",
        { queue_name: queue, visibility_timeout: VISIBILITY_TIMEOUT, qty: BATCH_QTY },
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

      for (const raw of messages as QueueMessage[]) {
        if (Date.now() - startedAt > TIME_BUDGET_MS) {
          // Leave remaining messages visible-on-timeout for next tick
          break;
        }
        await processMessage(queue, raw, results);
      }
    } catch (err) {
      console.error(`Queue ${queue} processing error:`, err);
      results.push({
        queue,
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await recordHeartbeat(supabase, 'queue-worker', 'ok');
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

  if (read_ct > MAX_RETRIES) {
    await moveToDeadLetter(queue, msg_id, message, "max_retries_exceeded");
    results.push({ queue, msg_id, status: "dead_lettered" });
    return;
  }

  const result = await invokeFunction(fnName, message.body ?? {});

  if (result.ok) {
    await archiveMessage(queue, msg_id);
    results.push({ queue, msg_id, status: "success" });
  } else {
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
  reason: string,
) {
  const deadLetteredAt = new Date().toISOString();

  const { error: dlErr } = await supabase.rpc("pgmq_send", {
    queue_name: "dead_letter",
    message: {
      original_queue: queue,
      original_msg_id: msgId,
      message,
      reason,
      dead_lettered_at: deadLetteredAt,
    },
  });
  if (dlErr) console.warn(`Failed to dead-letter msg ${msgId}:`, dlErr.message);

  await archiveMessage(queue, msgId);

  // Record audit row + page admins. Failures here must NOT block the dead-letter
  // path itself, so each call is independently try/catch'd.
  try {
    await supabase.from("dead_letter_alerts").insert({
      original_queue: queue,
      original_msg_id: msgId,
      function_name: (message as any)?.function ?? null,
      reason,
      payload: message,
    });
  } catch (e) {
    console.warn("dead_letter_alerts insert failed:", e instanceof Error ? e.message : e);
  }

  try {
    await pushAdmins(
      `Queue ${queue} dead-lettered`,
      `msg #${msgId} (${(message as any)?.function ?? "unknown"}): ${reason}`,
    );
  } catch (e) {
    console.warn("admin push failed:", e instanceof Error ? e.message : e);
  }
}

async function pushAdmins(title: string, body: string) {
  const { data: admins } = await supabase
    .from("profiles")
    .select("id")
    .eq("is_admin", true);
  if (!admins || admins.length === 0) return;

  const adminIds = (admins as any[]).map(a => a.id);
  const { data: tokens } = await supabase
    .from("push_tokens")
    .select("token")
    .in("user_id", adminIds);
  if (!tokens || tokens.length === 0) return;

  const messages = (tokens as any[]).map(t => ({
    to: t.token,
    title,
    body,
    sound: "default",
    priority: "high",
    data: { screen: "activity", channelId: "commissioner" },
    channelId: "commissioner",
  }));

  // Expo accepts up to 100 per request
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    try {
      await fetch(EXPO_PUSH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      });
    } catch (err) {
      console.warn("Expo push (admin) failed:", err);
    }
  }
}
