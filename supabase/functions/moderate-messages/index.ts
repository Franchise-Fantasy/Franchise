import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
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

    // Mark all checked messages as moderated
    const allIds = messages.map((m: any) => m.id);
    await supabase
      .from("chat_messages")
      .update({ moderated_at: new Date().toISOString() })
      .in("id", allIds);

    // Delete flagged messages
    if (flaggedIds.length > 0) {
      await supabase
        .from("chat_members")
        .update({ last_read_message_id: null })
        .in("last_read_message_id", flaggedIds);

      await supabase
        .from("chat_messages")
        .delete()
        .in("id", flaggedIds);
    }

    return jsonResponse({ checked: messages.length, flagged });
  } catch (err) {
    return handleError(err, 'moderate-messages');
  }
});
