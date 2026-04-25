import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * RevenueCat webhook handler.
 * Receives subscription lifecycle events and upserts user_subscriptions
 * or league_subscriptions accordingly.
 *
 * Deploy with verify_jwt = false — this is called by RevenueCat, not a user.
 */

// Map RevenueCat product IDs to tier + scope
const PRODUCT_MAP: Record<
  string,
  { tier: "pro" | "premium"; scope: "individual" | "league" }
> = {
  pro_monthly: { tier: "pro", scope: "individual" },
  pro_annual: { tier: "pro", scope: "individual" },
  premium_monthly: { tier: "premium", scope: "individual" },
  premium_annual: { tier: "premium", scope: "individual" },
  league_pro_monthly: { tier: "pro", scope: "league" },
  league_pro_annual: { tier: "pro", scope: "league" },
  league_premium_monthly: { tier: "premium", scope: "league" },
  league_premium_annual: { tier: "premium", scope: "league" },
};

// RevenueCat event types we handle
const ACTIVE_EVENTS = new Set([
  "INITIAL_PURCHASE",
  "RENEWAL",
  "PRODUCT_CHANGE",
  "UNCANCELLATION",
]);

// Status the row should land in for each non-active event. EXPIRATION means
// the term ran out (can re-buy as a fresh purchase); CANCELLATION/BILLING_ISSUE
// keep the row "cancelled" until the term expires. Lumping them all into
// "cancelled" made support triage harder — a row that says cancelled while
// the term is over reads as "they intentionally bailed" instead of "ran out".
const NON_ACTIVE_STATUS: Record<string, "cancelled" | "expired"> = {
  CANCELLATION: "cancelled",
  BILLING_ISSUE: "cancelled",
  EXPIRATION: "expired",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Validate webhook auth token
  const authHeader = req.headers.get("Authorization");
  const expectedToken = Deno.env.get("REVENUECAT_WEBHOOK_TOKEN");
  if (!expectedToken || authHeader !== `Bearer ${expectedToken}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SB_SECRET_KEY") ?? "",
  );

  try {
    const body = await req.json();
    const event = body.event;

    if (!event) {
      return new Response(JSON.stringify({ error: "No event in body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const eventType: string = event.type;
    const rcAppUserId: string = event.app_user_id ?? "";
    const productId: string = event.product_id ?? "";
    const rcEventId: string = event.id ?? "";
    const expirationMs: number | null = event.expiration_at_ms ?? null;
    const periodType: string = event.period_type ?? "NORMAL";

    // app_user_id is the Supabase user ID (set during initPurchases)
    const userId = rcAppUserId;
    if (!userId) {
      return new Response(
        JSON.stringify({ error: "Missing app_user_id" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Idempotency: skip if we've already processed this event
    if (rcEventId) {
      const { count } = await supabaseAdmin
        .from("subscription_events")
        .select("id", { count: "exact", head: true })
        .eq("rc_event_id", rcEventId);
      if (count && count > 0) {
        return new Response(
          JSON.stringify({ ok: true, duplicate: true }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }

    const productInfo = PRODUCT_MAP[productId];
    if (!productInfo) {
      // Unknown product — log and skip
      console.warn(`Unknown product_id: ${productId}`);
      await logEvent(supabaseAdmin, {
        userId,
        eventType: `UNKNOWN_PRODUCT_${eventType}`,
        tier: "free",
        rcEventId,
        metadata: { productId },
      });
      return new Response(JSON.stringify({ ok: true, skipped: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { tier, scope } = productInfo;
    const expiresAt = expirationMs
      ? new Date(expirationMs).toISOString()
      : null;
    const isAnnual = productId.includes("annual");

    if (ACTIVE_EVENTS.has(eventType)) {
      if (scope === "individual") {
        await supabaseAdmin.from("user_subscriptions").upsert(
          {
            user_id: userId,
            tier,
            status: "active",
            starts_at: new Date().toISOString(),
            expires_at: expiresAt,
            rc_customer_id: rcAppUserId,
            rc_product_id: productId,
            period_type: isAnnual ? "annual" : "monthly",
            auto_renew: true,
          },
          { onConflict: "user_id" },
        );
      } else {
        // League subscription — league_id is passed via subscriber attributes
        const leagueId: string =
          event.subscriber_attributes?.league_id?.value ?? "";
        if (!leagueId) {
          console.error("League subscription missing league_id attribute");
          return new Response(
            JSON.stringify({ error: "Missing league_id attribute" }),
            { status: 400, headers: { "Content-Type": "application/json" } },
          );
        }

        await supabaseAdmin.from("league_subscriptions").upsert(
          {
            league_id: leagueId,
            purchased_by: userId,
            tier,
            status: "active",
            starts_at: new Date().toISOString(),
            expires_at: expiresAt,
            rc_customer_id: rcAppUserId,
            rc_product_id: productId,
            period_type: isAnnual ? "annual" : "monthly",
            auto_renew: true,
          },
          { onConflict: "league_id" },
        );
      }
    } else if (NON_ACTIVE_STATUS[eventType]) {
      const newStatus = NON_ACTIVE_STATUS[eventType];
      if (scope === "individual") {
        await supabaseAdmin
          .from("user_subscriptions")
          .update({
            status: newStatus,
            auto_renew: false,
          })
          .eq("user_id", userId);
      } else {
        const leagueId: string =
          event.subscriber_attributes?.league_id?.value ?? "";
        if (leagueId) {
          await supabaseAdmin
            .from("league_subscriptions")
            .update({
              status: newStatus,
              auto_renew: false,
            })
            .eq("league_id", leagueId);
        }
      }
    }

    // Log event for analytics
    await logEvent(supabaseAdmin, {
      userId,
      leagueId:
        scope === "league"
          ? event.subscriber_attributes?.league_id?.value
          : undefined,
      eventType,
      tier,
      rcEventId,
      metadata: { productId, periodType, scope },
    });

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Webhook error:", error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});

async function logEvent(
  supabase: ReturnType<typeof createClient>,
  params: {
    userId: string;
    leagueId?: string;
    eventType: string;
    tier: string;
    rcEventId: string;
    metadata?: Record<string, unknown>;
  },
) {
  await supabase.from("subscription_events").insert({
    user_id: params.userId,
    league_id: params.leagueId ?? null,
    event_type: params.eventType,
    tier: params.tier,
    rc_event_id: params.rcEventId,
    metadata: params.metadata ?? {},
  });
}
