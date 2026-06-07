// Edge-function roster over-capacity detection.
//
// Pure helpers (state interface + formatter + computer) come from
// utils/roster/overCapShared.ts and are byte-identical between client and
// edge. Only the DB-touching fetcher lives here, because edge functions
// pass their own supabase client as a parameter rather than importing the
// module singleton.
//
// See utils/roster/overCap.ts for client-side counterpart.

import {
  computeOverCapState,
  formatOverCapError,
  type OverCapState,
} from '../../../utils/roster/overCapShared.ts';

export { computeOverCapState, formatOverCapError, type OverCapState };

// deno-lint-ignore no-explicit-any
export async function fetchOverCapState(
  supabase: any,
  leagueId: string,
  teamId: string,
  exemptPlayerIds: string[] = [],
): Promise<OverCapState> {
  const [{ data: leagueRow, error: leagueErr }, { data: activeRows, error: activeErr }] =
    await Promise.all([
      supabase.from('leagues').select('roster_size').eq('id', leagueId).single(),
      supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .not('roster_slot', 'in', '("IR","TAXI")')
        // Exclude not-yet-active deferred adds (future acquired_at) — see the
        // client counterpart in utils/roster/overCap.ts for the full rationale.
        .lte('acquired_at', new Date().toISOString()),
    ]);
  if (leagueErr) throw leagueErr;
  if (activeErr) throw activeErr;

  const rosterSize = leagueRow?.roster_size ?? 13;
  const exemptSet = new Set(exemptPlayerIds);
  const activeCount = (activeRows ?? []).length;
  const exemptCount = (activeRows ?? []).filter((r: { player_id: string }) =>
    exemptSet.has(r.player_id),
  ).length;

  return computeOverCapState(activeCount, rosterSize, exemptCount);
}
