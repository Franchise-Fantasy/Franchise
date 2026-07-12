import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { handleError, jsonResponse, errorResponse } from "../_shared/http.ts";
import { moderateText } from "../_shared/moderate.ts";
import { parseBody, z } from "../_shared/validate.ts";

const Body = z.object({
  message_id: z.string().uuid().optional(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

/**
 * Async content moderation — called via DB webhook on every chat_messages insert.
 * Runs the message through word list + Claude Haiku.
 * Deletes the message if flagged.
 */
Deno.serve(async (req: Request) => {
  const authHeader = req.headers.get("Authorization") ?? "";
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { message_id: messageId } = parseBody(Body, body);

    let messages: any[];

    if (messageId) {
      // Single message mode (webhook trigger)
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, content, conversation_id, team_id")
        .eq("id", messageId)
        .eq("type", "text")
        .is("moderated_at", null)
        .single();

      if (error || !data) {
        // Message already moderated, deleted, or not text — nothing to do
        return jsonResponse({ checked: 0, flagged: 0 });
      }
      messages = [data];
    } else {
      // Batch mode (fallback / manual invocation)
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id, content, conversation_id, team_id")
        .eq("type", "text")
        .is("moderated_at", null)
        .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      messages = data ?? [];
    }

    if (messages.length === 0) {
      return jsonResponse({ checked: 0, flagged: 0 });
    }

    let flagged = 0;
    const flaggedIds: string[] = [];

    for (const msg of messages) {
      const result = await moderateText(msg.content);

      if (!result.safe) {
        flaggedIds.push(msg.id);
        flagged++;
        console.log(
          `Flagged message ${msg.id}: "${msg.content.substring(0, 50)}" — ${result.reason}`,
        );
      }
    }

    // Delete the flagged messages and stamp the batch as checked, in ONE
    // transaction. The old order stamped `moderated_at` first and deleted
    // second — so a crash in between left an abusive message marked moderated,
    // which took it out of the next run's working set (`moderated_at IS NULL`)
    // permanently. The message survived forever, having been "moderated".
    const { error: applyError } = await supabase.rpc("moderate_messages_apply", {
      p_checked_ids: messages.map((m: any) => m.id),
      p_flagged_ids: flaggedIds,
    });
    if (applyError) throw applyError;

    return jsonResponse({ checked: messages.length, flagged });
  } catch (err) {
    return handleError(err, 'moderate-messages');
  }
});
