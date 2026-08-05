// Fill scoutingReport on prospect entries that don't have one, from
// seed/bios.json. Never overwrites an existing bio. Republishes entries that
// were already cleanly published so the bio actually reaches the app; entries
// with unpublished edits in progress are left as draft changes for an editor.
//
//   node --env-file-if-exists=.env src/patch-bios.js --dry-run
//   node --env-file-if-exists=.env src/patch-bios.js
import { readFileSync } from "node:fs";
import * as contentfulManagement from "contentful-management";

const dryRun = process.argv.includes("--dry-run");
const bios = JSON.parse(new TextDecoder().decode(readFileSync(new URL("../seed/bios.json", import.meta.url))));

const spaceId = process.env.CONTENTFUL_SPACE_ID;
const token = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const envId = process.env.CONTENTFUL_ENVIRONMENT || "master";
const typeId = process.env.CONTENTFUL_PROSPECT_TYPE || "prospectProfile";
const locale = process.env.CONTENTFUL_LOCALE || "en-US";

const richText = (text) => ({
  nodeType: "document",
  data: {},
  content: text.split(/\n\n+/).map((p) => ({
    nodeType: "paragraph",
    data: {},
    content: [{ nodeType: "text", value: p.trim(), marks: [], data: {} }],
  })),
});

const client = contentfulManagement.createClient({ accessToken: token }, { type: "plain" });
const ctx = { spaceId, environmentId: envId };

let all = [];
for (let skip = 0; ; skip += 1000) {
  const page = await client.entry.getMany({ ...ctx, query: { content_type: typeId, limit: 1000, skip } });
  all = all.concat(page.items);
  if (skip + 1000 >= page.total) break;
}

let patched = 0;
let republished = 0;
const pendingReview = [];
const noBioAvailable = [];

for (const entry of all) {
  const slug = entry.fields?.slug?.[locale];
  if (!slug || entry.fields?.scoutingReport?.[locale]) continue;

  const key = bios[slug]
    ? slug
    : Object.keys(bios).find((k) => k.startsWith(slug) || slug.startsWith(k));
  const bio = key ? bios[key] : null;
  if (!bio) {
    noBioAvailable.push(`${entry.fields?.name?.[locale] ?? slug}`);
    continue;
  }

  patched++;
  console.log(`  + ${entry.fields?.name?.[locale] ?? slug}`);
  if (dryRun) continue;

  const fresh = await client.entry.get({ ...ctx, entryId: entry.sys.id });
  const wasCleanlyPublished =
    Boolean(fresh.sys.publishedVersion) && fresh.sys.version === fresh.sys.publishedVersion + 1;

  fresh.fields.scoutingReport = { [locale]: richText(bio) };
  const updated = await client.entry.update({ ...ctx, entryId: entry.sys.id }, fresh);

  if (wasCleanlyPublished) {
    await client.entry.publish({ ...ctx, entryId: entry.sys.id }, updated);
    republished++;
  } else if (fresh.sys.publishedVersion) {
    pendingReview.push(entry.fields?.name?.[locale] ?? slug);
  }
}

console.log(`\n${patched} bios written${dryRun ? " (dry run)" : ""}, ${republished} republished.`);
if (pendingReview.length) {
  console.log(`${pendingReview.length} saved as draft changes (had edits in progress): ${pendingReview.join(", ")}`);
}
if (noBioAvailable.length) {
  console.log(`\n${noBioAvailable.length} still have no bio text available.`);
}
