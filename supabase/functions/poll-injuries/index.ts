import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyTeams } from '../_shared/push.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { bdlFetch, bdlFetchAll } from '../_shared/bdl.ts';
import { normalizeName } from '../_shared/normalize.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const VALID_STATUSES = new Set(['OUT', 'SUSP', 'DOUBT', 'QUES', 'PROB', 'active']);

// Statuses that are game-day designations and safe to auto-reset when absent from report.
// OUT and SUSP are long-term and should only change when the player explicitly reappears.
const GAME_DAY_STATUSES = new Set(['QUES', 'DOUBT', 'PROB']);

const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

/** Map BDL injury status strings to app status codes. */
const BDL_STATUS_MAP: Record<string, string> = {
  'out': 'OUT', 'out for season': 'OUT',
  'suspended': 'SUSP', 'doubtful': 'DOUBT',
  'day-to-day': 'QUES', 'questionable': 'QUES', 'probable': 'PROB',
};

function mapBdlStatus(bdlStatus: string, description?: string): string {
  const mapped = BDL_STATUS_MAP[bdlStatus.toLowerCase()];
  if (mapped) return mapped;
  // Fall back to parsing the description field for finer-grained statuses
  if (description) {
    const lower = description.toLowerCase();
    for (const [key, val] of Object.entries(BDL_STATUS_MAP)) {
      if (lower.includes(key)) return val;
    }
  }
  // Default: if BDL says something we don't recognize, treat as questionable
  return 'QUES';
}

async function fetchInjuriesFromBdl(): Promise<{
  injuries: Array<{ bdl_id: number; player_name: string; status: string }>;
  teamsOnReport: string[];
} | null> {
  try {
    // BDL injury endpoint only returns team_id (numeric), so look up abbreviations
    const [bdlInjuries, bdlTeams] = await Promise.all([
      bdlFetchAll('/player_injuries'),
      bdlFetch('/teams').then((d: any) => d.data ?? []),
    ]);
    if (!bdlInjuries || bdlInjuries.length === 0) return null;

    const teamIdToAbbr = new Map<number, string>(
      bdlTeams.map((t: any) => [t.id, t.abbreviation]),
    );

    const injuries: Array<{ bdl_id: number; player_name: string; status: string }> = [];
    const teamsOnReport = new Set<string>();

    for (const inj of bdlInjuries) {
      const player = inj.player;
      if (!player?.id) continue;

      const status = mapBdlStatus(inj.status ?? '', inj.description);
      const team = teamIdToAbbr.get(player.team_id);
      if (team) teamsOnReport.add(team);

      injuries.push({
        bdl_id: player.id,
        player_name: `${player.first_name} ${player.last_name}`,
        status,
      });
    }

    console.log(`BDL: ${injuries.length} injuries from ${teamsOnReport.size} teams: ${[...teamsOnReport].sort().join(', ')}`);
    return { injuries, teamsOnReport: [...teamsOnReport].sort() };
  } catch (err: any) {
    console.error('BDL injury fetch failed:', err?.message ?? err);
    return null;
  }
}

async function applyInjuries(
  injuries: Array<{ bdl_id?: number; player_name: string; status: string }>,
  teamsOnReport: string[],
): Promise<{ matchedPlayers: number; statusUpdates: number; playersReset: number; unmatchedNames: string[]; changedPlayerIds: string[]; teamsReported: number }> {
  const { data: allPlayers, error: playerErr } = await supabase
    .from('players').select('id, name, status, nba_team, external_id_bdl');
  if (playerErr) throw new Error(playerErr.message);

  // Primary: match by BDL ID. Fallback: name match (for manual JSON payloads without bdl_id)
  const bdlIdMap = new Map<number, { id: string; status: string; nba_team: string }>();
  const exactMap = new Map<string, { id: string; status: string; nba_team: string }>();
  const normMap = new Map<string, { id: string; status: string; nba_team: string }>();
  for (const p of allPlayers ?? []) {
    const entry = { id: p.id, status: p.status, nba_team: p.nba_team };
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
  // Use ET because nba_schedule.game_date is ET-aligned.
  const todayStr = getEtDateStr(new Date());
  const { data: todayGames } = await supabase
    .from('nba_schedule')
    .select('home_team, away_team')
    .eq('game_date', todayStr);
  const teamsPlayingToday = new Set<string>();
  for (const g of todayGames ?? []) {
    teamsPlayingToday.add(g.home_team);
    teamsPlayingToday.add(g.away_team);
  }
  // Only reset players from teams that are both on the report AND actually play today
  const reportedTeams = new Set(teamsOnReport.filter(t => teamsPlayingToday.has(t)));
  console.log(`Teams playing today: ${teamsPlayingToday.size}, filtered reported teams: ${reportedTeams.size}`);

  const matchedPlayerIds = new Set<string>();
  const unmatchedNames: string[] = [];
  const changedPlayerIds: string[] = [];
  let updateCount = 0;

  for (const inj of injuries) {
    const player = findPlayer(inj.bdl_id, inj.player_name);
    if (player) {
      matchedPlayerIds.add(player.id);
      if (player.status !== inj.status) {
        const { error } = await supabase.from('players').update({ status: inj.status }).eq('id', player.id);
        if (error) console.error(`Update error for ${inj.player_name}:`, error.message);
        else { updateCount++; changedPlayerIds.push(player.id); }
      }
    } else {
      unmatchedNames.push(inj.player_name);
    }
  }

  // Only reset game-day designations (QUES, DOUBT, GTD, DTD) when a player's team
  // submitted a report but didn't list them. Long-term statuses (OUT, SUSP) stay
  // until the player explicitly reappears on a report (e.g. as "Available").
  let playersReset = 0;

  if (reportedTeams.size > 0) {
    const idsToReset = (allPlayers ?? [])
      .filter((p: any) =>
        GAME_DAY_STATUSES.has(p.status) &&
        !matchedPlayerIds.has(p.id) &&
        reportedTeams.has(p.nba_team)
      )
      .map((p: any) => p.id);

    if (idsToReset.length > 0) {
      const { error } = await supabase.from('players').update({ status: 'active' }).in('id', idsToReset);
      if (error) console.error('Reset error:', error.message);
      else { updateCount += idsToReset.length; playersReset = idsToReset.length; changedPlayerIds.push(...idsToReset); }
    }
  } else {
    console.log('Skipping reset: no teams identified on report');
  }

  if (updateCount > 0) {
    const { error } = await supabase.rpc('refresh_player_season_stats');
    if (error) console.error('Mat view refresh error:', error.message);
  }

  return { matchedPlayers: matchedPlayerIds.size, statusUpdates: updateCount, playersReset, unmatchedNames, changedPlayerIds, teamsReported: reportedTeams.size };
}

// nba_schedule.game_date is ET-aligned, so "today" must be computed in ET.
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

async function getNextGameByTeam(nbaTeams: string[]): Promise<Map<string, string>> {
  const now = new Date();
  const todayStr = getEtDateStr(now);
  const nextGameMap = new Map<string, string>();
  if (nbaTeams.length === 0) return nextGameMap;

  // Fetch upcoming games that haven't started yet.
  // Use game_time_utc when available so we skip today's games already in progress / finished.
  const { data: upcoming } = await supabase
    .from('nba_schedule')
    .select('game_date, game_time_utc, home_team, away_team')
    .gte('game_date', todayStr)
    .neq('status', 'final')
    .or(nbaTeams.map(t => `home_team.eq.${t},away_team.eq.${t}`).join(','))
    .order('game_date', { ascending: true })
    .limit(100);

  for (const game of upcoming ?? []) {
    // Skip games that have already tipped off today (in-progress)
    if (game.game_time_utc && new Date(game.game_time_utc) <= now) continue;

    for (const team of [game.home_team, game.away_team]) {
      if (!nextGameMap.has(team)) {
        nextGameMap.set(team, formatNextGameLabel(game.game_date, now));
      }
    }
  }
  return nextGameMap;
}

async function sendInjuryNotifications(changedPlayerIds: string[]) {
  if (changedPlayerIds.length === 0) return;

  // Find which teams roster these players, including league name
  const { data: affectedRosters } = await supabase
    .from('league_players').select('team_id, player_id, leagues!inner(name)')
    .in('player_id', changedPlayerIds);

  if (!affectedRosters || affectedRosters.length === 0) return;

  // Fetch player details + nba_team for next-game lookup
  const { data: allChangedPlayers } = await supabase
    .from('players').select('id, name, status, nba_team').in('id', changedPlayerIds);
  const playerMap = new Map((allChangedPlayers ?? []).map((p: any) => [p.id, p]));

  // Look up next game for each affected NBA team
  const nbaTeams = [...new Set((allChangedPlayers ?? []).map((p: any) => p.nba_team).filter(Boolean))];
  const nextGameMap = await getNextGameByTeam(nbaTeams);

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

  // Send one notification per team per league
  for (const [key, { leagueName, playerIds }] of teamLeaguePlayers) {
    const teamId = key.split('::')[0];
    try {
      const lines: string[] = [];
      for (const id of playerIds) {
        const p = playerMap.get(id);
        if (!p) continue;
        const nextGame = nextGameMap.get(p.nba_team);
        let line = `${p.name}: ${p.status}`;
        if (nextGame) line += `\nNext Game: ${nextGame}`;
        lines.push(line);
      }
      const summary = lines.join('\n');
      await notifyTeams(supabase, [teamId], 'injuries',
        `Injury Update — ${leagueName}`,
        summary,
        { screen: 'roster' }
      );
    } catch (_) {}
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  const authHeader = req.headers.get('Authorization');
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
  }

  try {
    let injuries: Array<{ player_name: string; status: string }> | null = null;
    let teamsOnReport: string[] = [];
    let source = 'manual';

    const contentType = req.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      try {
        const body = await req.json();
        if (body?.injuries?.length > 0) {
          for (const inj of body.injuries) {
            if (!VALID_STATUSES.has(inj.status)) {
              return new Response(
                JSON.stringify({ error: `Invalid status '${inj.status}'. Valid: ${[...VALID_STATUSES].join(', ')}` }),
                { status: 400, headers: jsonHeaders },
              );
            }
          }
          injuries = body.injuries;
          teamsOnReport = body.teams_on_report ?? [];
          source = 'manual';
        }
      } catch { /* empty or invalid JSON body — fall through */ }
    }

    if (!injuries) {
      console.log('No manual data — auto-fetching from balldontlie...');
      const fetched = await fetchInjuriesFromBdl();
      source = 'balldontlie';
      if (!fetched) {
        return new Response(
          JSON.stringify({ ok: true, source, note: 'could not fetch injuries from balldontlie' }),
          { status: 200, headers: jsonHeaders },
        );
      }
      injuries = fetched.injuries;
      teamsOnReport = fetched.teamsOnReport;
    }

    console.log(`Teams on report (${teamsOnReport.length}): ${teamsOnReport.join(', ')}`);
    const result = await applyInjuries(injuries, teamsOnReport);

    // Send injury notifications for changed players
    try {
      await sendInjuryNotifications(result.changedPlayerIds);
    } catch (notifyErr) {
      console.warn('Injury notifications failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ ok: true, source, injuriesReceived: injuries.length, matchedPlayers: result.matchedPlayers, statusUpdates: result.statusUpdates, playersReset: result.playersReset, teamsReported: result.teamsReported, unmatchedNames: result.unmatchedNames }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err: any) {
    console.error('Unhandled error in poll-injuries:', err?.message ?? err);
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), { status: 500, headers: CORS_HEADERS });
  }
});
