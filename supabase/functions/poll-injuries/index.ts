import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyTeams } from '../_shared/push.ts';
import { CORS_HEADERS } from '../_shared/cors.ts';
import { bdlFetchAll } from '../_shared/bdl.ts';
import { normalizeName } from '../_shared/normalize.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const VALID_STATUSES = new Set(['OUT', 'SUSP', 'DOUBT', 'QUES', 'PROB', 'active']);

const STATUS_MAP: Record<string, string> = {
  'out': 'OUT', 'suspended': 'SUSP', 'doubtful': 'DOUBT',
  'day-to-day': 'QUES', 'day to day': 'QUES',
  'game time decision': 'QUES', 'gtd': 'QUES', 'questionable': 'QUES',
  'available': 'active', 'probable': 'PROB',
};

// Statuses that are game-day designations and safe to auto-reset when absent from report.
// OUT and SUSP are long-term and should only change when the player explicitly reappears.
const GAME_DAY_STATUSES = new Set(['QUES', 'DOUBT', 'PROB']);

// Maps full NBA team names to tricodes for PDF parsing
const TEAM_NAME_TO_TRICODE: Record<string, string> = {
  'atlanta hawks': 'ATL', 'boston celtics': 'BOS', 'brooklyn nets': 'BKN',
  'charlotte hornets': 'CHA', 'chicago bulls': 'CHI', 'cleveland cavaliers': 'CLE',
  'dallas mavericks': 'DAL', 'denver nuggets': 'DEN', 'detroit pistons': 'DET',
  'golden state warriors': 'GSW', 'houston rockets': 'HOU', 'indiana pacers': 'IND',
  'los angeles clippers': 'LAC', 'la clippers': 'LAC',
  'los angeles lakers': 'LAL', 'la lakers': 'LAL',
  'memphis grizzlies': 'MEM', 'miami heat': 'MIA', 'milwaukee bucks': 'MIL',
  'minnesota timberwolves': 'MIN', 'new orleans pelicans': 'NOP',
  'new york knicks': 'NYK', 'oklahoma city thunder': 'OKC', 'orlando magic': 'ORL',
  'philadelphia 76ers': 'PHI', 'phoenix suns': 'PHX', 'portland trail blazers': 'POR',
  'sacramento kings': 'SAC', 'san antonio spurs': 'SAS', 'toronto raptors': 'TOR',
  'utah jazz': 'UTA', 'washington wizards': 'WAS',
};

function extractTeamsFromText(text: string): string[] {
  // NBA PDFs often strip spaces from team names (e.g. "OrlandoMagic"),
  // so we normalize both text and team names by removing spaces.
  const teams = new Set<string>();
  const normalized = text.toLowerCase().replace(/\s/g, '');
  for (const [name, tricode] of Object.entries(TEAM_NAME_TO_TRICODE)) {
    if (normalized.includes(name.replace(/\s/g, ''))) teams.add(tricode);
  }
  return [...teams].sort();
}

const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };


function buildPdfUrls(): string[] {
  const now = new Date();
  const urls: string[] = [];
  for (let offset = 0; offset <= 8; offset++) {
    const t = new Date(now.getTime() - offset * 15 * 60_000);
    const et = new Date(t.getTime() - 5 * 3600_000);
    const dateStr = et.toISOString().slice(0, 10);
    const h24 = et.getUTCHours();
    const h12 = h24 % 12 || 12;
    const ampm = h24 < 12 ? 'AM' : 'PM';
    const roundedMin = Math.floor(et.getUTCMinutes() / 15) * 15;
    const timeStr = `${String(h12).padStart(2, '0')}_${String(roundedMin).padStart(2, '0')}${ampm}`;
    urls.push(`https://ak-static.cms.nba.com/referee/injury/Injury-Report_${dateStr}_${timeStr}.pdf`);
  }
  return urls;
}

function extractPdfText(bytes: Uint8Array): string {
  const raw = new TextDecoder('latin1').decode(bytes);
  const parts: string[] = [];
  const btEt = /BT\s([\s\S]*?)\s*ET/g;
  let m;
  while ((m = btEt.exec(raw)) !== null) {
    const block = m[1];
    const tj = /\(([^)]*)\)\s*Tj/g;
    let t;
    while ((t = tj.exec(block)) !== null) parts.push(t[1]);
    const tjArr = /\[([^\]]*)\]\s*TJ/g;
    let a;
    while ((a = tjArr.exec(block)) !== null) {
      const inner = a[1];
      const s = /\(([^)]*)\)/g;
      let ss;
      while ((ss = s.exec(inner)) !== null) parts.push(ss[1]);
    }
  }
  return parts.join(' ');
}

function parseInjuriesFromText(text: string): Array<{ player_name: string; status: string }> {
  const re = /([A-Z][a-zA-Z'\-\.]+(?:(?:Jr|Sr|III|II|IV)\.?)?,\s*[A-Z][a-zA-Z'\-\.]+)\s+(Out|Questionable|Doubtful|Probable|Day-To-Day|Available)(?:\s|$)/g;
  const injuries: Array<{ player_name: string; status: string }> = [];
  const seen = new Set<string>();
  let match;
  while ((match = re.exec(text)) !== null) {
    const rawName = match[1].trim();
    const rawStatus = match[2].trim();
    const mapped = STATUS_MAP[rawStatus.toLowerCase()];
    if (!mapped) continue;
    const commaIdx = rawName.indexOf(',');
    let name: string;
    if (commaIdx > 0) {
      let last = rawName.slice(0, commaIdx).trim();
      const first = rawName.slice(commaIdx + 1).trim();
      last = last.replace(/(Jr|Sr)(\.?)$/, ' $1$2');
      last = last.replace(/(I{2,3}|IV)$/, ' $1');
      name = `${first} ${last}`.replace(/\s+/g, ' ').trim();
    } else {
      name = rawName;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    injuries.push({ player_name: name, status: mapped });
  }
  return injuries;
}

/** Map BDL injury status strings to app status codes. */
const BDL_STATUS_MAP: Record<string, string> = {
  'out': 'OUT', 'suspended': 'SUSP', 'doubtful': 'DOUBT',
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
    const bdlInjuries = await bdlFetchAll('/player_injuries');
    if (!bdlInjuries || bdlInjuries.length === 0) return null;

    const injuries: Array<{ bdl_id: number; player_name: string; status: string }> = [];
    const teamsOnReport = new Set<string>();

    for (const inj of bdlInjuries) {
      const player = inj.player;
      if (!player?.id) continue;

      const status = mapBdlStatus(inj.status ?? '', inj.description);
      const team = player.team?.abbreviation;
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
  // (spaceless PDF matching can pick up team names that aren't actually playing today)
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
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

function formatNextGameLabel(gameDate: string, now: Date): string {
  const todayStr = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);

  if (gameDate === todayStr) return 'Tonight';
  if (gameDate === tomorrowStr) return 'Tomorrow';

  const d = new Date(gameDate + 'T12:00:00Z');
  const day = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
  const month = d.getUTCMonth() + 1;
  const date = d.getUTCDate();
  return `${day} ${month}/${date}`;
}

async function getNextGameByTeam(nbaTeams: string[]): Promise<Map<string, string>> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const nextGameMap = new Map<string, string>();
  if (nbaTeams.length === 0) return nextGameMap;

  // Fetch the next upcoming game for each team (today or later)
  // We grab a small window and pick the earliest per team
  const { data: upcoming } = await supabase
    .from('nba_schedule')
    .select('game_date, home_team, away_team')
    .gte('game_date', todayStr)
    .or(nbaTeams.map(t => `home_team.eq.${t},away_team.eq.${t}`).join(','))
    .order('game_date', { ascending: true })
    .limit(100);

  const now = new Date();
  for (const game of upcoming ?? []) {
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
