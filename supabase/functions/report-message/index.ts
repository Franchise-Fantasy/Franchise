import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse, CORS_HEADERS } from "../_shared/cors.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { notifyUsersBulk } from "../_shared/push.ts";
import { createLogger } from "../_shared/log.ts";

const log = createLogger("report-message");

const VALID_REASONS = ["spam", "harassment", "hate", "sexual", "other"] as const;
type Reason = (typeof VALID_REASONS)[number];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SB_SECRET_KEY") ?? "",
    );

    // Verify caller via JWT
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SB_PUBLISHABLE_KEY") ?? "",
      { global: { headers: { Authorization: token ?? "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const limited = await checkRateLimit(supabaseAdmin, user.id, "report-message");
    if (limited) return limited;

    const body = await req.json().catch(() => null);
    const messageId: string | undefined = body?.message_id;
    const reason: Reason | undefined = body?.reason;
    const details: string | undefined = body?.details;

    if (!messageId || !reason || !VALID_REASONS.includes(reason)) {
      return new Response(
        JSON.stringify({ error: "message_id and a valid reason are required" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }
    if (details && details.length > 1000) {
      return new Response(
        JSON.stringify({ error: "details must be 1000 characters or fewer" }),
        { status: 400, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    // Confirm the reporter is in the conversation that owns the message —
    // prevents reporting messages the user can't actually see (probing /
    // harassment of league commissioners outside their leagues).
    const { data: msg } = await supabaseAdmin
      .from("chat_messages")
      .select("id, conversation_id, content, type, team_id")
      .eq("id", messageId)
      .single();
    if (!msg) {
      return new Response(
        JSON.stringify({ error: "Message not found" }),
        { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const { data: conv } = await supabaseAdmin
      .from("chat_conversations")
      .select("id, league_id, type")
      .eq("id", msg.conversation_id)
      .single();
    if (!conv) {
      return new Response(
        JSON.stringify({ error: "Conversation not found" }),
        { status: 404, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
    }

    const { data: reporterTeam } = await supabaseAdmin
      .from("teams")
      .select("id")
      .eq("league_id", conv.league_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (!reporterTeam) {
      return new Response(
        JSON.stringify({ error: "Not a member of this league" }),
        { status: 403, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
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
      log.error("Failed to insert message report", insertError, { messageId, reason });
      return new Response(
        JSON.stringify({ error: "Failed to record report" }),
        { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
      );
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

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  } catch (err) {
    log.error("report-message error", err as Error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } },
    );
  }
});
