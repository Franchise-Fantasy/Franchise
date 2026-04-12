import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { moderateText } from "../_shared/moderate.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
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
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const messageId = body.message_id as string | undefined;

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
        return new Response(
          JSON.stringify({ checked: 0, flagged: 0 }),
          { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
        );
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
      return new Response(
        JSON.stringify({ checked: 0, flagged: 0 }),
        { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
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

    return new Response(
      JSON.stringify({ checked: messages.length, flagged }),
      { headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err: any) {
    console.error("moderate-messages error:", err);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
