// Fill blank fields on existing prospect entries from sources we already
// trust, and normalize height formatting so the app doesn't render 6-9 next
// to 6'9". Only ever fills a blank — editor-entered values are left alone
// (height formatting is the one exception, and it changes style, not data).
//
//   node --env-file-if-exists=.env src/fill-missing.js --dry-run
//   node --env-file-if-exists=.env src/fill-missing.js
import * as contentfulManagement from "contentful-management";
import { getRoster } from "./lib/espn.js";
import { espnRecruiting } from "./sources/espn-recruiting.js";
import { slugify } from "./lib/names.js";

const dryRun = process.argv.includes("--dry-run");
const L = process.env.CONTENTFUL_LOCALE || "en-US";
const ESPN_TEAM_SLUGS = { was: "wsh", uta: "utah", gsw: "gs", sas: "sa", nyk: "ny", nop: "no", pho: "phx" };

// "6' 8\"" / "6'6\"" / "6'1.5\"" -> "6-8" / "6-6" / "6-1.5"; "6-9" passes through.
function normalizeHeight(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d+-\d+(\.\d+)?$/.test(s)) return s;
  const m = s.match(/^(\d+)\s*'\s*(\d+(?:\.\d+)?)\s*"?$/);
  return m ? `${m[1]}-${m[2]}` : s;
}
const normalizeWeight = (v) => (v ? String(v).replace(/\s*lbs?\.?\s*$/i, "").trim() : null);
const placeText = (bp) =>
  !bp ? null : bp.displayText ?? ([bp.city, bp.state ?? bp.country].filter(Boolean).join(", ") || null);

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
console.log(`${all.length} entries loaded`);

// --- source 1: ESPN recruiting boards (hometown/height/weight for HS classes) ---
const recruits = new Map();
const hsYears = [...new Set(all.map((e) => e.fields.draftYear?.[L]).filter((y) => y >= 2028))].sort();
for (const draftYear of hsYears) {
  try {
    const res = await espnRecruiting(draftYear - 1).scrape();
    for (const p of res.players) recruits.set(p.slug, p);
    console.log(`  recruiting class ${draftYear - 1}: ${res.players.length} players`);
  } catch (err) {
    console.warn(`  recruiting class ${draftYear - 1} failed: ${err.message}`);
  }
}

// --- source 2: ESPN rosters (NBA for drafted, college for the rest) ---
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

async function athleteFor(entry) {
  const slug = entry.fields.slug[L];
  const team = entry.fields.currentTeam?.[L];
  const school = entry.fields.school?.[L];
  if (team && team.toLowerCase() !== "n/a") {
    const t = team.toLowerCase();
    const hit = (await rosterFor("nba", ESPN_TEAM_SLUGS[t] ?? t)).find((a) => matches(a.name, slug));
    if (hit) return hit;
  }
  if (school) {
    const hit = (await rosterFor("mens-college-basketball", slugify(school))).find((a) => matches(a.name, slug));
    if (hit) return hit;
  }
  return null;
}

const filled = { height: 0, weight: 0, hometown: 0, school: 0, normalized: 0 };
let changedEntries = 0;

for (const entry of all) {
  const slug = entry.fields.slug[L];
  const f = entry.fields;
  const updates = {};

  // formatting fix on values that already exist
  const currentH = f.height?.[L];
  const normH = normalizeHeight(currentH);
  if (currentH && normH !== currentH) {
    updates.height = normH;
    filled.normalized++;
  }

  const rec = recruits.get(slug);
  const needs = (k) => !f[k]?.[L] && updates[k] === undefined;

  if (rec) {
    if (needs("hometown") && rec.hometown) updates.hometown = rec.hometown;
    if (needs("height") && rec.height) updates.height = normalizeHeight(rec.height);
    if (needs("weight") && rec.weight) updates.weight = normalizeWeight(rec.weight);
  }

  if (needs("height") || needs("weight") || needs("hometown") || needs("school")) {
    const ath = await athleteFor(entry);
    if (ath) {
      if (needs("height") && ath.height) updates.height = normalizeHeight(ath.height);
      if (needs("weight") && ath.weight) updates.weight = normalizeWeight(ath.weight);
      if (needs("hometown") && ath.birthPlace) updates.hometown = placeText(ath.birthPlace);
      if (needs("school") && ath.college) updates.school = ath.college;
    }
  }

  const keys = Object.keys(updates).filter((k) => updates[k] != null);
  if (!keys.length) continue;
  for (const k of keys) if (k !== "height" || !currentH) filled[k] = (filled[k] ?? 0) + 1;
  changedEntries++;
  console.log(`  ${f.name[L]}: ${keys.map((k) => `${k}=${updates[k]}`).join(", ")}`);
  if (dryRun) continue;

  const fresh = await client.entry.get({ ...ctx, entryId: entry.sys.id });
  const wasCleanlyPublished =
    Boolean(fresh.sys.publishedVersion) && fresh.sys.version === fresh.sys.publishedVersion + 1;
  for (const k of keys) fresh.fields[k] = { [L]: updates[k] };
  const updated = await client.entry.update({ ...ctx, entryId: entry.sys.id }, fresh);
  if (wasCleanlyPublished) await client.entry.publish({ ...ctx, entryId: entry.sys.id }, updated);
}

console.log(
  `\n${changedEntries} entries ${dryRun ? "would change" : "updated"} — ` +
    `height ${filled.height}, weight ${filled.weight}, hometown ${filled.hometown}, school ${filled.school}, ` +
    `heights reformatted ${filled.normalized}`
);
