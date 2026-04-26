import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS } from '../_shared/cors.ts';
import { bdlFetchAll, coerceBdlPosition, type Sport } from '../_shared/bdl.ts';
import { recordHeartbeat } from '../_shared/heartbeat.ts';
import { normalizeName } from '../_shared/normalize.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

// Must match POSITION_SPECTRUM in utils/rosterSlots.ts
const POSITION_SPECTRUM = ['PG', 'SG', 'SF', 'PF', 'C'];

// Must match CURRENT_*_SEASON in constants/LeagueDefaults.ts.
// NBA uses dash format ("2025-26"), WNBA uses single-year format ("2026").
const CURRENT_SEASON: Record<Sport, string> = {
  nba: '2025-26',
  wnba: '2026',
};

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nba';

// stats.nba.com / stats.wnba.com share the same response shape; only the host
// and LeagueID differ (00 = NBA, 10 = WNBA). The IDs they return populate
// `players.external_id_nba`, which is what cdn.{nba,wnba}.com headshots key on.
const STATS_HOSTS: Record<Sport, { host: string; leagueId: string; origin: string; referer: string }> = {
  nba:  { host: 'stats.nba.com',  leagueId: '00', origin: 'https://www.nba.com',  referer: 'https://www.nba.com/' },
  wnba: { host: 'stats.wnba.com', leagueId: '10', origin: 'https://www.wnba.com', referer: 'https://www.wnba.com/' },
};

function buildStatsUrl(sport: Sport, season: string): string {
  const { host, leagueId } = STATS_HOSTS[sport];
  return `https://${host}/stats/commonallplayers?LeagueID=${leagueId}&Season=${season}&IsOnlyCurrentSeason=1`;
}

function buildStatsHeaders(sport: Sport): Record<string, string> {
  const { origin, referer } = STATS_HOSTS[sport];
  // stats.{nba,wnba}.com block non-browser user agents.
  return {
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9',
    'Origin': origin,
    'Referer': referer,
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'x-nba-stats-origin': 'stats',
    'x-nba-stats-token': 'true',
  };
}

/** Convert Sleeper fantasy_positions (e.g. ["PG","SG"]) to spectrum format ("PG-SG"). */
function buildPosition(fantasyPositions: string[] | null | undefined): string | null {
  if (!fantasyPositions || fantasyPositions.length === 0) return null;
  const valid = fantasyPositions.filter((p) => POSITION_SPECTRUM.includes(p));
  if (valid.length === 0) return null;
  const indices = valid.map((p) => POSITION_SPECTRUM.indexOf(p));
  const lo = Math.min(...indices);
  const hi = Math.max(...indices);
  if (lo === hi) return POSITION_SPECTRUM[lo];
  return `${POSITION_SPECTRUM[lo]}-${POSITION_SPECTRUM[hi]}`;
}

/** Fetch Sleeper NBA player database and return position lookup maps. */
async function fetchSleeperPositions(): Promise<{
  byNameTeam: Map<string, string>;
  byName: Map<string, string>;
}> {
  const byNameTeam = new Map<string, string>();
  const byName = new Map<string, string>();

  const res = await fetch(SLEEPER_PLAYERS_URL, { signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`Sleeper returned ${res.status}`);
  const sleeper = await res.json() as Record<string, any>;

  for (const sp of Object.values(sleeper)) {
    if (sp.sport !== 'nba' || !sp.active) continue;
    const fp: string[] | null =
      sp.fantasy_positions ?? (sp.position ? [sp.position] : null);
    const position = buildPosition(fp);
    if (!position) continue;
    const name = sp.full_name
      ?? `${sp.first_name ?? ''} ${sp.last_name ?? ''}`.trim();
    if (!name) continue;
    const norm = normalizeName(name);
    const team = (sp.team ?? '').toUpperCase();
    if (team) byNameTeam.set(`${norm}|${team}`, position);
    byName.set(norm, position);
  }

  return { byNameTeam, byName };
}

/**
 * Fetch personId lookup maps for headshot URL construction.
 *
 *  - NBA → stats.nba.com `commonallplayers`. IDs key cdn.nba.com headshots.
 *  - WNBA → ESPN's per-team roster endpoint (stats.wnba.com works from
 *    browsers but stalls indefinitely from cloud IPs). IDs key
 *    a.espncdn.com WNBA headshots.
 */
async function fetchStatsIds(sport: Sport, season: string): Promise<{
  byNameTeam: Map<string, number>;
  byName: Map<string, number>;
}> {
  if (sport === 'wnba') return fetchEspnWnbaAthletes();
  return fetchNbaStatsIds(season);
}

async function fetchNbaStatsIds(season: string): Promise<{
  byNameTeam: Map<string, number>;
  byName: Map<string, number>;
}> {
  const byNameTeam = new Map<string, number>();
  const byName = new Map<string, number>();

  const res = await fetch(buildStatsUrl('nba', season), {
    headers: buildStatsHeaders('nba'),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`nba Stats returned ${res.status}`);
  const body = await res.json();
  const set = body?.resultSets?.[0];
  if (!set) throw new Error('nba Stats response missing resultSets');

  const headers: string[] = set.headers;
  const rows: any[][] = set.rowSet ?? [];
  const idxId = headers.indexOf('PERSON_ID');
  const idxName = headers.indexOf('DISPLAY_FIRST_LAST');
  const idxTeam = headers.indexOf('TEAM_ABBREVIATION');
  if (idxId < 0 || idxName < 0) throw new Error('nba Stats headers missing expected columns');

  for (const row of rows) {
    const personId = Number(row[idxId]);
    const name = String(row[idxName] ?? '').trim();
    if (!personId || !name) continue;
    const norm = normalizeName(name);
    const team = String(row[idxTeam] ?? '').toUpperCase();
    if (team) byNameTeam.set(`${norm}|${team}`, personId);
    byName.set(norm, personId);
  }

  return { byNameTeam, byName };
}

const ESPN_WNBA_TEAMS_URL = 'https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams';
const ESPN_WNBA_ROSTER_URL = (teamId: string) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${teamId}/roster`;

async function fetchEspnWnbaAthletes(): Promise<{
  byNameTeam: Map<string, number>;
  byName: Map<string, number>;
}> {
  const byNameTeam = new Map<string, number>();
  const byName = new Map<string, number>();

  const teamsRes = await fetch(ESPN_WNBA_TEAMS_URL, { signal: AbortSignal.timeout(10000) });
  if (!teamsRes.ok) throw new Error(`ESPN WNBA teams returned ${teamsRes.status}`);
  const teamsBody = await teamsRes.json();
  const teams: any[] = teamsBody?.sports?.[0]?.leagues?.[0]?.teams ?? [];

  await Promise.allSettled(
    teams.map(async (t: any) => {
      const teamId: string | undefined = t?.team?.id;
      const tricode: string | undefined = t?.team?.abbreviation?.toUpperCase();
      if (!teamId) return;
      const rosterRes = await fetch(ESPN_WNBA_ROSTER_URL(teamId), { signal: AbortSignal.timeout(10000) });
      if (!rosterRes.ok) return;
      const rosterBody = await rosterRes.json();
      const athletes: any[] = rosterBody?.athletes ?? [];
      for (const a of athletes) {
        const id = parseInt(String(a.id), 10);
        const name = a.fullName ?? `${a.firstName ?? ''} ${a.lastName ?? ''}`.trim();
        if (!id || !name) continue;
        const norm = normalizeName(name);
        if (tricode) byNameTeam.set(`${norm}|${tricode}`, id);
        byName.set(norm, id);
      }
    }),
  );

  return { byNameTeam, byName };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Cron-only: check CRON_SECRET
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
  }

  // Sport from request body. Defaults to 'nba' so legacy cron entries keep working.
  let sport: Sport = 'nba';
  try {
    const body = await req.json();
    if (body?.sport === 'wnba') sport = 'wnba';
  } catch {
    // No body / not JSON — default sport stays 'nba'.
  }

  try {
    // 1. Fetch active players from balldontlie (sport-namespaced).
    const bdlPlayers = await bdlFetchAll(sport, '/players/active');

    // 2. Build list of active players (those with a team).
    const activePlayers: Array<{
      bdl_id: number;
      name: string;
      normName: string;
      pro_team: string;
      bdl_position: string | null;
    }> = [];

    for (const bp of bdlPlayers) {
      const team = bp.team?.abbreviation;
      if (!team) continue;

      const name = `${bp.first_name ?? ''} ${bp.last_name ?? ''}`.trim();
      if (!name) continue;

      activePlayers.push({
        bdl_id: bp.id,
        name,
        normName: normalizeName(name),
        pro_team: team,
        bdl_position: coerceBdlPosition(bp.position),
      });
    }

    // 3. Enrichment — runs in parallel, each can fail independently.
    //    - Sleeper position spectrum: NBA only (Sleeper has no WNBA support).
    //    - League Stats personId (for cdn.{nba,wnba}.com headshots): both sports.
    let sleeperPos: { byNameTeam: Map<string, string>; byName: Map<string, string> } | null = null;
    let statsIds: { byNameTeam: Map<string, number>; byName: Map<string, number> } | null = null;

    const enrichmentTasks: Array<Promise<unknown>> = [];
    const sleeperIdx = sport === 'nba' ? enrichmentTasks.push(fetchSleeperPositions()) - 1 : -1;
    const statsIdx = enrichmentTasks.push(fetchStatsIds(sport, CURRENT_SEASON[sport])) - 1;
    const enrichmentResults = await Promise.allSettled(enrichmentTasks);

    if (sleeperIdx >= 0) {
      const r = enrichmentResults[sleeperIdx];
      if (r.status === 'fulfilled') {
        sleeperPos = r.value as typeof sleeperPos;
      } else {
        console.error('Sleeper fetch failed:', (r.reason as any)?.message ?? r.reason);
      }
    }
    {
      const r = enrichmentResults[statsIdx];
      if (r.status === 'fulfilled') {
        statsIds = r.value as typeof statsIds;
      } else {
        console.error(`${sport} Stats fetch failed:`, (r.reason as any)?.message ?? r.reason);
      }
    }

    const lookupPosition = (norm: string, team: string): string | null => {
      if (!sleeperPos) return null;
      return sleeperPos.byNameTeam.get(`${norm}|${team}`) ?? sleeperPos.byName.get(norm) ?? null;
    };

    const lookupNbaId = (norm: string, team: string): number | null => {
      if (!statsIds) return null;
      return statsIds.byNameTeam.get(`${norm}|${team}`) ?? statsIds.byName.get(norm) ?? null;
    };

    // 4. Fetch our existing players, scoped to this sport (BDL ID namespaces
    // are separate per sport, so cross-sport name collisions don't matter).
    const { data: existing, error: fetchErr } = await supabase
      .from('players')
      .select('id, name, position, pro_team, external_id_bdl, external_id_nba')
      .eq('sport', sport);
    if (fetchErr) throw new Error(`Failed to fetch players: ${fetchErr.message}`);

    type ExistingRec = {
      id: string;
      pro_team: string | null;
      position: string | null;
      external_id_bdl: number | null;
      external_id_nba: number | null;
    };

    const existingByBdlId = new Map<number, ExistingRec>();
    const existingByName = new Map<string, ExistingRec>();

    for (const p of existing ?? []) {
      const rec: ExistingRec = {
        id: p.id,
        pro_team: p.pro_team,
        position: p.position,
        external_id_bdl: p.external_id_bdl,
        external_id_nba: p.external_id_nba ? Number(p.external_id_nba) : null,
      };
      if (p.external_id_bdl) existingByBdlId.set(Number(p.external_id_bdl), rec);
      existingByName.set(normalizeName(p.name), rec);
    }

    // 5a. Find new players not in our DB
    const newPlayers = activePlayers.filter((p) => {
      if (existingByBdlId.has(p.bdl_id)) return false;
      if (existingByName.has(p.normName)) return false;
      return true;
    });

    // 5b. Find existing players whose pro_team changed, plus backfill needs
    const bdlActiveIds = new Set<number>();
    const updates: Array<{
      id: string;
      pro_team?: string;
      external_id_bdl?: number;
      position?: string;
      external_id_nba?: number;
    }> = [];

    for (const bp of activePlayers) {
      bdlActiveIds.add(bp.bdl_id);

      const match = existingByBdlId.get(bp.bdl_id)
        ?? (existingByName.has(bp.normName) ? existingByName.get(bp.normName)! : null);
      if (!match) continue;

      const update: typeof updates[number] = { id: match.id };
      let hasChange = false;

      if (match.pro_team !== bp.pro_team) {
        update.pro_team = bp.pro_team;
        hasChange = true;
      }
      // Back-fill bdl_id if matched by name only
      if (!existingByBdlId.has(bp.bdl_id) && !match.external_id_bdl) {
        update.external_id_bdl = bp.bdl_id;
        hasChange = true;
      }
      // Back-fill position if currently NULL
      if (!match.position) {
        // Prefer Sleeper-derived spectrum (NBA only); fall back to BDL.
        const pos = lookupPosition(bp.normName, bp.pro_team) ?? bp.bdl_position;
        if (pos) {
          update.position = pos;
          hasChange = true;
        }
      }
      // Back-fill external_id_nba (the league's Stats personId) if currently NULL.
      // Used to build cdn.{nba,wnba}.com headshot URLs.
      if (!match.external_id_nba) {
        const nbaId = lookupNbaId(bp.normName, bp.pro_team);
        if (nbaId) {
          update.external_id_nba = nbaId;
          hasChange = true;
        }
      }

      if (hasChange) updates.push(update);
    }

    // 5c. Players in our DB with a bdl_id who are no longer in the active list → waived / released
    const waivedIds: string[] = [];
    for (const [bdlId, rec] of existingByBdlId) {
      if (!bdlActiveIds.has(bdlId) && rec.pro_team !== null) {
        waivedIds.push(rec.id);
      }
    }

    // 6. Insert new players — populate position + external_id_nba when lookups hit
    let newlyInserted = 0;
    if (newPlayers.length > 0) {
      const toInsert = newPlayers.map((p) => {
        const row: Record<string, any> = {
          name: p.name,
          sport,
          pro_team: p.pro_team,
          status: 'active',
          external_id_bdl: p.bdl_id,
        };
        // NBA: prefer Sleeper-derived spectrum, fall back to BDL.
        // WNBA: BDL is the only source.
        const pos = lookupPosition(p.normName, p.pro_team) ?? p.bdl_position;
        if (pos) row.position = pos;
        const nbaId = lookupNbaId(p.normName, p.pro_team);
        if (nbaId) row.external_id_nba = nbaId;
        return row;
      });
      const { error: insertErr } = await supabase.from('players').insert(toInsert);
      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
      newlyInserted = newPlayers.length;
    }

    // 7. Apply updates (batched in chunks of 50)
    let updated = 0;
    let positionsBackfilled = 0;
    let nbaIdsBackfilled = 0;
    for (let i = 0; i < updates.length; i += 50) {
      const chunk = updates.slice(i, i + 50);
      await Promise.all(chunk.map((u) => {
        const patch: Record<string, any> = {};
        if (u.pro_team !== undefined) patch.pro_team = u.pro_team;
        if (u.external_id_bdl !== undefined) patch.external_id_bdl = u.external_id_bdl;
        if (u.position !== undefined) {
          patch.position = u.position;
          positionsBackfilled++;
        }
        if (u.external_id_nba !== undefined) {
          patch.external_id_nba = u.external_id_nba;
          nbaIdsBackfilled++;
        }
        return supabase.from('players').update(patch).eq('id', u.id);
      }));
      updated += chunk.length;
    }

    // 8. Clear pro_team for waived/released players
    let waivedCount = 0;
    if (waivedIds.length > 0) {
      const { error: waivedErr } = await supabase
        .from('players')
        .update({ pro_team: null })
        .in('id', waivedIds);
      if (waivedErr) console.error('Waived update error:', waivedErr.message);
      else waivedCount = waivedIds.length;
    }

    // 9. Refresh materialized view so changes appear in stats queries
    const { error: refreshErr } = await supabase.rpc('refresh_player_season_stats');
    if (refreshErr) console.error('Mat view refresh error:', refreshErr.message);

    const sampleNames = newPlayers.slice(0, 15).map((p) => p.name);
    await recordHeartbeat(supabase, `sync-players:${sport}`, 'ok');
    return new Response(
      JSON.stringify({
        ok: true,
        sport,
        bdl_active: activePlayers.length,
        already_in_db: (existing ?? []).length,
        newly_inserted: newlyInserted,
        updated,
        positions_backfilled: positionsBackfilled,
        nba_ids_backfilled: nbaIdsBackfilled,
        waived_cleared: waivedCount,
        sleeper_ok: sleeperPos !== null,
        nba_stats_ok: statsIds !== null,
        sample_new: sampleNames,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err: any) {
    console.error('sync-players error:', err?.message ?? err);
    await recordHeartbeat(supabase, `sync-players:${sport}`, 'error', err?.message ?? String(err));
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
