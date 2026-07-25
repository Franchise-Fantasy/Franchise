// ESPN public JSON API helpers (the same endpoints espn.com's frontend uses).
// Gentler pacing than the HTML scrapers since these are lightweight API calls.
const UA = "FranchiseFantasyBot/1.0 (weekly prospect stats; contact: noahgordon2021@outlook.com)";
const DELAY_MS = 800;

let lastFetch = 0;

async function fetchJson(url) {
  const wait = lastFetch + DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastFetch = Date.now();
  const res = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

const SITE = "https://site.api.espn.com/apis/site/v2/sports/basketball";
const WEB = "https://site.web.api.espn.com/apis/common/v3/sports/basketball";

export async function getRoster(league, teamSlug) {
  // league: "mens-college-basketball" | "nba"; teamSlug: "kansas" | "mem"
  const d = await fetchJson(`${SITE}/${league}/teams/${encodeURIComponent(teamSlug)}/roster`);
  return (d.athletes || []).map((a) => ({ id: String(a.id), name: a.displayName }));
}

// Per-game log for the athlete's most recent season. Works for
// mens-college-basketball year-round and for nba once the season starts.
export async function getGamelog(league, athleteId) {
  const d = await fetchJson(`${WEB}/${league}/athletes/${athleteId}/gamelog`);
  const labels = d.labels || [];
  const meta = d.events || {};
  const rows = [];
  for (const st of d.seasonTypes || []) {
    for (const cat of st.categories || []) {
      for (const ev of cat.events || []) {
        const m = meta[ev.eventId];
        if (!m) continue;
        rows.push({
          date: (m.gameDate || "").slice(0, 10),
          opponent: m.opponent?.abbreviation ?? null,
          ...statsFromLabels(labels, ev.stats || []),
        });
      }
    }
  }
  rows.sort((a, b) => b.date.localeCompare(a.date));
  return rows;
}

// Las Vegas Summer League (all 30 teams). Scans the July scoreboard and
// returns every player's box lines, keyed by ESPN NBA athlete id.
export async function getSummerLeagueLines(year, log = () => {}) {
  const league = "nba-summer-las-vegas";
  const byAthlete = new Map();
  for (let day = 1; day <= 31; day++) {
    const date = `${year}07${String(day).padStart(2, "0")}`;
    let events = [];
    try {
      const sb = await fetchJson(`${SITE}/${league}/scoreboard?dates=${date}`);
      events = sb.events || [];
    } catch {
      continue; // a bad day never kills the scan
    }
    for (const ev of events) {
      try {
        const sum = await fetchJson(`${SITE}/${league}/summary?event=${ev.id}`);
        const comp = sum.header?.competitions?.[0];
        const gameDate = (comp?.date || "").slice(0, 10);
        const teams = sum.boxscore?.players || [];
        for (const t of teams) {
          const opponent =
            comp?.competitors?.find((c) => c.team?.abbreviation !== t.team?.abbreviation)
              ?.team?.abbreviation ?? null;
          const stats = t.statistics?.[0];
          if (!stats) continue;
          for (const a of stats.athletes || []) {
            const id = String(a.athlete?.id ?? "");
            if (!id || !a.stats?.length) continue;
            if (!byAthlete.has(id)) byAthlete.set(id, []);
            byAthlete.get(id).push({
              date: gameDate,
              opponent,
              ...statsFromLabels(stats.labels || [], a.stats),
            });
          }
        }
      } catch (err) {
        log(`  summer league: skipped event ${ev.id} (${err.message})`);
      }
    }
  }
  for (const games of byAthlete.values()) games.sort((a, b) => b.date.localeCompare(a.date));
  return byAthlete;
}

// Normalize a stat row from ESPN's parallel labels/values arrays.
function statsFromLabels(labels, values) {
  const get = (label) => {
    const i = labels.indexOf(label);
    return i === -1 ? null : values[i];
  };
  const num = (label) => {
    const v = get(label);
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  return {
    minutes: num("MIN"),
    points: num("PTS"),
    rebounds: num("REB"),
    assists: num("AST"),
    steals: num("STL"),
    blocks: num("BLK"),
    turnovers: num("TO"),
    fg: get("FG"),
    fg3: get("3PT"),
    ft: get("FT"),
  };
}
