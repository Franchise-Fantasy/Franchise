import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsResponse, CORS_HEADERS } from "../_shared/cors.ts";

/**
 * Authoritative reconciliation between RevenueCat and our subscription tables.
 * Webhooks from RC are best-effort — they can be dropped, delayed, or never re-fired
 * after a Restore (RC won't re-deliver an event it already considers acknowledged).
 * This endpoint lets a logged-in client pull the user's current entitlement state
 * directly from the RC REST API and upsert the row, so anyone in a stale/expired
 * state can self-heal without manual support intervention.
 *
 * Deploy with --no-verify-jwt — auth is verified inside via auth.getUser().
 */

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

const TIER_RANK: Record<string, number> = { free: 0, pro: 1, premium: 2 };

interface RcSubscription {
  expires_date: string | null;
  purchase_date: string | null;
  unsubscribe_detected_at: string | null;
  refunded_at: string | null;
  period_type: "normal" | "trial" | "intro";
}

interface ReconciledSub {
  productId: string;
  tier: "pro" | "premium";
  expiresAt: string;
  isAnnual: boolean;
  autoRenew: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return corsResponse();
  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ")
      ? authHeader
      : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SB_PUBLISHABLE_KEY") ?? "",
      { global: { headers: { Authorization: token ?? "" } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const rcApiKey = Deno.env.get("REVENUECAT_REST_API_KEY");
    if (!rcApiKey) {
      console.error("REVENUECAT_REST_API_KEY missing");
      return new Response(
        JSON.stringify({ error: "Sync not configured on server" }),
        {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        },
      );
    }

    const rcRes = await fetch(
      `https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(user.id)}`,
      {
        headers: {
          Authorization: `Bearer ${rcApiKey}`,
          Accept: "application/json",
        },
      },
    );

    if (!rcRes.ok) {
      const text = await rcRes.text();
      console.error("RC API error", rcRes.status, text);
      return new Response(JSON.stringify({ error: "RC lookup failed" }), {
        status: 502,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const rcBody = await rcRes.json();
    const subscriber = rcBody.subscriber ?? {};
    const subscriptions: Record<string, RcSubscription> =
      subscriber.subscriptions ?? {};
    const subscriberAttrs: Record<string, { value?: string }> =
      subscriber.subscriber_attributes ?? {};

    const now = Date.now();
    let bestIndividual: ReconciledSub | null = null;
    let bestLeague: (ReconciledSub & { leagueId: string }) | null = null;

    for (const [productId, sub] of Object.entries(subscriptions)) {
      const info = PRODUCT_MAP[productId];
      if (!info) continue;
      if (sub.refunded_at) continue;
      if (!sub.expires_date) continue;
      const expiresMs = new Date(sub.expires_date).getTime();
      if (!Number.isFinite(expiresMs) || expiresMs < now) continue;

      const candidate: ReconciledSub = {
        productId,
        tier: info.tier,
        expiresAt: new Date(expiresMs).toISOString(),
        isAnnual: productId.includes("annual"),
        autoRenew: !sub.unsubscribe_detected_at,
      };

      if (info.scope === "individual") {
        if (
          !bestIndividual ||
          TIER_RANK[candidate.tier] > TIER_RANK[bestIndividual.tier]
        ) {
          bestIndividual = candidate;
        }
      } else {
        const leagueId = subscriberAttrs.league_id?.value ?? "";
        if (!leagueId) continue;
        if (
          !bestLeague ||
          TIER_RANK[candidate.tier] > TIER_RANK[bestLeague.tier]
        ) {
          bestLeague = { ...candidate, leagueId };
        }
      }
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SB_SECRET_KEY") ?? "",
    );

    if (bestIndividual) {
      await supabaseAdmin.from("user_subscriptions").upsert(
        {
          user_id: user.id,
          tier: bestIndividual.tier,
          status: "active",
          starts_at: new Date().toISOString(),
          expires_at: bestIndividual.expiresAt,
          rc_customer_id: user.id,
          rc_product_id: bestIndividual.productId,
          period_type: bestIndividual.isAnnual ? "annual" : "monthly",
          auto_renew: bestIndividual.autoRenew,
        },
        { onConflict: "user_id" },
      );
    } else {
      // RC has no active individual entitlement — make sure the row reflects that.
      await supabaseAdmin
        .from("user_subscriptions")
        .update({ status: "expired", auto_renew: false })
        .eq("user_id", user.id)
        .neq("status", "expired");
    }

    if (bestLeague) {
      await supabaseAdmin.from("league_subscriptions").upsert(
        {
          league_id: bestLeague.leagueId,
          purchased_by: user.id,
          tier: bestLeague.tier,
          status: "active",
          starts_at: new Date().toISOString(),
          expires_at: bestLeague.expiresAt,
          rc_customer_id: user.id,
          rc_product_id: bestLeague.productId,
          period_type: bestLeague.isAnnual ? "annual" : "monthly",
          auto_renew: bestLeague.autoRenew,
        },
        { onConflict: "league_id" },
      );
    }

    return new Response(
      JSON.stringify({
        ok: true,
        individual: bestIndividual && {
          tier: bestIndividual.tier,
          expiresAt: bestIndividual.expiresAt,
          period: bestIndividual.isAnnual ? "annual" : "monthly",
        },
        league: bestLeague && {
          tier: bestLeague.tier,
          expiresAt: bestLeague.expiresAt,
          period: bestLeague.isAnnual ? "annual" : "monthly",
          leagueId: bestLeague.leagueId,
        },
      }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("sync-subscription error:", error);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
