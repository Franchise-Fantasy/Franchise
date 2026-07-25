// One-time CMS seeding: scrape fresh boards, take the top N per draft year,
// and create Contentful draft entries pre-filled with everything including a
// hand-written scouting bio where one exists in seed/bios.json.
// Entries stay UNPUBLISHED so editors can review bios and add photos/videos.
//
// Run: npm run seed   (needs CONTENTFUL_SPACE_ID + CONTENTFUL_MANAGEMENT_TOKEN in .env)
import { readFileSync } from "node:fs";
import * as contentfulManagement from "contentful-management";
import { SOURCES, MIN_ROWS } from "./sources/index.js";
import { buildConsensus } from "./consensus.js";

const SEED_COUNT_DRAFTED = 15; // most recent (drafted) class
const SEED_COUNT_FUTURE = 10; // next draft class (college boards)
const SEED_COUNT_OUTER = 5; // HS-class years (2+ drafts out)

const bios = JSON.parse(new TextDecoder().decode(readFileSync(new URL("../seed/bios.json", import.meta.url))));

// "mikel-brown" should find a bio keyed "mikel-brown-jr" and vice versa.
function findBio(slug) {
  if (bios[slug]) return bios[slug];
  const hit = Object.keys(bios).find((k) => k.startsWith(slug) || slug.startsWith(k));
  return hit ? bios[hit] : null;
}

function richText(text) {
  return {
    nodeType: "document",
    data: {},
    content: text.split(/\n\n+/).map((p) => ({
      nodeType: "paragraph",
      data: {},
      content: [{ nodeType: "text", value: p.trim(), marks: [], data: {} }],
    })),
  };
}

const spaceId = process.env.CONTENTFUL_SPACE_ID;
const token = process.env.CONTENTFUL_MANAGEMENT_TOKEN;
if (!spaceId || !token) {
  console.error("Set CONTENTFUL_SPACE_ID and CONTENTFUL_MANAGEMENT_TOKEN in .env first.");
  process.exit(1);
}
const envId = process.env.CONTENTFUL_ENVIRONMENT || "master";
const typeId = process.env.CONTENTFUL_PROSPECT_TYPE || "prospectProfile";
const locale = process.env.CONTENTFUL_LOCALE || "en-US";

console.log("Scraping fresh boards...");
const scrapes = [];
for (const { scraper, options, weight, minRows } of SOURCES) {
  try {
    const result = { ...(await scraper.scrape(options)), weight: weight ?? 1 };
    if (result.players.length < (minRows ?? MIN_ROWS)) continue;
    console.log(`  ${scraper.id}: ${result.players.length} players (${result.draftYear})`);
    scrapes.push(result);
  } catch (err) {
    console.warn(`  ${scraper.id} failed: ${err.message}`);
  }
}
const boards = buildConsensus(scrapes);
if (!boards.length) {
  console.error("No boards scraped — aborting.");
  process.exit(1);
}

const client = contentfulManagement.createClient({ accessToken: token }, { type: "plain" });
const ctx = { spaceId, environmentId: envId };

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
const missingBios = [];
const firstFutureYear = boards.find((b) => !b.players.some((p) => p.team))?.draftYear;
for (const board of boards) {
  const hasTeams = board.players.some((p) => p.team);
  const count = hasTeams
    ? SEED_COUNT_DRAFTED
    : board.draftYear === firstFutureYear
      ? SEED_COUNT_FUTURE
      : SEED_COUNT_OUTER;
  console.log(`\n${board.draftYear} class — seeding top ${count}:`);

  for (const p of board.players.slice(0, count)) {
    if (existing.has(p.slug)) {
      console.log(`  = ${p.name} (already exists, skipped)`);
      continue;
    }
    const f = (value) => ({ [locale]: value });
    const fields = {
      name: f(p.name),
      slug: f(p.slug),
      sport: f("NBA"),
      draftYear: f(board.draftYear),
    };
    if (p.position) fields.position = f(p.position);
    if (p.school) fields.school = f(p.school);
    if (p.team) fields.currentTeam = f(p.team);
    if (p.height) fields.height = f(p.height);
    if (p.weight) fields.weight = f(String(p.weight));

    const bio = findBio(p.slug);
    if (bio) fields.scoutingReport = f(richText(bio));
    else missingBios.push(`${p.slug} (${board.draftYear})`);

    await client.entry.create({ ...ctx, contentTypeId: typeId }, { fields });
    existing.add(p.slug);
    created++;
    console.log(`  + ${p.name}${bio ? " [bio]" : " [NO BIO — needs one]"}`);
  }
}

console.log(`\nDone: ${created} draft entries created (all unpublished, ready for editorial review).`);
if (missingBios.length) console.log("Players still needing bios:\n  " + missingBios.join("\n  "));
