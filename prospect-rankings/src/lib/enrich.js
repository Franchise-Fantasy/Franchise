// Fill gaps in a scraped player record from ESPN rosters. Ranking sites vary
// wildly in what they publish — RotoBaller gives no measurables at all, for
// instance — so this backstops height/weight/school/hometown at the moment an
// entry is created rather than leaving holes for an editor to chase.
import { getRoster } from "./espn.js";
import { slugify } from "./names.js";

const ESPN_TEAM_SLUGS = { was: "wsh", uta: "utah", gsw: "gs", sas: "sa", nyk: "ny", nop: "no", pho: "phx" };

export function normalizeHeight(v) {
  if (!v) return null;
  const s = String(v).trim();
  if (/^\d+-\d+(\.\d+)?$/.test(s)) return s;
  const m = s.match(/^(\d+)\s*'\s*(\d+(?:\.\d+)?)\s*"?$/);
  return m ? `${m[1]}-${m[2]}` : s;
}

export const normalizeWeight = (v) =>
  v ? String(v).replace(/\s*lbs?\.?\s*$/i, "").trim() : null;

const placeText = (bp) =>
  !bp ? null : bp.displayText ?? ([bp.city, bp.state ?? bp.country].filter(Boolean).join(", ") || null);

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

// Returns a copy of the player with any blanks filled in where ESPN knows more.
export async function enrichPlayer(player) {
  const out = {
    ...player,
    height: normalizeHeight(player.height),
    weight: normalizeWeight(player.weight),
  };
  if (out.height && out.weight && out.hometown && out.school) return out;

  let athlete = null;
  if (out.team && out.team.toLowerCase() !== "n/a") {
    const t = out.team.toLowerCase();
    athlete = (await rosterFor("nba", ESPN_TEAM_SLUGS[t] ?? t)).find((a) => matches(a.name, out.slug));
  }
  if (!athlete && out.school) {
    athlete = (await rosterFor("mens-college-basketball", slugify(out.school))).find((a) =>
      matches(a.name, out.slug)
    );
  }
  if (!athlete) return out;

  out.height ??= normalizeHeight(athlete.height);
  out.weight ??= normalizeWeight(athlete.weight);
  out.hometown ??= placeText(athlete.birthPlace);
  out.school ??= athlete.college;
  return out;
}
