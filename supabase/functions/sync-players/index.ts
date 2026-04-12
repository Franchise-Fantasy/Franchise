import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS } from '../_shared/cors.ts';
import { bdlFetchAll } from '../_shared/bdl.ts';
import { normalizeName } from '../_shared/normalize.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

// Must match POSITION_SPECTRUM in utils/rosterSlots.ts
const POSITION_SPECTRUM = ['PG', 'SG', 'SF', 'PF', 'C'];

// Must match CURRENT_NBA_SEASON in constants/LeagueDefaults.ts
const CURRENT_SEASON = '2025-26';

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nba';
const NBA_STATS_URL =
  `https://stats.nba.com/stats/commonallplayers?LeagueID=00&Season=${CURRENT_SEASON}&IsOnlyCurrentSeason=1`;

// NBA Stats blocks non-browser user agents
const NBA_STATS_HEADERS = {
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Origin': 'https://www.nba.com',
  'Referer': 'https://www.nba.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

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

/** Fetch NBA Stats active players and return external_id_nba lookup maps. */
async function fetchNbaStatsIds(): Promise<{
  byNameTeam: Map<string, number>;
  byName: Map<string, number>;
}> {
  const byNameTeam = new Map<string, number>();
  const byName = new Map<string, number>();

  const res = await fetch(NBA_STATS_URL, {
    headers: NBA_STATS_HEADERS,
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`NBA Stats returned ${res.status}`);
  const body = await res.json();
  const set = body?.resultSets?.[0];
  if (!set) throw new Error('NBA Stats response missing resultSets');

  const headers: string[] = set.headers;
  const rows: any[][] = set.rowSet ?? [];
  const idxId = headers.indexOf('PERSON_ID');
  const idxName = headers.indexOf('DISPLAY_FIRST_LAST');
  const idxTeam = headers.indexOf('TEAM_ABBREVIATION');
  if (idxId < 0 || idxName < 0) throw new Error('NBA Stats headers missing expected columns');

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

  try {
    // 1. Fetch active players from balldontlie
    const bdlPlayers = await bdlFetchAll('/players/active');

    // 2. Build list of active NBA players (those with a team)
    const activePlayers: Array<{
      bdl_id: number;
      name: string;
      normName: string;
      nba_team: string;
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
        nba_team: team,
      });
    }

    // 3. Fetch Sleeper (positions) and NBA Stats (headshot IDs) in parallel.
    // Either can fail independently — rest of sync still completes.
    const [sleeperResult, nbaStatsResult] = await Promise.allSettled([
      fetchSleeperPositions(),
      fetchNbaStatsIds(),
    ]);

    const sleeperPos = sleeperResult.status === 'fulfilled' ? sleeperResult.value : null;
    const nbaIds = nbaStatsResult.status === 'fulfilled' ? nbaStatsResult.value : null;

    if (sleeperResult.status === 'rejected') {
      console.error('Sleeper fetch failed:', sleeperResult.reason?.message ?? sleeperResult.reason);
    }
    if (nbaStatsResult.status === 'rejected') {
      console.error('NBA Stats fetch failed:', nbaStatsResult.reason?.message ?? nbaStatsResult.reason);
    }

    const lookupPosition = (norm: string, team: string): string | null => {
      if (!sleeperPos) return null;
      return sleeperPos.byNameTeam.get(`${norm}|${team}`) ?? sleeperPos.byName.get(norm) ?? null;
    };

    const lookupNbaId = (norm: string, team: string): number | null => {
      if (!nbaIds) return null;
      return nbaIds.byNameTeam.get(`${norm}|${team}`) ?? nbaIds.byName.get(norm) ?? null;
    };

    // 4. Fetch our existing players
    const { data: existing, error: fetchErr } = await supabase
      .from('players')
      .select('id, name, position, nba_team, external_id_bdl, external_id_nba');
    if (fetchErr) throw new Error(`Failed to fetch players: ${fetchErr.message}`);

    type ExistingRec = {
      id: string;
      nba_team: string | null;
      position: string | null;
      external_id_bdl: number | null;
      external_id_nba: number | null;
    };

    const existingByBdlId = new Map<number, ExistingRec>();
    const existingByName = new Map<string, ExistingRec>();

    for (const p of existing ?? []) {
      const rec: ExistingRec = {
        id: p.id,
        nba_team: p.nba_team,
        position: p.position,
        external_id_bdl: p.external_id_bdl,
        external_id_nba: p.external_id_nba,
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

    // 5b. Find existing players whose nba_team changed, plus backfill needs
    const bdlActiveIds = new Set<number>();
    const updates: Array<{
      id: string;
      nba_team?: string;
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

      if (match.nba_team !== bp.nba_team) {
        update.nba_team = bp.nba_team;
        hasChange = true;
      }
      // Back-fill bdl_id if matched by name only
      if (!existingByBdlId.has(bp.bdl_id) && !match.external_id_bdl) {
        update.external_id_bdl = bp.bdl_id;
        hasChange = true;
      }
      // Back-fill position if currently NULL
      if (!match.position) {
        const pos = lookupPosition(bp.normName, bp.nba_team);
        if (pos) {
          update.position = pos;
          hasChange = true;
        }
      }
      // Back-fill external_id_nba if currently NULL
      if (!match.external_id_nba) {
        const nbaId = lookupNbaId(bp.normName, bp.nba_team);
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
      if (!bdlActiveIds.has(bdlId) && rec.nba_team !== null) {
        waivedIds.push(rec.id);
      }
    }

    // 6. Insert new players — populate position + external_id_nba when lookups hit
    let newlyInserted = 0;
    if (newPlayers.length > 0) {
      const toInsert = newPlayers.map((p) => {
        const row: Record<string, any> = {
          name: p.name,
          nba_team: p.nba_team,
          status: 'active',
          external_id_bdl: p.bdl_id,
        };
        const pos = lookupPosition(p.normName, p.nba_team);
        if (pos) row.position = pos;
        const nbaId = lookupNbaId(p.normName, p.nba_team);
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
        if (u.nba_team !== undefined) patch.nba_team = u.nba_team;
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

    // 8. Clear nba_team for waived/released players
    let waivedCount = 0;
    if (waivedIds.length > 0) {
      const { error: waivedErr } = await supabase
        .from('players')
        .update({ nba_team: null })
        .in('id', waivedIds);
      if (waivedErr) console.error('Waived update error:', waivedErr.message);
      else waivedCount = waivedIds.length;
    }

    // 9. Refresh materialized view so changes appear in stats queries
    const { error: refreshErr } = await supabase.rpc('refresh_player_season_stats');
    if (refreshErr) console.error('Mat view refresh error:', refreshErr.message);

    const sampleNames = newPlayers.slice(0, 15).map((p) => p.name);
    return new Response(
      JSON.stringify({
        ok: true,
        bdl_active: activePlayers.length,
        already_in_db: (existing ?? []).length,
        newly_inserted: newlyInserted,
        updated,
        positions_backfilled: positionsBackfilled,
        nba_ids_backfilled: nbaIdsBackfilled,
        waived_cleared: waivedCount,
        sleeper_ok: sleeperPos !== null,
        nba_stats_ok: nbaIds !== null,
        sample_new: sampleNames,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err: any) {
    console.error('sync-players error:', err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
