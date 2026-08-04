import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bdlFetchAll, coerceBdlPosition, type Sport } from '../_shared/bdl.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { recordHeartbeat } from '../_shared/heartbeat.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { normalizeName } from '../_shared/normalize.ts';
import { nflDraftYearFromExperience, nflReferenceSeason } from '../../../utils/sports/nflExperience.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

// Must match POSITION_SPECTRUM in utils/rosterSlots.ts
const POSITION_SPECTRUM = ['PG', 'SG', 'SF', 'PF', 'C'];

// Must match CURRENT_*_SEASON in constants/LeagueDefaults.ts.
// NBA uses dash format ("2025-26"), WNBA/NFL use single-year format ("2026").
const CURRENT_SEASON: Record<Sport, string> = {
  nba: '2026-27',
  wnba: '2026',
  nfl: '2026',
};

// Basketball-only enrichment (NFL has no Stats-host equivalent and is
// filtered out before these are reached).
type BasketballSport = Exclude<Sport, 'nfl'>;

// stats.nba.com / stats.wnba.com share the same response shape; only the host
// and LeagueID differ (00 = NBA, 10 = WNBA). The IDs they return populate
// `players.external_id_nba`, which is what cdn.{nba,wnba}.com headshots key on.
const STATS_HOSTS: Record<BasketballSport, { host: string; leagueId: string; origin: string; referer: string }> = {
  nba:  { host: 'stats.nba.com',  leagueId: '00', origin: 'https://www.nba.com',  referer: 'https://www.nba.com/' },
  wnba: { host: 'stats.wnba.com', leagueId: '10', origin: 'https://www.wnba.com', referer: 'https://www.wnba.com/' },
};

function buildStatsUrl(sport: BasketballSport, season: string): string {
  const { host, leagueId } = STATS_HOSTS[sport];
  return `https://${host}/stats/commonallplayers?LeagueID=${leagueId}&Season=${season}&IsOnlyCurrentSeason=1`;
}

function buildStatsHeaders(sport: BasketballSport): Record<string, string> {
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

/**
 * Fetch personId lookup maps for headshot URL construction.
 *
 *  - NBA → stats.nba.com `commonallplayers`. IDs key cdn.nba.com headshots.
 *  - WNBA → ESPN's per-team roster endpoint (stats.wnba.com works from
 *    browsers but stalls indefinitely from cloud IPs). IDs key
 *    a.espncdn.com WNBA headshots.
 */
interface StatsLookup {
  byNameTeam: Map<string, number>;
  byName: Map<string, number>;
  /** ESPN-only — birthdate (YYYY-MM-DD) keyed the same way the IDs are. */
  birthdateByNameTeam?: Map<string, string>;
  birthdateByName?: Map<string, string>;
  /** ESPN-only — draft year derived from `experience.years`, keyed the same. */
  draftYearByNameTeam?: Map<string, number>;
  draftYearByName?: Map<string, number>;
}

async function fetchStatsIds(sport: BasketballSport, season: string): Promise<StatsLookup> {
  if (sport === 'wnba') return fetchEspnWnbaAthletes(season);
  return fetchNbaStatsIds(season);
}

async function fetchNbaStatsIds(season: string): Promise<StatsLookup> {
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

async function fetchEspnWnbaAthletes(season: string): Promise<StatsLookup> {
  const byNameTeam = new Map<string, number>();
  const byName = new Map<string, number>();
  const birthdateByNameTeam = new Map<string, string>();
  const birthdateByName = new Map<string, string>();
  const draftYearByNameTeam = new Map<string, number>();
  const draftYearByName = new Map<string, number>();

  // WNBA season is a single calendar year ("2026"). ESPN reports completed
  // pro seasons in `experience.years` (0 for a not-yet-played rookie), so
  // draft_year = seasonYear - experience.years. Accurate for recent draftees
  // (all that taxi-squad rookie eligibility cares about); veterans with
  // gap-year careers can drift a year, which doesn't affect eligibility.
  const seasonYear = parseInt(season, 10);

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

        // ESPN's dateOfBirth is ISO ("1998-04-15T07:00Z") — slice to YYYY-MM-DD.
        const dob = typeof a.dateOfBirth === 'string' ? a.dateOfBirth.slice(0, 10) : null;
        if (dob && /^\d{4}-\d{2}-\d{2}$/.test(dob)) {
          if (tricode) birthdateByNameTeam.set(`${norm}|${tricode}`, dob);
          birthdateByName.set(norm, dob);
        }

        const expYears = a.experience?.years;
        if (Number.isInteger(seasonYear) && Number.isInteger(expYears) && expYears >= 0) {
          const draftYear = seasonYear - expYears;
          if (tricode) draftYearByNameTeam.set(`${norm}|${tricode}`, draftYear);
          draftYearByName.set(norm, draftYear);
        }
      }
    }),
  );

  return {
    byNameTeam,
    byName,
    birthdateByNameTeam,
    birthdateByName,
    draftYearByNameTeam,
    draftYearByName,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Cron-only: check CRON_SECRET
  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  // Sport from request body. Defaults to 'nba' so legacy cron entries keep working.
  let sport: Sport = 'nba';
  try {
    const body = await req.json();
    if (body?.sport === 'wnba' || body?.sport === 'nfl') sport = body.sport;
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
      draft_year: number | null;
      draft_round: number | null;
      draft_number: number | null;
    }> = [];

    for (const bp of bdlPlayers) {
      const team = bp.team?.abbreviation;
      if (!team) continue;

      const name = `${bp.first_name ?? ''} ${bp.last_name ?? ''}`.trim();
      if (!name) continue;

      // NFL: the token lives in position_abbreviation (position is the full
      // word, e.g. "Quarterback"); basketball keys off position.
      const rawPosition = sport === 'nfl' ? bp.position_abbreviation : bp.position;
      const coercedPosition = coerceBdlPosition(rawPosition, sport);

      // NFL pool is offense + K only — coerceBdlPosition returns null for
      // OL/IDP/punters/UNK, and those players are dropped entirely (no IDP
      // formats in v1; also keeps BDL's offensive-line "G"/"C" tokens out of
      // the basketball position namespace).
      if (sport === 'nfl' && !coercedPosition) continue;

      // Drives taxi-squad rookie eligibility. BDL's draft_year is a plain
      // calendar year (e.g. 2018) for basketball, or null for undrafted/unknown.
      // The NFL feed has no draft_year field at all, but its `experience` string
      // ("10th Season") inverts to one — see utils/sports/nflExperience.ts for
      // the mapping and for why "1st Season" is discarded rather than trusted.
      const draftYear =
        sport === 'nfl'
          ? nflDraftYearFromExperience(bp.experience, nflReferenceSeason(new Date()))
          : typeof bp.draft_year === 'number' && bp.draft_year > 1900
            ? bp.draft_year
            : null;

      // Draft slot feeds the rookie slot-prior projections (rookie_priors.py).
      // NBA-only in practice: BDL's WNBA player objects carry no draft fields
      // and NFL has none either, so both fall through to null.
      const draftRound =
        typeof bp.draft_round === 'number' && bp.draft_round >= 1 && bp.draft_round <= 10
          ? bp.draft_round
          : null;
      const draftNumber =
        typeof bp.draft_number === 'number' && bp.draft_number >= 1 && bp.draft_number <= 300
          ? bp.draft_number
          : null;

      activePlayers.push({
        bdl_id: bp.id,
        name,
        normName: normalizeName(name),
        pro_team: team,
        bdl_position: coercedPosition,
        draft_year: draftYear,
        draft_round: draftRound,
        draft_number: draftNumber,
      });
    }

    // 3. Enrichment — runs in parallel, each can fail independently.
    //    - League Stats personId (for cdn.{nba,wnba}.com headshots): basketball
    //      only. NFL has no enrichment source (no headshots in v1); BDL
    //      position/team data is used as-is. NBA granular positions come from
    //      Sleeper via backend/sync_positions.py (daily Action step) — here
    //      BDL's coarse tokens only seed inserts and backfill nulls.
    //    - WNBA additionally pulls birthdates from the same ESPN endpoint.
    let statsIds: StatsLookup | null = null;

    const enrichmentTasks: Array<Promise<unknown>> = [];
    const statsIdx = sport !== 'nfl'
      ? enrichmentTasks.push(fetchStatsIds(sport, CURRENT_SEASON[sport])) - 1
      : -1;
    const enrichmentResults = await Promise.allSettled(enrichmentTasks);

    if (statsIdx >= 0) {
      const r = enrichmentResults[statsIdx];
      if (r.status === 'fulfilled') {
        statsIds = r.value as StatsLookup;
      } else {
        console.error(`${sport} Stats fetch failed:`, (r.reason as any)?.message ?? r.reason);
      }
    }

    const lookupNbaId = (norm: string, team: string): number | null => {
      if (!statsIds) return null;
      return statsIds.byNameTeam.get(`${norm}|${team}`) ?? statsIds.byName.get(norm) ?? null;
    };

    const lookupBirthdate = (norm: string, team: string): string | null => {
      if (!statsIds?.birthdateByNameTeam || !statsIds.birthdateByName) return null;
      return (
        statsIds.birthdateByNameTeam.get(`${norm}|${team}`)
        ?? statsIds.birthdateByName.get(norm)
        ?? null
      );
    };

    const lookupDraftYear = (norm: string, team: string): number | null => {
      if (!statsIds?.draftYearByNameTeam || !statsIds.draftYearByName) return null;
      return (
        statsIds.draftYearByNameTeam.get(`${norm}|${team}`)
        ?? statsIds.draftYearByName.get(norm)
        ?? null
      );
    };

    // 4. Fetch our existing players, scoped to this sport (BDL ID namespaces
    // are separate per sport, so cross-sport name collisions don't matter).
    // Paginate: the NFL pool is >1000 rows and PostgREST silently caps a single
    // select at 1000, so a plain query drops the tail. Those players then look
    // absent, get classified as new in 5a, and the 6. insert dies on the
    // (sport, external_id_bdl) unique constraint — taking the whole sync with
    // it. Same hazard, same fix as import-sleeper-league's player fetch.
    const existing: Array<{
      id: string;
      name: string;
      position: string | null;
      pro_team: string | null;
      external_id_bdl: number | null;
      external_id_nba: number | null;
      birthdate: string | null;
      draft_year: number | null;
      draft_number: number | null;
    }> = [];
    const PLAYER_PAGE = 1000;
    for (let from = 0; ; from += PLAYER_PAGE) {
      const { data, error: fetchErr } = await supabase
        .from('players')
        .select('id, name, position, pro_team, external_id_bdl, external_id_nba, birthdate, draft_year, draft_number')
        .eq('sport', sport)
        .order('id')
        .range(from, from + PLAYER_PAGE - 1);
      if (fetchErr) throw new Error(`Failed to fetch players: ${fetchErr.message}`);
      if (!data || data.length === 0) break;
      existing.push(...(data as typeof existing));
      if (data.length < PLAYER_PAGE) break;
    }

    type ExistingRec = {
      id: string;
      pro_team: string | null;
      position: string | null;
      external_id_bdl: number | null;
      external_id_nba: number | null;
      birthdate: string | null;
      draft_year: number | null;
      draft_number: number | null;
    };

    const existingByBdlId = new Map<number, ExistingRec>();
    const existingByName = new Map<string, ExistingRec>();

    for (const p of existing) {
      const rec: ExistingRec = {
        id: p.id,
        pro_team: p.pro_team,
        position: p.position,
        external_id_bdl: p.external_id_bdl,
        external_id_nba: p.external_id_nba ? Number(p.external_id_nba) : null,
        birthdate: (p as { birthdate?: string | null }).birthdate ?? null,
        draft_year: (p as { draft_year?: number | null }).draft_year ?? null,
        draft_number: (p as { draft_number?: number | null }).draft_number ?? null,
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
      birthdate?: string;
      draft_year?: number;
      draft_round?: number;
      draft_number?: number;
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
      // Position sync is per-sport. WNBA/NFL: BDL is the authority — re-sync
      // whenever the derived value differs. NBA: BDL's feed is coarse-only
      // ("G"/"F"/"C" — zero granular tokens as of 2026-08), while Sleeper
      // (backend/sync_positions.py, daily Action step) owns granular NBA
      // positions — so BDL only BACKFILLS a null NBA position and never
      // overwrites. The old always-overwrite rule here replaced Sleeper's
      // "PG" with a coerced "SG" every night until the pool had 2 PGs.
      const derivedPosition = bp.bdl_position;
      const positionStale = sport === 'nba'
        ? !match.position
        : derivedPosition !== match.position;
      if (derivedPosition && positionStale) {
        update.position = derivedPosition;
        hasChange = true;
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
      // Back-fill birthdate from ESPN (WNBA only — NBA was seeded once
      // from a separate one-shot script).
      if (!match.birthdate) {
        const dob = lookupBirthdate(bp.normName, bp.pro_team);
        if (dob) {
          update.birthdate = dob;
          hasChange = true;
        }
      }
      // Back-fill draft_year when currently NULL (drives taxi-squad rookie
      // eligibility). NBA gets it from BDL; WNBA from ESPN experience (BDL's
      // WNBA feed omits draft_year).
      const derivedDraftYear = bp.draft_year ?? lookupDraftYear(bp.normName, bp.pro_team);
      if (!match.draft_year && derivedDraftYear) {
        update.draft_year = derivedDraftYear;
        hasChange = true;
      }
      // Back-fill draft slot when currently NULL (rookie slot-prior
      // projections). Never overwrites a non-null slot — a draft pick is
      // immutable history, and the seeder is the authoritative first pass.
      if (match.draft_number == null && bp.draft_number != null) {
        update.draft_number = bp.draft_number;
        if (bp.draft_round != null) update.draft_round = bp.draft_round;
        hasChange = true;
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
        // Insert-time position comes from BDL for all sports (coarse for
        // basketball — the daily Sleeper sync refines NBA rows within a day).
        const pos = p.bdl_position;
        if (pos) row.position = pos;
        const nbaId = lookupNbaId(p.normName, p.pro_team);
        if (nbaId) row.external_id_nba = nbaId;
        const dob = lookupBirthdate(p.normName, p.pro_team);
        if (dob) row.birthdate = dob;
        const draftYear = p.draft_year ?? lookupDraftYear(p.normName, p.pro_team);
        if (draftYear) row.draft_year = draftYear;
        if (p.draft_number != null) {
          row.draft_number = p.draft_number;
          if (p.draft_round != null) row.draft_round = p.draft_round;
        }
        return row;
      });
      // sport-scope: toInsert rows carry sport explicitly (built above)
      const { error: insertErr } = await supabase.from('players').insert(toInsert);
      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
      newlyInserted = newPlayers.length;
    }

    // 7. Apply updates (batched in chunks of 50)
    let updated = 0;
    let positionsBackfilled = 0;
    let nbaIdsBackfilled = 0;
    let birthdatesBackfilled = 0;
    let draftYearsBackfilled = 0;
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
        if (u.birthdate !== undefined) {
          patch.birthdate = u.birthdate;
          birthdatesBackfilled++;
        }
        if (u.draft_year !== undefined) {
          patch.draft_year = u.draft_year;
          draftYearsBackfilled++;
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

    // 8b. NFL only: ensure the 32 synthetic D/ST "players" exist — one per
    // team, identity (sport='nfl', position='DST', pro_team). They have no
    // external_id_bdl (BDL has no defense entity), so the waived sweep above
    // can never touch them. Their stat rows are written by poll-live-stats
    // from BDL team_stats.
    let dstCreated = 0;
    if (sport === 'nfl') {
      const teamsResp = await bdlFetchAll(sport, '/teams');
      const { data: existingDst } = await supabase
        .from('players')
        .select('pro_team')
        .eq('sport', 'nfl')
        .eq('position', 'DST');
      const haveDst = new Set((existingDst ?? []).map((d) => d.pro_team));
      const dstRows = (teamsResp ?? [])
        .filter((t: any) => t?.abbreviation && t?.name && !haveDst.has(t.abbreviation))
        .map((t: any) => ({
          name: `${t.name} D/ST`,
          sport: 'nfl',
          position: 'DST',
          pro_team: t.abbreviation,
          status: 'active',
        }));
      if (dstRows.length > 0) {
        // sport-scope: every dstRow is built above with sport:'nfl' set explicitly
        const { error: dstErr } = await supabase.from('players').insert(dstRows);
        if (dstErr) throw new Error(`D/ST insert failed: ${dstErr.message}`);
        dstCreated = dstRows.length;
      }
    }

    // 9. Refresh materialized view so changes appear in stats queries
    const { error: refreshErr } = await supabase.rpc('refresh_player_season_stats');
    if (refreshErr) console.error('Mat view refresh error:', refreshErr.message);

    const sampleNames = newPlayers.slice(0, 15).map((p) => p.name);
    await recordHeartbeat(supabase, `sync-players:${sport}`, 'ok');
    return jsonResponse({
      ok: true,
      sport,
      bdl_active: activePlayers.length,
      already_in_db: existing.length,
      newly_inserted: newlyInserted,
      updated,
      positions_backfilled: positionsBackfilled,
      nba_ids_backfilled: nbaIdsBackfilled,
      birthdates_backfilled: birthdatesBackfilled,
      draft_years_backfilled: draftYearsBackfilled,
      waived_cleared: waivedCount,
      dst_created: dstCreated,
      nba_stats_ok: statsIds !== null,
      sample_new: sampleNames,
    });
  } catch (err: any) {
    await recordHeartbeat(supabase, `sync-players:${sport}`, 'error', err?.message ?? String(err));
    return handleError(err, 'sync-players');
  }
});
