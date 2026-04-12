import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { pushActivityUpdate, type ActivityType } from "../_shared/apns.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/**
 * Push Live Activity updates to registered iOS devices.
 *
 * Called internally by crons (get-week-scores, poll-live-stats) or
 * directly by event-driven edge functions (future auction bids).
 *
 * Body: {
 *   activity_type: 'matchup' | 'auction_draft',
 *   filters: { schedule_id?, league_id?, draft_id? },
 *   content_state: { ...ActivityKit content state },
 *   end?: boolean,
 *   dismissal_date?: number,  // Unix timestamp
 * }
 */
Deno.serve(async (req: Request) => {
  // Only callable from other edge functions (service role) or cron
  const cronSecret = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("Authorization");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isService = serviceKey && authHeader === `Bearer ${serviceKey}`;

  if (!isCron && !isService) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const {
      activity_type,
      filters,
      content_state,
      end,
      dismissal_date,
    } = await req.json() as {
      activity_type: ActivityType;
      filters: { schedule_id?: string; league_id?: string; draft_id?: string };
      content_state: Record<string, unknown>;
      end?: boolean;
      dismissal_date?: number;
    };

    if (!activity_type || !content_state) {
      return new Response(
        JSON.stringify({ error: "activity_type and content_state are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await pushActivityUpdate(
      supabase,
      activity_type,
      filters,
      content_state,
      { end, dismissalDate: dismissal_date },
    );

    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("push-live-activity error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
