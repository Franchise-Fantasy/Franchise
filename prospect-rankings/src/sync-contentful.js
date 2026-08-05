import * as contentfulManagement from "contentful-management";
import { resolveDob } from "./lib/dob.js";
import { enrichPlayer } from "./lib/enrich.js";

// For every ranked player with no Contentful entry yet, create an UNPUBLISHED
// draft with the machine-known fields filled in (name, slug, position, school,
// draft year). Editors add bio/photo/video and hit Publish — the entry never
// goes live without a human. Existing entries are never modified.
export async function syncContentful(boards) {
  const spaceId = process.env.CONTENTFUL_SPACE_ID;
  const token = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
  if (!spaceId || !token) {
    console.log("  Contentful: credentials not set, skipping draft creation");
    return;
  }
  const envId = process.env.CONTENTFUL_ENVIRONMENT || "master";
  const typeId = process.env.CONTENTFUL_PROSPECT_TYPE || "prospectProfile";
  const locale = process.env.CONTENTFUL_LOCALE || "en-US";

  const client = contentfulManagement.createClient({ accessToken: token }, { type: "plain" });
  const ctx = { spaceId, environmentId: envId };

  // Only set fields that actually exist on the content type.
  const contentType = await client.contentType.get({ ...ctx, contentTypeId: typeId });
  const fieldIds = new Set(contentType.fields.map((f) => f.id));

  // Existing slugs (drafts included), paged.
  const existing = new Set();
  for (let skip = 0; ; skip += 1000) {
    const page = await client.entry.getMany({
      ...ctx,
      query: { content_type: typeId, select: "fields.slug", limit: 1000, skip },
    });
    for (const e of page.items) existing.add(e.fields?.slug?.[locale]);
    if (skip + 1000 >= page.total) break;
  }

  let created = 0;
  for (const board of boards) {
    for (const rawPlayer of board.players) {
      if (existing.has(rawPlayer.slug)) continue;
      // Sources disagree on what they publish; backstop the gaps from ESPN so
      // new entries arrive complete instead of needing a manual cleanup pass.
      const p = await enrichPlayer(rawPlayer);
      const fields = {};
      const maybe = (id, value) => {
        if (fieldIds.has(id) && value != null) fields[id] = { [locale]: value };
      };
      maybe("name", p.name);
      maybe("slug", p.slug);
      maybe("sport", "NBA");
      maybe("position", p.position);
      maybe("school", p.school);
      maybe("currentTeam", p.team);
      maybe("draftYear", board.draftYear);
      maybe("height", p.height);
      maybe("weight", p.weight);
      maybe("hometown", p.hometown);

      // Only a handful of players are new in any given week, so resolving a
      // birthday here is cheap. Unresolved players are left blank for an editor.
      if (fieldIds.has("dob")) {
        const { dob } = await resolveDob(p, board.draftYear, null, console.log);
        maybe("dob", dob);
      }
      await client.entry.create({ ...ctx, contentTypeId: typeId }, { fields }); // stays a draft on purpose
      existing.add(p.slug);
      created++;
    }
  }
  console.log(`  Contentful: ${created} new draft entr${created === 1 ? "y" : "ies"} created`);
}
