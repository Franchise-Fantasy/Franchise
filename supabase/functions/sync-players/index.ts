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
    // 1. Fetch active players from balldontlie
    const bdlPlayers = await bdlFetchAll('/players/active');

    // 2. Build list of active NBA players (those with a team)
    // NOTE: positions are NOT sourced from BDL — they are managed separately
    // via the sync_positions.py script (pulls from Sleeper).
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

    // 3. Fetch our existing players (bdl_id + name for matching)
    const { data: existing, error: fetchErr } = await supabase
      .from('players')
      .select('id, name, position, nba_team, external_id_bdl');
    if (fetchErr) throw new Error(`Failed to fetch players: ${fetchErr.message}`);

    // Build lookups
    const existingByBdlId = new Map<number, { id: string; nba_team: string | null; position: string | null }>();
    const existingByName = new Map<string, { id: string; nba_team: string | null; position: string | null; external_id_bdl: number | null }>();

    for (const p of existing ?? []) {
      if (p.external_id_bdl) existingByBdlId.set(Number(p.external_id_bdl), { id: p.id, nba_team: p.nba_team, position: p.position });
      existingByName.set(normalizeName(p.name), { id: p.id, nba_team: p.nba_team, position: p.position, external_id_bdl: p.external_id_bdl });
    }

    // 4a. Find new players not in our DB
    const newPlayers = activePlayers.filter((p) => {
      if (existingByBdlId.has(p.bdl_id)) return false;
      if (existingByName.has(p.normName)) return false;
      return true;
    });

    // 4b. Find existing players whose nba_team changed (positions managed separately)
    const bdlActiveIds = new Set<number>();
    const teamUpdates: Array<{ id: string; nba_team: string; external_id_bdl?: number }> = [];

    for (const bp of activePlayers) {
      bdlActiveIds.add(bp.bdl_id);

      const match = existingByBdlId.get(bp.bdl_id)
        ?? (existingByName.has(bp.normName) ? existingByName.get(bp.normName)! : null);
      if (!match) continue;

      if (match.nba_team !== bp.nba_team) {
        const update: typeof teamUpdates[number] = { id: match.id, nba_team: bp.nba_team };
        // Back-fill bdl_id if matched by name only
        if (!existingByBdlId.has(bp.bdl_id)) update.external_id_bdl = bp.bdl_id;
        teamUpdates.push(update);
      }
    }

    // 4c. Players in our DB with a bdl_id who are no longer in the active list → waived / released
    const waivedIds: string[] = [];
    for (const [bdlId, rec] of existingByBdlId) {
      if (!bdlActiveIds.has(bdlId) && rec.nba_team !== null) {
        waivedIds.push(rec.id);
      }
    }

    // 5. Insert new players (position left null — sync_positions.py will fill it)
    let newlyInserted = 0;
    if (newPlayers.length > 0) {
      const toInsert = newPlayers.map((p) => ({
        name: p.name,
        nba_team: p.nba_team,
        status: 'active',
        external_id_bdl: p.bdl_id,
      }));
      const { error: insertErr } = await supabase.from('players').insert(toInsert);
      if (insertErr) throw new Error(`Insert failed: ${insertErr.message}`);
      newlyInserted = newPlayers.length;
    }

    // 6. Update changed teams (batch in chunks of 50)
    let teamUpdated = 0;
    for (let i = 0; i < teamUpdates.length; i += 50) {
      const chunk = teamUpdates.slice(i, i + 50);
      await Promise.all(chunk.map((u) =>
        supabase.from('players').update({
          nba_team: u.nba_team,
          ...(u.external_id_bdl ? { external_id_bdl: u.external_id_bdl } : {}),
        }).eq('id', u.id)
      ));
      teamUpdated += chunk.length;
    }

    // 7. Clear nba_team for waived/released players
    let waivedCount = 0;
    if (waivedIds.length > 0) {
      const { error: waivedErr } = await supabase
        .from('players')
        .update({ nba_team: null })
        .in('id', waivedIds);
      if (waivedErr) console.error('Waived update error:', waivedErr.message);
      else waivedCount = waivedIds.length;
    }

    // 8. Refresh materialized view so changes appear in stats queries
    const { error: refreshErr } = await supabase.rpc('refresh_player_season_stats');
    if (refreshErr) console.error('Mat view refresh error:', refreshErr.message);

    const sampleNames = newPlayers.slice(0, 15).map((p) => p.name);
    return new Response(
      JSON.stringify({
        ok: true,
        bdl_active: activePlayers.length,
        already_in_db: (existing ?? []).length,
        newly_inserted: newlyInserted,
        team_updated: teamUpdated,
        waived_cleared: waivedCount,
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
