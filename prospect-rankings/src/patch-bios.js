// Backfill scoutingReport on existing DRAFT entries that are missing one,
// using seed/bios.json. Never touches published entries or existing bios.
// Run: node --env-file-if-exists=.env src/patch-bios.js
import { readFileSync } from "node:fs";
import * as contentfulManagement from "contentful-management";

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

const page = await client.entry.getMany({ ...ctx, query: { content_type: typeId, limit: 1000 } });
let patched = 0;
for (const entry of page.items) {
  const slug = entry.fields?.slug?.[locale];
  if (!slug || entry.fields?.scoutingReport || entry.sys.publishedVersion) continue;
  const bio = bios[slug] ?? bios[Object.keys(bios).find((k) => k.startsWith(slug) || slug.startsWith(k)) ?? ""];
  if (!bio) continue;
  entry.fields.scoutingReport = { [locale]: richText(bio) };
  await client.entry.update({ ...ctx, entryId: entry.sys.id }, entry);
  patched++;
  console.log(`  + bio added: ${slug}`);
}
console.log(`Done: ${patched} entries patched.`);
