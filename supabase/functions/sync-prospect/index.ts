import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";

/**
 * sync-prospect — Contentful webhook handler
 *
 * Triggered on publish/unpublish of a "prospect" entry in Contentful.
 * Creates or updates the corresponding row in the `players` table so
 * prospects can be drafted in dynasty leagues before BDL assigns an ID.
 *
 * Auth: CONTENTFUL_WEBHOOK_SECRET via X-Webhook-Secret header.
 * Deploy with verify_jwt=false (webhook calls, not user calls).
 */

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const jsonHeaders = {
  ...CORS_HEADERS,
  "Content-Type": "application/json",
};

/** Extract a plain field value from Contentful's locale-wrapped format. */
function field(fields: Record<string, any>, key: string): any {
  const val = fields[key];
  if (val === undefined || val === null) return null;
  // Contentful sends { "en-US": value } when localized
  if (typeof val === "object" && "en-US" in val) return val["en-US"];
  return val;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Verify webhook secret
  const secret = Deno.env.get("CONTENTFUL_WEBHOOK_SECRET");
  const headerSecret = req.headers.get("X-Webhook-Secret");
  if (!secret || headerSecret !== secret) {
    return new Response(
      JSON.stringify({ error: "Unauthorized" }),
      { status: 401, headers: jsonHeaders },
    );
  }

  try {
    const body = await req.json();
    const topic = req.headers.get("X-Contentful-Topic") ?? "";
    const entryId: string = body?.sys?.id;

    if (!entryId) {
      return new Response(
        JSON.stringify({ error: "Missing entry ID" }),
        { status: 400, headers: jsonHeaders },
      );
    }

    // Unpublish: soft-disable the prospect (don't delete — may be on rosters)
    if (topic.includes("unpublish") || topic.includes("delete")) {
      const { error } = await supabase
        .from("players")
        .update({ is_prospect: false, updated_at: new Date().toISOString() })
        .eq("contentful_entry_id", entryId);

      return new Response(
        JSON.stringify({
          action: "unpublish",
          entryId,
          error: error?.message ?? null,
        }),
        { status: error ? 500 : 200, headers: jsonHeaders },
      );
    }

    // Publish: upsert the prospect into players
    const fields = body?.fields ?? {};
    const name = field(fields, "name");
    if (!name) {
      return new Response(
        JSON.stringify({ error: "Prospect entry missing name" }),
        { status: 400, headers: jsonHeaders },
      );
    }

    const position = field(fields, "position");
    const school = field(fields, "school");
    const draftYear = field(fields, "projectedDraftYear");
    const dynastyScore = field(fields, "dynastyValueScore");

    // Parse draft year — Contentful sends "2025", "2026", "2027", "2028+"
    let nbaDraftYear: number | null = null;
    if (draftYear) {
      const parsed = parseInt(String(draftYear).replace("+", ""), 10);
      if (!isNaN(parsed)) nbaDraftYear = parsed;
    }

    const playerRow = {
      name,
      position: position ?? null,
      school: school ?? null,
      nba_draft_year: nbaDraftYear,
      dynasty_value_score: dynastyScore ?? null,
      contentful_entry_id: entryId,
      is_prospect: true,
      rookie: true,
      status: "prospect",
      updated_at: new Date().toISOString(),
    };

    // Upsert: match on contentful_entry_id
    const { data, error } = await supabase
      .from("players")
      .upsert(playerRow, { onConflict: "contentful_entry_id" })
      .select("id, name")
      .single();

    if (error) {
      return new Response(
        JSON.stringify({ error: 'Internal server error' }),
        { status: 500, headers: jsonHeaders },
      );
    }

    return new Response(
      JSON.stringify({
        action: "publish",
        playerId: data.id,
        name: data.name,
        entryId,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
