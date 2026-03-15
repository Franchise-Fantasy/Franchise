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
    // 1. Fetch all players from Sleeper
    const sleeperRes = await fetch(SLEEPER_PLAYERS_URL);
    if (!sleeperRes.ok) {
      throw new Error(`Sleeper API returned ${sleeperRes.status}`);
    }
    const sleeperPlayers: Record<string, any> = await sleeperRes.json();

    // 2. Build lookup: normalized name + team → position
    // Only include active NBA players with a position
    const sleeperByNameTeam = new Map<string, string>();
    const sleeperByName = new Map<string, { position: string; count: number }>();

    for (const sp of Object.values(sleeperPlayers)) {
      if (!sp.active || sp.sport !== 'nba') continue;

      const position = sp.fantasy_positions?.[0] ?? sp.position;
      if (!position) continue;

      const name = sp.full_name ?? `${sp.first_name ?? ''} ${sp.last_name ?? ''}`.trim();
      if (!name) continue;

      const norm = normalizeName(name);
      const team = (sp.team ?? '').toUpperCase();

      if (team) {
        sleeperByNameTeam.set(`${norm}|${team}`, position);
      }

      const existing = sleeperByName.get(norm);
      if (existing) {
        existing.count++;
      } else {
        sleeperByName.set(norm, { position, count: 1 });
      }
    }

    // 3. Fetch our players
    const { data: ourPlayers, error: fetchErr } = await supabase
      .from('players')
      .select('id, name, position, nba_team');
    if (fetchErr) throw new Error(`Failed to fetch players: ${fetchErr.message}`);

    // 4. Match and collect updates
    let matched = 0;
    let updated = 0;
    let unmatched = 0;
    const unmatchedNames: string[] = [];

    const updates: Array<{ id: string; position: string }> = [];

    for (const player of ourPlayers ?? []) {
      const norm = normalizeName(player.name);
      const team = (player.nba_team ?? '').toUpperCase();

      // Try name + team first, then name-only (if unique)
      let newPosition = sleeperByNameTeam.get(`${norm}|${team}`);

      if (!newPosition) {
        const nameOnly = sleeperByName.get(norm);
        if (nameOnly && nameOnly.count === 1) {
          newPosition = nameOnly.position;
        }
      }

      if (newPosition) {
        matched++;
        if (player.position !== newPosition) {
          updates.push({ id: player.id, position: newPosition });
          updated++;
        }
      } else {
        unmatched++;
        if (unmatchedNames.length < 20) {
          unmatchedNames.push(player.name);
        }
      }
    }

    // 5. Batch update positions
    for (const { id, position } of updates) {
      const { error } = await supabase
        .from('players')
        .update({ position })
        .eq('id', id);
      if (error) console.error(`Failed to update ${id}:`, error.message);
    }

    // 6. Refresh materialized view if any updates were made
    if (updated > 0) {
      const { error } = await supabase.rpc('refresh_player_season_stats');
      if (error) console.error('Mat view refresh error:', error.message);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        total_players: (ourPlayers ?? []).length,
        matched,
        updated,
        unmatched,
        unmatched_sample: unmatchedNames,
      }),
      { status: 200, headers: jsonHeaders },
    );
  } catch (err: any) {
    console.error('sync-positions error:', err?.message ?? err);
    return new Response(
      JSON.stringify({ error: err?.message ?? String(err) }),
      { status: 500, headers: jsonHeaders },
    );
  }
});
