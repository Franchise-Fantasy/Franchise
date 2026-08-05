// Pull official ESPN headshot cutouts (transparent PNGs) for prospects that
// don't have a photo yet, upload them to Contentful, and link them to `photo`.
//
// Only fills empty photo fields — a headshot an editor chose by hand is never
// replaced. High-school prospects have no ESPN headshot and are skipped.
//
//   node --env-file-if-exists=.env src/sync-headshots.js --dry-run
//   node --env-file-if-exists=.env src/sync-headshots.js --limit 1
//   node --env-file-if-exists=.env src/sync-headshots.js
import * as contentfulManagement from "contentful-management";
import { getRoster } from "./lib/espn.js";
import { slugify } from "./lib/names.js";

export async function syncHeadshots({ dryRun = false, limit = Infinity } = {}) {
  return run({ dryRun, limit });
}

const isCli = process.argv[1]?.endsWith("sync-headshots.js");
const limitArg = process.argv.indexOf("--limit");
if (isCli) {
  await run({
    dryRun: process.argv.includes("--dry-run"),
    limit: limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity,
  });
}

async function run({ dryRun, limit: LIMIT }) {
const L = process.env.CONTENTFUL_LOCALE || "en-US";
const ESPN_TEAM_SLUGS = { was: "wsh", uta: "utah", gsw: "gs", sas: "sa", nyk: "ny", nop: "no", pho: "phx" };
const headshotUrl = (league, id) =>
  `https://a.espncdn.com/i/headshots/${league}/players/full/${id}.png`;

const client = contentfulManagement.createClient(
  { accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN },
  { type: "plain" }
);
const ctx = { spaceId: process.env.CONTENTFUL_SPACE_ID, environmentId: process.env.CONTENTFUL_ENVIRONMENT || "master" };

let all = [];
for (let skip = 0; ; skip += 1000) {
  const p = await client.entry.getMany({
    ...ctx,
    query: { content_type: process.env.CONTENTFUL_PROSPECT_TYPE || "prospectProfile", limit: 1000, skip },
  });
  all = all.concat(p.items);
  if (skip + 1000 >= p.total) break;
}

const needPhoto = all.filter((e) => !e.fields?.photo?.[L]);
console.log(`${needPhoto.length} of ${all.length} entries have no photo`);

// --- resolve an ESPN headshot URL per player ---
const rosterCache = new Map();
async function rosterFor(league, teamSlug) {
  const key = `${league}/${teamSlug}`;
  if (!rosterCache.has(key)) {
    try {
      rosterCache.set(key, await getRoster(league, teamSlug));
    } catch {
      rosterCache.set(key, []);
    }
  }
  return rosterCache.get(key);
}

const matches = (rosterName, slug) => {
  const s = slugify(rosterName);
  return s === slug || s.startsWith(slug) || slug.startsWith(s);
};

async function urlFor(entry) {
  const slug = entry.fields.slug[L];
  const team = entry.fields.currentTeam?.[L];
  const school = entry.fields.school?.[L];

  if (team && team.toLowerCase() !== "n/a") {
    const t = team.toLowerCase();
    const roster = await rosterFor("nba", ESPN_TEAM_SLUGS[t] ?? t);
    const hit = roster.find((a) => matches(a.name, slug));
    if (hit) return { url: headshotUrl("nba", hit.id), source: "espn-nba" };
  }
  if (school) {
    const roster = await rosterFor("mens-college-basketball", slugify(school));
    const hit = roster.find((a) => matches(a.name, slug));
    if (hit) return { url: headshotUrl("mens-college-basketball", hit.id), source: "espn-cbb" };
  }
  return null;
}

let found = 0;
let uploaded = 0;
const skipped = [];

for (const entry of needPhoto) {
  if (uploaded >= LIMIT) break;
  const name = entry.fields.name[L];
  const resolved = await urlFor(entry);
  if (!resolved) {
    skipped.push(name);
    continue;
  }

  // Confirm the image actually exists and is a real PNG before committing.
  const res = await fetch(resolved.url, { headers: { "user-agent": "Mozilla/5.0" } });
  if (!res.ok) {
    skipped.push(`${name} (no headshot on file)`);
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length < 5000) {
    skipped.push(`${name} (placeholder image)`);
    continue;
  }
  found++;
  console.log(`  ${name}: ${resolved.source}`);
  if (dryRun) continue;

  const upload = await client.upload.create({ spaceId: ctx.spaceId }, { file: bytes });
  let asset = await client.asset.create(ctx, {
    fields: {
      title: { [L]: `${name} headshot` },
      description: { [L]: `Official ${resolved.source === "espn-nba" ? "NBA" : "college"} headshot via ESPN` },
      file: {
        [L]: {
          contentType: "image/png",
          fileName: `${entry.fields.slug[L]}.png`,
          uploadFrom: { sys: { type: "Link", linkType: "Upload", id: upload.sys.id } },
        },
      },
    },
  });
  asset = await client.asset.processForAllLocales(ctx, asset);

  // Processing is async; wait for the file URL to appear before publishing.
  for (let i = 0; i < 20; i++) {
    asset = await client.asset.get({ ...ctx, assetId: asset.sys.id });
    if (asset.fields.file?.[L]?.url) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  await client.asset.publish({ ...ctx, assetId: asset.sys.id }, asset);

  const fresh = await client.entry.get({ ...ctx, entryId: entry.sys.id });
  const wasCleanlyPublished =
    Boolean(fresh.sys.publishedVersion) && fresh.sys.version === fresh.sys.publishedVersion + 1;
  fresh.fields.photo = { [L]: { sys: { type: "Link", linkType: "Asset", id: asset.sys.id } } };
  const updated = await client.entry.update({ ...ctx, entryId: entry.sys.id }, fresh);
  if (wasCleanlyPublished) await client.entry.publish({ ...ctx, entryId: entry.sys.id }, updated);
  uploaded++;
}

console.log(`\nheadshots available: ${found}${dryRun ? " (dry run — nothing uploaded)" : ` | uploaded: ${uploaded}`}`);
console.log(`no headshot available: ${skipped.length}`);
}
