import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { pushActivityUpdate } from "../_shared/apns.ts";
import { handleError, jsonResponse, errorResponse } from "../_shared/http.ts";
import { parseBody, z } from "../_shared/validate.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const Body = z.object({
  activity_type: z.enum(['matchup', 'auction_draft']),
  filters: z.object({
    schedule_id: z.string().optional(),
    league_id: z.string().optional(),
    draft_id: z.string().optional(),
  }),
  content_state: z.record(z.unknown()),
  end: z.boolean().optional(),
  dismissal_date: z.number().optional(),
});

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
  const serviceKey = Deno.env.get("SB_SECRET_KEY");

  const isCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isService = serviceKey && authHeader === `Bearer ${serviceKey}`;

  if (!isCron && !isService) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const {
      activity_type,
      filters,
      content_state,
      end,
      dismissal_date,
    } = parseBody(Body, await req.json());

    const result = await pushActivityUpdate(
      supabase,
      activity_type,
      filters,
      content_state,
      { end, dismissalDate: dismissal_date },
    );

    return jsonResponse({ ok: true, ...result });
  } catch (error) {
    return handleError(error, 'push-live-activity');
  }
});
