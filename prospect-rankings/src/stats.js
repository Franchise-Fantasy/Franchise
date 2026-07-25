import { createClient } from "@supabase/supabase-js";
import { getRoster, getGamelog, getSummerLeagueLines } from "./lib/espn.js";
import { slugify } from "./lib/names.js";

const GAMES_TO_KEEP = 3;

// Ranking sites use standard NBA abbreviations; ESPN's roster URLs use their
// own slugs for a handful of teams.
const ESPN_TEAM_SLUGS = {
  was: "wsh",
  uta: "utah",
  gsw: "gs",
  sas: "sa",
  nyk: "ny",
  nop: "no",
  pho: "phx",
};

// Lenient name match: "mikel-brown" should hit ESPN's "Mikel Brown Jr."
function namesMatch(slugA, slugB) {
  return slugA === slugB || slugA.startsWith(slugB) || slugB.startsWith(slugA);
}

function findOnRoster(roster, playerSlug) {
  return roster.find((a) => namesMatch(slugify(a.name), playerSlug)) ?? null;
}

// Resolve ESPN athlete ids and fetch each player's most recent games.
// Pure of Supabase so it can be tested standalone; returns
// { ids: Map<slug,{college_id,nba_id}>, games: [{player_slug, competition, ...}] }.
export async function collectRecentGames(players, knownIds = new Map(), log = console.log) {
  const ids = new Map(knownIds);
  const games = [];

  // --- resolve college ids via school rosters (one fetch per school) ---
  const bySchool = new Map();
  for (const p of players) {
    if (!p.school || ids.get(p.slug)?.college_id || p.team) continue;
    const school = slugify(p.school);
    if (!bySchool.has(school)) bySchool.set(school, []);
    bySchool.get(school).push(p);
  }
  for (const [school, schoolPlayers] of bySchool) {
    let roster;
    try {
      roster = await getRoster("mens-college-basketball", school);
    } catch {
      log(`  stats: no ESPN roster for "${school}" (international or unrecognized) — skipping`);
      continue;
    }
    for (const p of schoolPlayers) {
      const hit = findOnRoster(roster, p.slug);
      if (hit) ids.set(p.slug, { ...ids.get(p.slug), college_id: hit.id });
    }
  }

  // --- resolve NBA ids via team rosters (drafted class, actual team) ---
  const byTeam = new Map();
  for (const p of players) {
    if (!p.team || ids.get(p.slug)?.nba_id) continue;
    const raw = p.team.toLowerCase();
    const team = ESPN_TEAM_SLUGS[raw] ?? raw;
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(p);
  }
  for (const [team, teamPlayers] of byTeam) {
    let roster;
    try {
      roster = await getRoster("nba", team);
    } catch {
      log(`  stats: no ESPN roster for NBA team "${team}" — skipping`);
      continue;
    }
    for (const p of teamPlayers) {
      const hit = findOnRoster(roster, p.slug);
      if (hit) ids.set(p.slug, { ...ids.get(p.slug), nba_id: hit.id });
    }
  }

  // --- summer league (July/August only): one scoreboard scan serves everyone ---
  const now = new Date();
  const month = now.getUTCMonth() + 1;
  if (month === 7 || month === 8) {
    log("  stats: scanning Las Vegas Summer League box scores...");
    const slLines = await getSummerLeagueLines(now.getUTCFullYear(), log);
    for (const p of players) {
      const nbaId = ids.get(p.slug)?.nba_id;
      const lines = nbaId && slLines.get(nbaId);
      if (!lines) continue;
      for (const g of lines.slice(0, GAMES_TO_KEEP)) {
        games.push({ player_slug: p.slug, competition: "summer-league", ...g });
      }
    }
  }

  // --- college gamelogs (in season) + NBA gamelogs (once season starts) ---
  for (const p of players) {
    const rec = ids.get(p.slug);
    if (!rec) continue;
    for (const [league, athleteId, competition] of [
      ["mens-college-basketball", rec.college_id, "college"],
      ["nba", rec.nba_id, "nba"],
    ]) {
      if (!athleteId) continue;
      try {
        const rows = await getGamelog(league, athleteId);
        for (const g of rows.slice(0, GAMES_TO_KEEP)) {
          games.push({ player_slug: p.slug, competition, ...g });
        }
      } catch (err) {
        log(`  stats: gamelog failed for ${p.slug} (${league}): ${err.message}`);
      }
    }
  }

  return { ids, games };
}

// Weekly-job entry point: reads known id mappings, collects games, upserts both.
export async function syncStats(boards) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const players = boards.flatMap((b) => b.players);

  const { data: idRows, error: idErr } = await supabase.from("player_ids").select("*");
  if (idErr) throw new Error(`player_ids read: ${idErr.message}`);
  const known = new Map(
    (idRows ?? []).map((r) => [
      r.player_slug,
      { college_id: r.espn_college_id ?? undefined, nba_id: r.espn_nba_id ?? undefined },
    ])
  );

  const { ids, games } = await collectRecentGames(players, known);

  const idUpserts = [...ids.entries()].map(([slug, r]) => ({
    player_slug: slug,
    espn_college_id: r.college_id ?? null,
    espn_nba_id: r.nba_id ?? null,
  }));
  if (idUpserts.length) {
    const { error } = await supabase.from("player_ids").upsert(idUpserts);
    if (error) throw new Error(`player_ids upsert: ${error.message}`);
  }

  const gameRows = games.map((g) => ({
    player_slug: g.player_slug,
    competition: g.competition,
    game_date: g.date,
    opponent: g.opponent,
    minutes: g.minutes,
    points: g.points,
    rebounds: g.rebounds,
    assists: g.assists,
    steals: g.steals,
    blocks: g.blocks,
    turnovers: g.turnovers,
    fg: g.fg,
    fg3: g.fg3,
    ft: g.ft,
  }));
  if (gameRows.length) {
    const { error } = await supabase
      .from("recent_games")
      .upsert(gameRows, { onConflict: "player_slug,competition,game_date" });
    if (error) throw new Error(`recent_games upsert: ${error.message}`);
  }

  console.log(
    `  Stats: ${idUpserts.length} players mapped, ${gameRows.length} game lines synced`
  );
}
