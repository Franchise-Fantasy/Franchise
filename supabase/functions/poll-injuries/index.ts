import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyTeams } from './push.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const VALID_STATUSES = new Set(['OUT', 'SUSP', 'DOUBT', 'DTD', 'GTD', 'QUES', 'active']);

const STATUS_MAP: Record<string, string> = {
  'out': 'OUT', 'suspended': 'SUSP', 'doubtful': 'DOUBT',
  'day-to-day': 'DTD', 'day to day': 'DTD',
  'game time decision': 'GTD', 'gtd': 'GTD', 'questionable': 'QUES',
};

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
  const teams = new Set<string>();
  const lower = text.toLowerCase();
  for (const [name, tricode] of Object.entries(TEAM_NAME_TO_TRICODE)) {
    if (lower.includes(name)) teams.add(tricode);
  }
  return [...teams].sort();
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' };

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

async function fetchInjuriesFromNba(): Promise<{ injuries: Array<{ player_name: string; status: string }>; teamsOnReport: string[] } | null> {
  const urls = buildPdfUrls();
  for (const url of urls) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { Referer: 'https://www.nba.com/', Origin: 'https://www.nba.com' },
      });
      clearTimeout(timeout);
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      console.log(`Fetched PDF: ${url} (${bytes.length} bytes)`);
      const text = extractPdfText(bytes);
      console.log(`Extracted text: ${text.length} chars`);
      if (text.length < 100) continue;
      const injuries = parseInjuriesFromText(text);
      const teamsOnReport = extractTeamsFromText(text);
      console.log(`Parsed ${injuries.length} injuries from ${teamsOnReport.length} teams: ${teamsOnReport.join(', ')}`);
      if (injuries.length > 0) return { injuries, teamsOnReport };
    } catch (err: any) {
      console.warn(`PDF fetch failed for ${url}: ${err?.message ?? err}`);
      continue;
    }
  }
  return null;
}

async function applyInjuries(
  injuries: Array<{ player_name: string; status: string }>,
  teamsOnReport: string[],
): Promise<{ matchedPlayers: number; statusUpdates: number; playersReset: number; unmatchedNames: string[]; changedPlayerIds: string[]; teamsReported: number }> {
  const { data: allPlayers, error: playerErr } = await supabase
    .from('players').select('id, name, status, nba_team');
  if (playerErr) throw new Error(playerErr.message);

  const nameToPlayer = new Map<string, { id: string; status: string; nba_team: string }>(
    (allPlayers ?? []).map((p: any) => [p.name.toLowerCase(), { id: p.id, status: p.status, nba_team: p.nba_team }]),
  );

  const reportedTeams = new Set(teamsOnReport);
  const matchedPlayerIds = new Set<string>();
  const unmatchedNames: string[] = [];
  const changedPlayerIds: string[] = [];
  let updateCount = 0;

  for (const inj of injuries) {
    const player = nameToPlayer.get(inj.player_name.toLowerCase());
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

  // Only reset players whose team is on the report and who aren't listed as injured.
  // This prevents resetting players from teams that haven't submitted yet or don't
  // play today (e.g. a season-ending injury whose team has no game).
  let playersReset = 0;

  if (reportedTeams.size > 0) {
    const idsToReset = (allPlayers ?? [])
      .filter((p: any) =>
        p.status !== 'active' &&
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

async function sendInjuryNotifications(changedPlayerIds: string[]) {
  if (changedPlayerIds.length === 0) return;

  // Find which teams roster these players, including league name
  const { data: affectedRosters } = await supabase
    .from('league_players').select('team_id, player_id, leagues!inner(name)')
    .in('player_id', changedPlayerIds);

  if (!affectedRosters || affectedRosters.length === 0) return;

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
      const { data: players } = await supabase
        .from('players').select('name, status').in('id', playerIds);
      const summary = (players ?? [])
        .map((p: any) => `${p.name}: ${p.status}`)
        .join(', ');
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
    return new Response('ok', { headers: corsHeaders });
  }

  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
    }
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
      console.log('No manual data — auto-fetching from NBA injury report PDF...');
      const fetched = await fetchInjuriesFromNba();
      source = 'nba-pdf';
      if (!fetched) {
        return new Response(
          JSON.stringify({ ok: true, source, note: 'could not fetch or parse NBA injury PDF' }),
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
    return new Response(JSON.stringify({ error: err?.message ?? String(err) }), { status: 500, headers: corsHeaders });
  }
});
