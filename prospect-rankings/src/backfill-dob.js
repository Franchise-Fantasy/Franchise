// Resolve and fill the `dob` field on existing Contentful prospect entries.
// Never touches an entry that already has a dob, and never publishes.
//
//   node --env-file-if-exists=.env src/backfill-dob.js --dry-run
//   node --env-file-if-exists=.env src/backfill-dob.js
import * as contentfulManagement from "contentful-management";
import { resolveDob } from "./lib/dob.js";

const dryRun = process.argv.includes("--dry-run");

const spaceId = process.env.CONTENTFUL_SPACE_ID;
const token = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
const envId = process.env.CONTENTFUL_ENVIRONMENT || "master";
const typeId = process.env.CONTENTFUL_PROSPECT_TYPE || "prospectProfile";
const locale = process.env.CONTENTFUL_LOCALE || "en-US";
if (!spaceId || !token) {
  console.error("Set CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN first.");
  process.exit(1);
}

const client = contentfulManagement.createClient({ accessToken: token }, { type: "plain" });
const ctx = { spaceId, environmentId: envId };

const page = await client.entry.getMany({ ...ctx, query: { content_type: typeId, limit: 1000 } });
console.log(`${page.items.length} entries found${dryRun ? " (dry run — nothing will be written)" : ""}\n`);

const stats = { espn: 0, wikidata: 0, missing: 0, skipped: 0, republished: 0 };
const unresolved = [];
const pendingReview = [];

for (const entry of page.items) {
  const name = entry.fields?.name?.[locale];
  const slug = entry.fields?.slug?.[locale];
  const draftYear = entry.fields?.draftYear?.[locale];
  if (!name || !slug || !draftYear) continue;
  if (entry.fields?.dob?.[locale]) {
    stats.skipped++;
    continue;
  }

  const { dob, source } = await resolveDob({ name, slug }, draftYear, null, console.log);
  if (!dob) {
    stats.missing++;
    unresolved.push(`${name} (${draftYear})`);
    console.log(`  -- ${name}: no reliable DOB found`);
    continue;
  }
  stats[source]++;
  console.log(`  ok ${name}: ${dob}  [${source}]`);

  if (!dryRun) {
    const fresh = await client.entry.get({ ...ctx, entryId: entry.sys.id });
    // Republish only if the live version was already current. If someone has
    // unpublished edits in progress, leave it as a draft change for them to
    // review rather than pushing half-finished work live.
    const wasCleanlyPublished =
      Boolean(fresh.sys.publishedVersion) && fresh.sys.version === fresh.sys.publishedVersion + 1;

    fresh.fields.dob = { [locale]: dob };
    const updated = await client.entry.update({ ...ctx, entryId: entry.sys.id }, fresh);

    if (wasCleanlyPublished) {
      await client.entry.publish({ ...ctx, entryId: entry.sys.id }, updated);
      stats.republished++;
    } else if (fresh.sys.publishedVersion) {
      pendingReview.push(name);
    }
  }
}

console.log(
  `\nESPN: ${stats.espn} | Wikidata: ${stats.wikidata} | already had one: ${stats.skipped} | unresolved: ${stats.missing} | republished: ${stats.republished}`
);
if (pendingReview.length) {
  console.log(
    `\n${pendingReview.length} entries had unpublished edits in progress — DOB saved as a draft change for an editor to publish:\n  ` +
      pendingReview.join("\n  ")
  );
}
if (unresolved.length) {
  console.log(`\n${unresolved.length} need a manual DOB in Contentful:\n  ` + unresolved.join("\n  "));
}
