import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { CORS_HEADERS } from '../_shared/cors.ts';
import { bdlFetchAll } from '../_shared/bdl.ts';
import { normalizeName } from '../_shared/normalize.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const jsonHeaders = { ...CORS_HEADERS, 'Content-Type': 'application/json' };


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
    // 1. Fetch all players from balldontlie
    const bdlPlayers = await bdlFetchAll('/players');

    // 2. Build list of active NBA players (those with a team)
    const activePlayers: Array<{
      bdl_id: number;
      name: string;
      normName: string;
      position: string;
      nba_team: string;
    }> = [];

    for (const bp of bdlPlayers) {
      const team = bp.team?.abbreviation;
      if (!team) continue;

      const name = `${bp.first_name ?? ''} ${bp.last_name ?? ''}`.trim();
      if (!name) continue;

      const position = bp.position || 'F';

      activePlayers.push({
        bdl_id: bp.id,
        name,
        normName: normalizeName(name),
        position,
        nba_team: team,
      });
    }

    // 3. Fetch our existing players (bdl_id + name for matching)
    const { data: existing, error: fetchErr } = await supabase
      .from('players')
      .select('name, nba_team, external_id_bdl');
    if (fetchErr) throw new Error(`Failed to fetch players: ${fetchErr.message}`);

    // Build lookup sets
    const existingByBdlId = new Set<number>();
    const existingByName = new Set<string>();

    for (const p of existing ?? []) {
      if (p.external_id_bdl) existingByBdlId.add(Number(p.external_id_bdl));
      existingByName.add(normalizeName(p.name));
    }

    // 4. Find players not in our DB
    const newPlayers = activePlayers.filter((p) => {
      if (existingByBdlId.has(p.bdl_id)) return false;
      if (existingByName.has(p.normName)) return false;
      return true;
    });

    if (newPlayers.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, bdl_active: activePlayers.length, already_in_db: (existing ?? []).length, newly_inserted: 0 }),
        { status: 200, headers: jsonHeaders },
      );
    }

    // 5. Insert new players with external_id_bdl set
    const toInsert = newPlayers.map((p) => ({
      name: p.name,
      position: p.position,
      nba_team: p.nba_team,
      status: 'active',
      external_id_bdl: p.bdl_id,
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
        bdl_active: activePlayers.length,
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
