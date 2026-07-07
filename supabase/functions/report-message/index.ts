import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse } from "../_shared/cors.ts";
import { requireUser } from "../_shared/auth.ts";
import { HttpError, handleError, jsonResponse } from "../_shared/http.ts";
import { createLogger } from "../_shared/log.ts";
import { notifyUsersBulk } from "../_shared/push.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { parseBody, z } from "../_shared/validate.ts";

const log = createLogger("report-message");

const Body = z.object({
  message_id: z.string().uuid(),
  reason: z.enum(['spam', 'harassment', 'hate', 'sexual', 'other']),
  details: z.string().max(1000, 'details must be 1000 characters or fewer').optional(),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SB_SECRET_KEY") ?? "",
    );

    // Verify caller via JWT
    const user = await requireUser(req);

    const limited = await checkRateLimit(supabaseAdmin, user.id, "report-message");
    if (limited) return limited;

    const { message_id: messageId, reason, details } = parseBody(Body, await req.json());

    // Confirm the reporter is in the conversation that owns the message —
    // prevents reporting messages the user can't actually see (probing /
    // harassment of league commissioners outside their leagues).
    const { data: msg } = await supabaseAdmin
      .from("chat_messages")
      .select("id, conversation_id, content, type, team_id")
      .eq("id", messageId)
      .single();
    if (!msg) {
      throw new HttpError("Message not found", 404);
    }

    const { data: conv } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, league_id, type")
      .eq("id", msg.conversation_id)
      .single();
    if (!conv) {
      throw new HttpError("Conversation not found", 404);
    }

    const { data: reporterTeam } = await supabaseAdmin
      .from("teams")
      .select("id")
      .eq("league_id", conv.league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!reporterTeam) {
      throw new HttpError("Not a member of this league", 403);
    }

    // Insert the report (UNIQUE(message_id, reporter_id) makes this idempotent
    // on retry — duplicate is treated as success so the user UX is the same).
    const { error: insertError } = await supabaseAdmin
      .from("message_reports")
      .insert({
        message_id: messageId,
        reporter_id: user.id,
        reason,
        details: details ?? null,
      });

    if (insertError && insertError.code !== "23505") {
      throw insertError;
    }

    // Notify the league commissioner (best-effort — not fatal).
    try {
      const { data: league } = await supabaseAdmin
        .from("leagues")
        .select("created_by, name")
        .eq("id", conv.league_id)
        .single();
      if (league?.created_by && league.created_by !== user.id) {
        const preview = msg.type === "text" && typeof msg.content === "string"
          ? (msg.content.length > 80 ? msg.content.slice(0, 80) + "…" : msg.content)
          : `[${msg.type}]`;
        await notifyUsersBulk(supabaseAdmin, "commissioner", [{
          userId: league.created_by,
          leagueId: conv.league_id,
          title: `${league.name ?? "Your league"} — Reported message`,
          body: `Reason: ${reason}. "${preview}"`,
          data: { screen: `chat/${conv.id}`, message_id: messageId },
        }]);
      }
    } catch (notifyErr) {
      log.warn("Commissioner notify failed (non-fatal)", { err: String(notifyErr) });
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return handleError(error, 'report-message');
  }
});
