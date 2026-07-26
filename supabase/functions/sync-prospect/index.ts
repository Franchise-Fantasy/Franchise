import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS } from "../_shared/cors.ts";
import { handleError, jsonResponse, errorResponse } from "../_shared/http.ts";
import { normalizeName } from "../_shared/normalize.ts";
import { parseBody, z } from "../_shared/validate.ts";

/**
 * sync-prospect — Contentful webhook handler
 *
 * Triggered on publish/unpublish of a "prospectProfile" entry in Contentful.
 * Creates or updates the corresponding row in the `players` table so
 * prospects can be drafted in dynasty leagues before BDL assigns an ID.
 *
 * This is the bridge between the slug-keyed rankings pipeline and the app's
 * UUID-keyed draft flow: it stamps `players.player_slug` from the entry's
 * `slug` field so the board/rankings (joined on slug) resolve to a draftable
 * `players.id`. draftYear is an integer field now (was the "2028+" string).
 *
 * Auth: CONTENTFUL_WEBHOOK_SECRET via X-Webhook-Secret header.
 * Deploy with verify_jwt=false (webhook calls, not user calls).
 */

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// Contentful webhook payload — permissive shape: only validate what we read.
const Body = z.object({
  sys: z.object({ id: z.string().min(1, 'sys.id is required') }),
  fields: z.record(z.unknown()).optional(),
});

/** Extract a plain field value from Contentful's locale-wrapped format. */
function field(fields: Record<string, any>, key: string): any {
  const val = fields[key];
  if (val === undefined || val === null) return null;
  // Contentful sends { "en-US": value } when localized
  if (typeof val === "object" && "en-US" in val) return val["en-US"];
  return val;
}

type ExistingPlayer = { id: string; pro_team: string | null };

// sport-scope: the lookups below are all .eq('sport','nba') or keyed on a
// unique contentful_entry_id — the Contentful prospect pipeline is NBA-only.

/**
 * The `players` row this entry belongs to, if one already exists. Matched in
 * order of decreasing confidence: the Contentful entry id, then the slug, then
 * name + draft class.
 *
 * The name fallback is what stops a CMS re-seed from minting a second row for
 * a player who is already in the app: re-created entries carry NEW entry ids,
 * and a prospect who has since been drafted was created by the pro sync with
 * no slug at all. Both happened on 2026-07-25 and put ~62 players in the 2026
 * rookie draft pool twice.
 */
async function findExistingPlayer(
  entryId: string,
  slug: string | null,
  name: string,
  draftYear: number | null,
): Promise<ExistingPlayer | null> {
  // sport-scope: every lookup below is scoped to the NBA prospect pipeline
  const byEntry = await supabase
    .from("players")
    .select("id, pro_team")
    .eq("contentful_entry_id", entryId)
    .maybeSingle();
  if (byEntry.error) throw byEntry.error;
  if (byEntry.data) return byEntry.data;

  if (slug) {
    const bySlug = await supabase
      .from("players")
      .select("id, pro_team")
      .eq("sport", "nba")
      .eq("player_slug", slug)
      .maybeSingle();
    if (bySlug.error) throw bySlug.error;
    if (bySlug.data) return bySlug.data;
  }

  if (draftYear == null) return null;
  // Compare with the SAME normalizer sync-players matches on, so "Morez
  // Johnson Jr." (CMS) and "Morez Johnson" (pro feed) resolve to one row.
  // Matching in JS, not with ilike: a Contentful name can contain `%`/`_`,
  // which ilike would treat as wildcards.
  const classRows = await supabase
    .from("players")
    .select("id, pro_team, name")
    .eq("sport", "nba")
    .eq("draft_year", draftYear);
  if (classRows.error) throw classRows.error;

  const target = normalizeName(name);
  const matches = (classRows.data ?? []).filter((p) => normalizeName(p.name) === target);
  // Two players of the same name in one class is possible; don't guess.
  return matches.length === 1 ? matches[0] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  // Verify webhook secret
  const secret = Deno.env.get("CONTENTFUL_WEBHOOK_SECRET");
  const headerSecret = req.headers.get("X-Webhook-Secret");
  if (!secret || headerSecret !== secret) {
    return errorResponse("Unauthorized", 401);
  }

  try {
    const body = parseBody(Body, await req.json());
    const topic = req.headers.get("X-Contentful-Topic") ?? "";
    const entryId = body.sys.id;

    // Unpublish: soft-disable the prospect (don't delete — may be on rosters)
    if (topic.includes("unpublish") || topic.includes("delete")) {
      // sport-scope: contentful_entry_id is a unique key (NBA prospect pipeline)
      const { error } = await supabase
        .from("players")
        .update({ is_prospect: false, updated_at: new Date().toISOString() })
        .eq("contentful_entry_id", entryId);

      return jsonResponse({
        action: "unpublish",
        entryId,
        error: error?.message ?? null,
      }, error ? 500 : 200);
    }

    // Publish: upsert the prospect into players
    const fields = (body.fields ?? {}) as Record<string, any>;
    const name = field(fields, "name");
    if (!name) {
      return errorResponse("Prospect entry missing name", 400);
    }

    const position = field(fields, "position");
    const school = field(fields, "school");
    const slug = field(fields, "slug");
    const draftYear = field(fields, "draftYear");

    // draftYear is a Contentful Integer field now; be defensive about strings.
    let nbaDraftYear: number | null = null;
    if (draftYear != null) {
      const parsed = parseInt(String(draftYear).replace(/\D/g, ""), 10);
      if (!isNaN(parsed)) nbaDraftYear = parsed;
    }

    const existing = await findExistingPlayer(entryId, slug ?? null, name, nbaDraftYear);
    // A prospect who has already been drafted into the league is a real player
    // now: the pro sync owns their name, position, team and injury status. Only
    // stamp the CMS bridge fields on them — writing status:'prospect' back over
    // an active pro would hide them from every roster surface.
    const graduated = !!existing?.pro_team;

    const playerRow = {
      // The join bridge: the rankings pipeline + prospect_board join on slug,
      // so stamping it here is what makes a published prospect resolve to a
      // draftable players.id.
      player_slug: slug ?? null,
      contentful_entry_id: entryId,
      school: school ?? null,
      draft_year: nbaDraftYear,
      is_prospect: true,
      // Explicit, not the column DEFAULT — the Contentful prospect pipeline
      // is NBA-only.
      sport: "nba",
      updated_at: new Date().toISOString(),
      ...(graduated ? {} : {
        name,
        position: position ?? null,
        rookie: true,
        status: "prospect",
      }),
    };

    // sport-scope: playerRow carries sport:'nba' explicitly (built above)
    const { data, error } = existing
      ? await supabase
          .from("players")
          .update(playerRow)
          .eq("id", existing.id)
          .select("id, name")
          .single()
      // sport-scope: playerRow carries sport:'nba' explicitly (built above)
      : await supabase
          .from("players")
          .insert(playerRow)
          .select("id, name")
          .single();

    if (error) {
      throw error;
    }

    return jsonResponse({
      action: "publish",
      playerId: data.id,
      name: data.name,
      entryId,
    });
  } catch (error) {
    return handleError(error, 'sync-prospect');
  }
});
