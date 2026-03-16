import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS } from '../_shared/cors.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

const SLEEPER_PLAYERS_URL = 'https://api.sleeper.app/v1/players/nba';

function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '')
    .replace(/\./g, '')
    .replace(/['-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  // Cron-only: check CRON_SECRET
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: jsonHeaders });
    }
  }

  try {
    // 1. Fetch all players from Sleeper API (proven to work in edge functions)
    const sleeperRes = await fetch(SLEEPER_PLAYERS_URL);
    if (!sleeperRes.ok) {
      throw new Error(`Sleeper API returned ${sleeperRes.status}`);
    }
    const sleeperPlayers: Record<string, any> = await sleeperRes.json();

    // 2. Build list of active NBA players from Sleeper
    const activePlayers: Array<{
      name: string;
      normName: string;
      position: string;
      nba_team: string | null;
    }> = [];

    for (const sp of Object.values(sleeperPlayers)) {
      if (!sp.active || sp.sport !== 'nba') continue;

      // Must be on an NBA team to be insertable
      const team = (sp.team ?? '') as string;
      if (!team) continue;

      const name = sp.full_name ?? `${sp.first_name ?? ''} ${sp.last_name ?? ''}`.trim();
      if (!name) continue;

      const position = sp.fantasy_positions?.join('-') ?? sp.position;
      if (!position || position === 'DEF') continue;

      activePlayers.push({
        name,
        normName: normalizeName(name),
        position,
        nba_team: team,
      });
    }

    // 3. Fetch our existing players (name + nba_team for matching)
    const { data: existing, error: fetchErr } = await supabase
      .from('players')
      .select('name, nba_team');
    if (fetchErr) throw new Error(`Failed to fetch players: ${fetchErr.message}`);

    // Build lookup sets: normalized name+team and normalized name only
    const existingByNameTeam = new Set<string>();
    const existingByName = new Set<string>();

    for (const p of existing ?? []) {
      const norm = normalizeName(p.name);
      existingByName.add(norm);
      if (p.nba_team) {
        existingByNameTeam.add(`${norm}|${(p.nba_team as string).toUpperCase()}`);
      }
    }

    // 4. Find players not in our DB
    const newPlayers = activePlayers.filter((p) => {
      const team = (p.nba_team ?? '').toUpperCase();
      // Check both name+team and name-only to avoid false positives
      if (team && existingByNameTeam.has(`${p.normName}|${team}`)) return false;
      if (existingByName.has(p.normName)) return false;
      return true;
    });

    if (newPlayers.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, sleeper_active: activePlayers.length, already_in_db: (existing ?? []).length, newly_inserted: 0 }),
        { status: 200, headers: jsonHeaders },
      );
    }

    // 5. Insert new players (without external_id_nba — poll-live-stats will backfill when they play)
    const toInsert = newPlayers.map((p) => ({
      name: p.name,
      position: p.position,
      nba_team: p.nba_team,
      status: 'active',
    }));

    const { error: insertErr } = await supabase
      .from('players')
      .insert(toInsert);
    if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);

    // 6. Refresh materialized view so new players appear in stats queries
    const { error: refreshErr } = await supabase.rpc('refresh_player_season_stats');
    if (refreshErr) console.error('Mat view refresh error:', refreshErr.message);

    const sampleNames = newPlayers.slice(0, 15).map((p) => p.name);
    return new Response(
      JSON.stringify({
        ok: true,
        sleeper_active: activePlayers.length,
        already_in_db: (existing ?? []).length,
        newly_inserted: newPlayers.length,
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
