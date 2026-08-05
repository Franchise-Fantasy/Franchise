// Read-only: gather the real, verifiable data we have on every prospect that
// still lacks a bio, so bios can be written from facts instead of invention.
// Writes a JSON dossier to seed/bio-data.json.
import { writeFileSync } from "node:fs";
import * as contentfulManagement from "contentful-management";
import { getRoster, getGamelog, getSummerLeagueLines } from "./lib/espn.js";
import { slugify } from "./lib/names.js";

const L = "en-US";
const ESPN_TEAM_SLUGS = { was: "wsh", uta: "utah", gsw: "gs", sas: "sa", nyk: "ny", nop: "no", pho: "phx" };

const client = contentfulManagement.createClient(
  { accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN },
  { type: "plain" }
);
const ctx = { spaceId: process.env.CONTENTFUL_SPACE_ID, environmentId: "master" };

let all = [];
for (let skip = 0; ; skip += 1000) {
  const p = await client.entry.getMany({
    ...ctx,
    query: { content_type: "prospectProfile", limit: 1000, skip },
  });
  all = all.concat(p.items);
  if (skip + 1000 >= p.total) break;
}

const needBio = all
  .filter((e) => !e.fields?.scoutingReport?.[L])
  .map((e) => ({
    slug: e.fields.slug[L],
    name: e.fields.name[L],
    draftYear: e.fields.draftYear?.[L],
    position: e.fields.position?.[L] ?? null,
    school: e.fields.school?.[L] ?? null,
    team: e.fields.currentTeam?.[L] ?? null,
    height: e.fields.height?.[L] ?? null,
    weight: e.fields.weight?.[L] ?? null,
    dob: e.fields.dob?.[L] ?? null,
  }));

console.log(`${needBio.length} prospects need bios`);

const avg = (games, key) =>
  games.length ? +(games.reduce((s, g) => s + (g[key] ?? 0), 0) / games.length).toFixed(1) : null;

const summarize = (games) =>
  games.length
    ? {
        games: games.length,
        ppg: avg(games, "points"),
        rpg: avg(games, "rebounds"),
        apg: avg(games, "assists"),
        spg: avg(games, "steals"),
        bpg: avg(games, "blocks"),
        mpg: avg(games, "minutes"),
      }
    : null;

// --- drafted class: summer league (one scoreboard scan serves everyone) ---
const drafted = needBio.filter((p) => p.team);
if (drafted.length) {
  console.log(`resolving NBA ids for ${drafted.length} drafted players...`);
  const rosterCache = new Map();
  for (const p of drafted) {
    const raw = (p.team || "").toLowerCase();
    if (!raw || raw === "n/a") continue;
    const teamSlug = ESPN_TEAM_SLUGS[raw] ?? raw;
    if (!rosterCache.has(teamSlug)) {
      try {
        rosterCache.set(teamSlug, await getRoster("nba", teamSlug));
      } catch {
        rosterCache.set(teamSlug, []);
      }
    }
    const hit = (rosterCache.get(teamSlug) || []).find((a) => {
      const s = slugify(a.name);
      return s === p.slug || s.startsWith(p.slug) || p.slug.startsWith(s);
    });
    if (hit) p.espnNbaId = hit.id;
  }

  console.log("scanning summer league box scores...");
  const sl = await getSummerLeagueLines(new Date().getUTCFullYear(), () => {});
  for (const p of drafted) {
    if (p.espnNbaId && sl.get(p.espnNbaId)) p.summerLeague = summarize(sl.get(p.espnNbaId));
  }
}

// --- college prospects: last season's game log ---
const college = needBio.filter((p) => !p.team && p.school && p.draftYear <= 2027);
console.log(`pulling college logs for ${college.length} prospects...`);
const collegeRosters = new Map();
for (const p of college) {
  const school = slugify(p.school);
  if (!collegeRosters.has(school)) {
    try {
      collegeRosters.set(school, await getRoster("mens-college-basketball", school));
    } catch {
      collegeRosters.set(school, []);
    }
  }
  const hit = (collegeRosters.get(school) || []).find((a) => {
    const s = slugify(a.name);
    return s === p.slug || s.startsWith(p.slug) || p.slug.startsWith(s);
  });
  if (!hit) continue;
  try {
    const games = await getGamelog("mens-college-basketball", hit.id);
    if (games.length) p.college = summarize(games);
  } catch {
    /* no log available */
  }
}

writeFileSync(new URL("../seed/bio-data.json", import.meta.url), JSON.stringify(needBio, null, 1));

const withSL = needBio.filter((p) => p.summerLeague).length;
const withCollege = needBio.filter((p) => p.college).length;
console.log(`\ndossier written: ${withSL} with summer league stats, ${withCollege} with college stats`);
console.log(`no stats (profile-stub tier): ${needBio.length - withSL - withCollege}`);
