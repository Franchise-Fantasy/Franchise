import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { bdlFetch, bdlFetchAll, type Sport } from '../_shared/bdl.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { recordHeartbeat } from '../_shared/heartbeat.ts';
import { handleError, jsonResponse, errorResponse } from '../_shared/http.ts';
import { describeInjuryTransition } from '../_shared/injuryStatus.ts';
import { normalizeName } from '../_shared/normalize.ts';
import { notifyTeamsBulk, type BulkTeamsNotification } from '../_shared/push.ts';
import { parseBody, z } from '../_shared/validate.ts';

const INJURY_STATUSES = ['OUT', 'SUSP', 'DOUBT', 'QUES', 'PROB', 'active'] as const;

const Body = z.object({
  sport: z.enum(['nba', 'wnba', 'nfl']).optional(),
  injuries: z.array(z.object({
    player_name: z.string().min(1),
    status: z.enum(INJURY_STATUSES, {
      errorMap: (issue, ctx) =>
        ({ message: `Invalid status '${ctx.data}'. Valid: ${INJURY_STATUSES.join(', ')}` }),
    }),
    bdl_id: z.number().int().optional(),
  })).optional(),
  teams_on_report: z.array(z.string()).optional(),
});

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SB_SECRET_KEY")!,
);

const VALID_STATUSES = new Set(['OUT', 'SUSP', 'DOUBT', 'QUES', 'PROB', 'active']);

// Game-day designations the manual (per-team PDF) path is allowed to reset.
// The manual path only sees one team's report, so it must stay conservative
// and not touch long-term OUT/SUSP statuses set elsewhere.
const GAME_DAY_STATUSES = new Set(['QUES', 'DOUBT', 'PROB']);

// The balldontlie path consumes BDL's league-wide /player_injuries master
// list — any player not in it is healthy, so every injury status is safe to
// auto-reset on absence. (Recovered players just disappear from the report;
// BDL doesn't republish them as "active", so OUT/SUSP would otherwise be
// stranded until a manual fix.)
const ALL_INJURY_STATUSES = new Set(['QUES', 'DOUBT', 'PROB', 'OUT', 'SUSP']);

const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

// Max players named in one push before it collapses to "+N more". A BDL run
// after a long gap can clear a pile of players at once, and each transition line
// carries a second "Next Game" line — uncapped, a single push could run to
// hundreds of characters.
const MAX_NOTIF_PLAYERS = 3;

/** Map BDL injury status strings to app status codes.
 *  NFL designations (Injured Reserve / PUP / NFI) map to OUT — a player on
 *  those lists can't play until activated, at which point BDL drops them
 *  from the report and the absence-reset returns them to 'active'. */
const BDL_STATUS_MAP: Record<string, string> = {
  'out': 'OUT', 'out for season': 'OUT',
  'suspended': 'SUSP', 'doubtful': 'DOUBT',
  'day-to-day': 'QUES', 'questionable': 'QUES', 'probable': 'PROB',
  'injured reserve': 'OUT', 'ir': 'OUT',
  'physically unable to perform': 'OUT', 'pup': 'OUT',
  'non football injury': 'OUT', 'nfi': 'OUT',
  'suspension': 'SUSP',
};

/**
 * BDL's WNBA `/player_injuries` returns mostly "Day-To-Day" for `status` even
 * for season-ending injuries, but the `comment` field has the real prose
 * ("Out for the season after ACL surgery", etc.). We always look at the
 * comment too — if it explicitly mentions "out for season", "out indefinitely",
 * "season-ending", etc., upgrade the severity beyond what `status` says.
 *
 * NBA's `status` strings are accurate ("Out", "Out For Season"), so the
 * comment escalation is a no-op there.
 */
function mapBdlStatus(bdlStatus: string, comment?: string): string {
  const lowerComment = (comment ?? '').toLowerCase();

  // Comment-based escalation: anything signalling long-term absence beats
  // BDL's blanket "Day-To-Day" tag.
  if (
    /out for (the )?season|season[- ]ending|out indefinitely|torn (acl|achilles|meniscus|labrum|rotator|patella|ucl)|surgery/i
      .test(lowerComment)
  ) {
    return 'OUT';
  }
  if (lowerComment.includes('suspended')) return 'SUSP';
  if (lowerComment.includes('doubtful')) return 'DOUBT';
  if (lowerComment.includes('probable')) return 'PROB';

  const mapped = BDL_STATUS_MAP[bdlStatus.toLowerCase()];
  if (mapped) return mapped;

  // Fallback: scan comment for direct status keywords if status itself was unknown.
  if (lowerComment) {
    for (const [key, val] of Object.entries(BDL_STATUS_MAP)) {
      if (lowerComment.includes(key)) return val;
    }
  }
  // Default: BDL said something we don't recognize and comment was empty.
  return 'QUES';
}

async function fetchInjuriesFromBdl(sport: Sport): Promise<{
  injuries: Array<{ bdl_id: number; player_name: string; status: string }>;
  teamsOnReport: string[];
  rawSamples: Array<{ name: string; status: string; description: string; mapped: string }>;
} | null> {
  try {
    // BDL injury endpoint only returns team_id (numeric), so look up abbreviations
    const [bdlInjuries, bdlTeams] = await Promise.all([
      bdlFetchAll(sport, '/player_injuries'),
      bdlFetch(sport, '/teams').then((d: any) => d.data ?? []),
    ]);
    if (!bdlInjuries || bdlInjuries.length === 0) return null;
    const rawSamples: Array<{ name: string; status: string; description: string; mapped: string }> = [];

    const teamIdToAbbr = new Map<number, string>(
      bdlTeams.map((t: any) => [t.id, t.abbreviation]),
    );

    const injuries: Array<{ bdl_id: number; player_name: string; status: string }> = [];
    const teamsOnReport = new Set<string>();

    for (const inj of bdlInjuries) {
      const player = inj.player;
      if (!player?.id) continue;

      // BDL WNBA spec: { player, status, return_date, comment }. NBA's spec
      // historically used `description` — accept both so a future schema
      // alignment doesn't silently regress.
      const comment = inj.comment ?? inj.description ?? '';
      const status = mapBdlStatus(inj.status ?? '', comment);
      const team = teamIdToAbbr.get(player.team_id);
      if (team) teamsOnReport.add(team);

      injuries.push({
        bdl_id: player.id,
        player_name: `${player.first_name} ${player.last_name}`,
        status,
      });
      rawSamples.push({
        name: `${player.first_name} ${player.last_name}`,
        status: String(inj.status ?? ''),
        description: String(comment),
        mapped: status,
      });
    }

    console.log(`BDL: ${injuries.length} injuries from ${teamsOnReport.size} teams: ${[...teamsOnReport].sort().join(', ')}`);
    return { injuries, teamsOnReport: [...teamsOnReport].sort(), rawSamples };
  } catch (err: any) {
    console.error('BDL injury fetch failed:', err?.message ?? err);
    return null;
  }
}

/** One player's status transition — `from` is the status the player held before
 *  this run overwrote it, and is what lets the push say "upgraded from X to Y". */
interface InjuryChange {
  playerId: string;
  from: string;
  to: string;
}

async function applyInjuries(
  sport: Sport,
  injuries: Array<{ bdl_id?: number; player_name: string; status: string }>,
  teamsOnReport: string[],
  source: 'balldontlie' | 'manual',
): Promise<{ matchedPlayers: number; statusUpdates: number; playersReset: number; unmatchedNames: string[]; changes: InjuryChange[]; teamsReported: number }> {
  const { data: allPlayers, error: playerErr } = await supabase
    .from('players').select('id, name, status, pro_team, external_id_bdl').eq('sport', sport);
  if (playerErr) throw playerErr;

  // Primary: match by BDL ID. Fallback: name match (for manual JSON payloads without bdl_id)
  const bdlIdMap = new Map<number, { id: string; status: string; pro_team: string }>();
  const exactMap = new Map<string, { id: string; status: string; pro_team: string }>();
  const normMap = new Map<string, { id: string; status: string; pro_team: string }>();
  for (const p of allPlayers ?? []) {
    const entry = { id: p.id, status: p.status, pro_team: p.pro_team };
    if (p.external_id_bdl) bdlIdMap.set(Number(p.external_id_bdl), entry);
    exactMap.set(p.name.toLowerCase(), entry);
    normMap.set(normalizeName(p.name), entry);
  }
  const findPlayer = (bdlId: number | undefined, name: string) =>
    (bdlId ? bdlIdMap.get(bdlId) : undefined) ??
    exactMap.get(name.toLowerCase()) ??
    normMap.get(normalizeName(name));

  // Cross-reference reported teams with today's schedule to avoid false positives
  // (spaceless PDF matching can pick up team names that aren't actually playing today).
  // Use ET because game_schedule.game_date is ET-aligned.
  const todayStr = getEtDateStr(new Date());
  const { data: todayGames } = await supabase
    .from('game_schedule')
    .select('home_team, away_team')
    .eq('sport', sport)
    .eq('game_date', todayStr);
  const teamsPlayingToday = new Set<string>();
  for (const g of todayGames ?? []) {
    teamsPlayingToday.add(g.home_team);
    teamsPlayingToday.add(g.away_team);
  }
  // Only reset players from teams that are both on the report AND actually play today
  const reportedTeams = new Set(teamsOnReport.filter(t => teamsPlayingToday.has(t)));
  console.log(`[${sport}] Teams playing today: ${teamsPlayingToday.size}, filtered reported teams: ${reportedTeams.size}`);

  const matchedPlayerIds = new Set<string>();
  const unmatchedNames: string[] = [];
  const changes: InjuryChange[] = [];
  let updateCount = 0;

  for (const inj of injuries) {
    const player = findPlayer(inj.bdl_id, inj.player_name);
    if (player) {
      // Two rows for the same player (a dup in the payload, or two names that
      // normalize to one match) would otherwise both compare against the stale
      // snapshot status and each fire an update + a notification line.
      if (matchedPlayerIds.has(player.id)) continue;
      matchedPlayerIds.add(player.id);
      if (player.status !== inj.status) {
        const { error } = await supabase.from('players').update({ status: inj.status }).eq('id', player.id);
        if (error) console.error(`Update error for ${inj.player_name}:`, error.message);
        else { updateCount++; changes.push({ playerId: player.id, from: player.status, to: inj.status }); }
      }
    } else {
      unmatchedNames.push(inj.player_name);
    }
  }

  // BDL `/player_injuries` is the league-wide master list — any player not
  // in it is not injured, so reset every stale injury status (OUT/SUSP
  // included) regardless of game schedule. The manual JSON path (per-team
  // PDF reports) only sees one team and uses fuzzy name matching, so it
  // stays conservative: only reset game-day designations, and only for
  // teams that are both on the report AND actually playing today.
  let playersReset = 0;
  // Keep each player's pre-reset status so the notification can say what they
  // recovered FROM ("cleared to play (was Out)").
  let resetEntries: Array<{ id: string; from: string }> = [];

  if (source === 'balldontlie') {
    resetEntries = (allPlayers ?? [])
      .filter((p: any) => ALL_INJURY_STATUSES.has(p.status) && !matchedPlayerIds.has(p.id))
      .map((p: any) => ({ id: p.id, from: p.status }));
  } else if (reportedTeams.size > 0) {
    resetEntries = (allPlayers ?? [])
      .filter((p: any) =>
        GAME_DAY_STATUSES.has(p.status) &&
        !matchedPlayerIds.has(p.id) &&
        reportedTeams.has(p.pro_team)
      )
      .map((p: any) => ({ id: p.id, from: p.status }));
  } else {
    console.log('Skipping reset: no teams identified on report');
  }

  if (resetEntries.length > 0) {
    const idsToReset = resetEntries.map(e => e.id);
    const { error } = await supabase.from('players').update({ status: 'active' }).in('id', idsToReset);
    if (error) console.error('Reset error:', error.message);
    else {
      updateCount += idsToReset.length;
      playersReset = idsToReset.length;
      changes.push(...resetEntries.map(e => ({ playerId: e.id, from: e.from, to: 'active' })));
    }
  }

  if (updateCount > 0) {
    const { error } = await supabase.rpc('refresh_player_season_stats');
    if (error) console.error('Mat view refresh error:', error.message);
  }

  return { matchedPlayers: matchedPlayerIds.size, statusUpdates: updateCount, playersReset, unmatchedNames, changes, teamsReported: reportedTeams.size };
}

// game_schedule.game_date is ET-aligned, so "today" must be computed in ET.
// Using UTC causes tomorrow's ET games to be mislabeled "Tonight" when the
// cron runs late evening ET (UTC already rolled past midnight).
function getEtDateStr(d: Date, offsetDays = 0): string {
  const et = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  et.setDate(et.getDate() + offsetDays);
  const y = et.getFullYear();
  const m = String(et.getMonth() + 1).padStart(2, '0');
  const day = String(et.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatNextGameLabel(gameDate: string, now: Date): string {
  const todayStr = getEtDateStr(now);
  const tomorrowStr = getEtDateStr(now, 1);

  if (gameDate === todayStr) return 'Tonight';
  if (gameDate === tomorrowStr) return 'Tomorrow';

  const d = new Date(gameDate + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const month = d.getUTCMonth() + 1;
  const date = d.getUTCDate();
  return `${day} ${month}/${date}`;
}

async function getNextGameByTeam(sport: Sport, proTeams: string[]): Promise<Map<string, string>> {
  const now = new Date();
  const todayStr = getEtDateStr(now);
  const nextGameMap = new Map<string, string>();
  if (proTeams.length === 0) return nextGameMap;

  // Fetch upcoming games that haven't started yet.
  // Use game_time_utc when available so we skip today's games already in progress / finished.
  const { data: upcoming } = await supabase
    .from('game_schedule')
    .select('game_date, game_time_utc, home_team, away_team')
    .eq('sport', sport)
    .gte('game_date', todayStr)
    .neq('status', 'final')
    .or(proTeams.map(t => `home_team.eq.${t},away_team.eq.${t}`).join(','))
    .order('game_date', { ascending: true })
    .limit(100);

  for (const game of upcoming ?? []) {
    // Today's games need special handling. If game_time_utc is set and tipoff
    // has passed, the game is in progress (status != 'final' filtered above) —
    // label those teams "In Progress" so injury notifications that fire mid-game
    // don't claim the update applies to tonight's or tomorrow's game.
    // If game_time_utc is missing, assume it already tipped and skip forward
    // (better to label a back-to-back's second night "Tomorrow" than to
    // mislabel a concluded game "Tonight" when the schedule row hasn't
    // flipped to status='final' yet).
    if (game.game_date === todayStr) {
      const tipoff = game.game_time_utc ? new Date(game.game_time_utc) : null;
      if (tipoff && tipoff <= now) {
        for (const team of [game.home_team, game.away_team]) {
          if (!nextGameMap.has(team)) nextGameMap.set(team, 'In Progress');
        }
        continue;
      }
      if (!tipoff) continue;
    }

    for (const team of [game.home_team, game.away_team]) {
      if (!nextGameMap.has(team)) {
        nextGameMap.set(team, formatNextGameLabel(game.game_date, now));
      }
    }
  }
  return nextGameMap;
}

async function sendInjuryNotifications(sport: Sport, changes: InjuryChange[]) {
  if (changes.length === 0) return;

  const changedPlayerIds = changes.map(c => c.playerId);
  const changeByPlayerId = new Map(changes.map(c => [c.playerId, c]));

  // Find which teams roster these players, including league name
  const { data: affectedRosters } = await supabase
    .from('league_players').select('team_id, player_id, leagues!inner(name)')
    .in('player_id', changedPlayerIds);

  if (!affectedRosters || affectedRosters.length === 0) return;

  // Fetch player details + pro_team for next-game lookup. `status` is not read
  // back — the transition we announce comes from the change record, so a
  // concurrent poll re-writing the row can't skew it.
  const { data: allChangedPlayers } = await supabase
    .from('players').select('id, name, pro_team').in('id', changedPlayerIds);
  const playerMap = new Map((allChangedPlayers ?? []).map((p: any) => [p.id, p]));

  // Look up next game for each affected pro team
  const proTeams = [...new Set((allChangedPlayers ?? []).map((p: any) => p.pro_team).filter(Boolean))];
  const nextGameMap = await getNextGameByTeam(sport, proTeams);

  // Group by team_id + league name (a user could own the same player in multiple leagues)
  const teamLeaguePlayers = new Map<string, { leagueName: string; playerIds: string[] }>();
  for (const row of affectedRosters) {
    const leagueName = (row as any).leagues?.name ?? 'Your League';
    const key = `${row.team_id}::${leagueName}`;
    const existing = teamLeaguePlayers.get(key);
    if (existing) {
      existing.playerIds.push(row.player_id);
    } else {
      teamLeaguePlayers.set(key, { leagueName, playerIds: [row.player_id] });
    }
  }

  // Build one notification per team per league and send in a single bulk batch
  const bulkNotifs: BulkTeamsNotification[] = [];
  for (const [key, { leagueName, playerIds }] of teamLeaguePlayers) {
    const teamId = key.split('::')[0];
    const lines: string[] = [];
    for (const id of playerIds) {
      const p = playerMap.get(id);
      const change = changeByPlayerId.get(id);
      if (!p || !change) continue;
      const nextGame = nextGameMap.get(p.pro_team);
      let line = describeInjuryTransition(p.name, change.from, change.to);
      if (nextGame === 'In Progress') line += `\nGame: In Progress`;
      else if (nextGame) line += `\nNext Game: ${nextGame}`;
      lines.push(line);
    }
    if (lines.length === 0) continue;

    const shown = lines.slice(0, MAX_NOTIF_PLAYERS);
    const overflow = lines.length - shown.length;
    if (overflow > 0) shown.push(`+${overflow} more player${overflow === 1 ? '' : 's'}`);

    bulkNotifs.push({
      teamIds: [teamId],
      title: `Injury Update — ${leagueName}`,
      body: shown.join('\n'),
      data: { screen: 'roster' },
    });
  }
  try {
    await notifyTeamsBulk(supabase, 'injuries', bulkNotifs);
  } catch (_) {}
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return errorResponse('Unauthorized', 401);
  }

  try {
    let injuries: Array<{ player_name: string; status: string }> | null = null;
    let teamsOnReport: string[] = [];
    let source = 'manual';
    let sport: Sport = 'nba';

    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const body = await req.json();
        if (body?.sport === 'wnba' || body?.sport === 'nfl') sport = body.sport;
        if (body?.injuries?.length > 0) {
          for (const inj of body.injuries) {
            if (!VALID_STATUSES.has(inj.status)) {
              return errorResponse(`Invalid status '${inj.status}'. Valid: ${[...VALID_STATUSES].join(', ')}`, 400);
            }
          }
          injuries = body.injuries;
          teamsOnReport = body.teams_on_report ?? [];
          source = 'manual';
        }
      } catch { /* empty or invalid JSON body — fall through */ }
    }

    let rawSamples: Array<{ name: string; status: string; description: string; mapped: string }> = [];
    if (!injuries) {
      console.log(`[${sport}] No manual data — auto-fetching from balldontlie...`);
      const fetched = await fetchInjuriesFromBdl(sport);
      source = 'balldontlie';
      if (!fetched) {
        await recordHeartbeat(supabase, `poll-injuries:${sport}`, 'ok');
        return jsonResponse({ ok: true, sport, source, note: 'could not fetch injuries from balldontlie' });
      }
      injuries = fetched.injuries;
      teamsOnReport = fetched.teamsOnReport;
      rawSamples = fetched.rawSamples;
    }

    // Debug mode: return raw BDL response and skip DB writes.
    const url = new URL(req.url);
    if (url.searchParams.get('debug') === '1') {
      const playerIdFilter = url.searchParams.get('player_id');
      let extraQuery: any = null;
      if (playerIdFilter) {
        const qs = new URLSearchParams();
        qs.append('player_ids[]', playerIdFilter);
        try {
          extraQuery = await bdlFetch(sport, `/player_injuries?${qs.toString()}`);
        } catch (e: any) {
          extraQuery = { error: e?.message ?? String(e) };
        }
      }

      // Walk pages manually so we can return the raw meta.next_cursor and
      // confirm whether bdlFetchAll is actually exhausting pagination.
      const pageDumps: any[] = [];
      let cursor: string | undefined;
      let pageNum = 0;
      while (pageNum < 20) {
        const params: Record<string, string> = { per_page: '100' };
        if (cursor) params.cursor = cursor;
        const page = await bdlFetch(sport, '/player_injuries', params);
        pageDumps.push({
          page: pageNum + 1,
          data_len: page?.data?.length ?? 0,
          meta: page?.meta ?? null,
        });
        const nc = page?.meta?.next_cursor;
        if (!nc) break;
        cursor = String(nc);
        pageNum++;
      }

      return new Response(JSON.stringify({
        ok: true, sport, source,
        league_wide_count: injuries.length,
        page_dumps: pageDumps,
        rawSamples,
        player_id_filter: playerIdFilter,
        extra_query_response: extraQuery,
      }, null, 2), { status: 200, headers: jsonHeaders });
    }

    console.log(`[${sport}] Teams on report (${teamsOnReport.length}): ${teamsOnReport.join(', ')}`);
    const result = await applyInjuries(sport, injuries, teamsOnReport, source as 'balldontlie' | 'manual');

    // Send injury notifications for changed players
    try {
      await sendInjuryNotifications(sport, result.changes);
    } catch (notifyErr) {
      console.warn('Injury notifications failed (non-fatal):', notifyErr);
    }

    await recordHeartbeat(supabase, `poll-injuries:${sport}`, 'ok');
    return jsonResponse({ ok: true, sport, source, injuriesReceived: injuries.length, matchedPlayers: result.matchedPlayers, statusUpdates: result.statusUpdates, playersReset: result.playersReset, teamsReported: result.teamsReported, unmatchedNames: result.unmatchedNames });
  } catch (err) {
    // sport may not be set if we threw before assignment; default to 'nba'.
    await recordHeartbeat(supabase, `poll-injuries:nba`, 'error', err instanceof Error ? err.message : String(err));
    return handleError(err, 'poll-injuries');
  }
});
