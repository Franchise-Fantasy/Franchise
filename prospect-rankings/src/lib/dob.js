// Date-of-birth resolution.
//
// Two sources, both exact (no derived/estimated dates — an age figure like
// Tankathon's "19.69 yrs" has an ambiguous reference date and could be a full
// year off, so we never reverse-engineer a birthday from one):
//   1. ESPN NBA athlete endpoint — drafted players only, authoritative.
//   2. Wikidata — covers college and notable HS prospects.
// Anyone we can't resolve is left blank for an editor to fill in by hand.

const UA = "FranchiseFantasyBot/1.0 (prospect bios; contact: noahgordon2021@outlook.com)";
const DELAY_MS = 1100; // Wikidata asks for polite, serial access

let lastFetch = 0;
async function fetchJson(url) {
  const wait = lastFetch + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// ESPN returns displayDOB as "D/M/YYYY" (e.g. "18/7/2007").
export async function dobFromEspnNba(athleteId) {
  const d = await fetchJson(
    `https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${athleteId}`
  );
  const raw = (d.athlete ?? d).displayDOB;
  if (!raw) return null;
  const [day, month, year] = raw.split("/").map(Number);
  if (!day || !month || !year) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const WIKIDATA_HUMAN = "Q5";
const BASKETBALL_OCCUPATIONS = new Set([
  "Q3665646", // basketball player
  "Q13141064", // basketball coach (guards against odd data, still validated below)
]);

// Name search can easily hit the wrong person, so an entity only counts if it
// is a human, reads as a basketball player, and has a birth year plausible for
// a current prospect.
export async function dobFromWikidata(fullName, { minYear, maxYear }) {
  const search = await fetchJson(
    `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(
      fullName
    )}&language=en&format=json&limit=5`
  );
  for (const hit of search.search ?? []) {
    const desc = (hit.description ?? "").toLowerCase();
    if (desc && !desc.includes("basketball")) continue;

    const data = await fetchJson(
      `https://www.wikidata.org/wiki/Special:EntityData/${hit.id}.json`
    );
    const entity = data.entities?.[hit.id];
    if (!entity) continue;

    const isHuman = (entity.claims?.P31 ?? []).some(
      (c) => c.mainsnak?.datavalue?.value?.id === WIKIDATA_HUMAN
    );
    if (!isHuman) continue;

    const playsBasketball =
      desc.includes("basketball") ||
      (entity.claims?.P106 ?? []).some((c) =>
        BASKETBALL_OCCUPATIONS.has(c.mainsnak?.datavalue?.value?.id)
      );
    if (!playsBasketball) continue;

    const born = entity.claims?.P569?.[0]?.mainsnak?.datavalue?.value;
    if (!born || born.precision < 11) continue; // 11 = day precision; reject year-only
    const iso = born.time.replace(/^\+/, "").slice(0, 10);
    const year = Number(iso.slice(0, 4));
    if (year < minYear || year > maxYear) continue; // wrong person with a shared name

    return iso;
  }
  return null;
}

// Plausible birth-year window for a player in a given draft class: roughly
// 18-24 years old at draft time, widened to be safe.
export function birthYearWindow(draftYear) {
  return { minYear: draftYear - 25, maxYear: draftYear - 16 };
}

export async function resolveDob(player, draftYear, espnNbaId, log = () => {}) {
  if (espnNbaId) {
    try {
      const dob = await dobFromEspnNba(espnNbaId);
      if (dob) return { dob, source: "espn" };
    } catch (err) {
      log(`    espn dob failed for ${player.slug}: ${err.message}`);
    }
  }
  try {
    const dob = await dobFromWikidata(player.name, birthYearWindow(draftYear));
    if (dob) return { dob, source: "wikidata" };
  } catch (err) {
    log(`    wikidata dob failed for ${player.slug}: ${err.message}`);
  }
  return { dob: null, source: null };
}
