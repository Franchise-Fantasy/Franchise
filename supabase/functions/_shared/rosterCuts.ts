import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

import {
  computeCutsPlan,
  type CutsCandidate,
  type CutsPlan,
  type CutsPlanConfig,
} from '../../../utils/roster/rosterCutsShared.ts';

export { computeCutsPlan, type CutsCandidate, type CutsPlan, type CutsPlanConfig };

export interface TeamCutsInputs {
  teamId: string;
  teamName: string;
  roster: CutsCandidate[];
}

export interface LeagueCutsInputs {
  leagueName: string;
  config: CutsPlanConfig;
  teams: TeamCutsInputs[];
}

/**
 * Gather everything `computeCutsPlan` needs for every team in a league.
 *
 * Edge half of the shared cuts-plan core (utils/roster/rosterCutsShared.ts,
 * which documents the rules) — the client's useCutsPlan hook runs the same pure
 * function over the same shape, so the plan a GM is warned about is the plan
 * enforce-roster-cuts applies. Keep this and utils/roster/rosterCuts.ts (the
 * client twin) edited in the same commit: they're the pattern-(b) wrapper pair
 * and there is no scanner for them.
 *
 * Taxi seats read from league_roster_config rather than leagues.taxi_slots:
 * replace_roster_config rewrites the config rows and roster_size but never
 * taxi_slots, and the roster page renders its taxi section from the config — so
 * the config row is what GMs actually see. The column is the fallback for older
 * leagues that predate the config row.
 *
 * Row volume: the roster read is bounded by teams × roster size (the app's own
 * caps put the ceiling near 580) and the rookie-pick read is scoped to one
 * season, so both stay well under PostgREST's silent 1000-row cut. Revisit if
 * the team-count or roster-size limits ever grow.
 */
export async function fetchLeagueCutsInputs(
  supabase: SupabaseClient,
  leagueId: string,
): Promise<LeagueCutsInputs> {
  const nowIso = new Date().toISOString();

  // Fetched first (single row, PK lookup) so `season` can scope the rookie-pick
  // query below — otherwise that read grows with every season the league has
  // ever played and would eventually hit PostgREST's 1000-row silent cut.
  const { data: league, error: leagueErr } = await supabase
    .from('leagues')
    .select('name, roster_size, taxi_slots, taxi_max_experience, season')
    .eq('id', leagueId)
    .single();
  if (leagueErr) throw leagueErr;
  if (!league) throw new Error(`league ${leagueId} not found`);

  const [
    { data: taxiConfig, error: taxiErr },
    { data: teams, error: teamsErr },
    { data: rosterRows, error: rosterErr },
    { data: rookiePicks, error: picksErr },
  ] = await Promise.all([
    supabase
      .from('league_roster_config')
      .select('slot_count')
      .eq('league_id', leagueId)
      .eq('position', 'TAXI')
      .maybeSingle(),
    supabase.from('teams').select('id, name').eq('league_id', leagueId),
    supabase
      .from('league_players')
      .select(
        'team_id, player_id, roster_slot, acquired_at, promoted_from_taxi, players!inner(name, draft_year)',
      )
      .eq('league_id', leagueId)
      .lte('acquired_at', nowIso),
    supabase
      .from('draft_picks')
      .select('player_id, pick_number, drafts!inner(type)')
      .eq('league_id', leagueId)
      .eq('season', league.season ?? '')
      .eq('drafts.type', 'rookie')
      .not('player_id', 'is', null),
  ]);

  // Every read must throw, not degrade. A failed taxi-config read would fall
  // back to leagues.taxi_slots — which replace_roster_config never updates, so
  // it's usually 0 — turning a plan that should STASH players into one that
  // DROPS them. Drops are irreversible, so a transient read failure must abort
  // the whole run and let tomorrow's cron retry.
  if (taxiErr) throw taxiErr;
  if (teamsErr) throw teamsErr;
  if (rosterErr) throw rosterErr;
  if (picksErr) throw picksErr;

  // Pick numbers only ever break an `acquired_at` tie, which happens within a
  // single offline-published draft class — so the current season's picks are
  // all that matter.
  const pickByPlayer = new Map<string, number>();
  for (const row of rookiePicks ?? []) {
    const pid = row.player_id as string | null;
    const pick = row.pick_number as number | null;
    if (!pid || pick === null) continue;
    const existing = pickByPlayer.get(pid);
    if (existing === undefined || pick > existing) pickByPlayer.set(pid, pick);
  }

  const rosterByTeam = new Map<string, CutsCandidate[]>();
  for (const row of rosterRows ?? []) {
    const player = row.players as unknown as { name: string; draft_year: number | null } | null;
    const candidate: CutsCandidate = {
      player_id: row.player_id as string,
      name: player?.name ?? 'Unknown player',
      roster_slot: row.roster_slot as string | null,
      acquired_at: row.acquired_at as string,
      promoted_from_taxi: !!row.promoted_from_taxi,
      draft_year: player?.draft_year ?? null,
      rookie_pick_number: pickByPlayer.get(row.player_id as string) ?? null,
    };
    const teamId = row.team_id as string | null;
    if (!teamId) continue;
    const list = rosterByTeam.get(teamId);
    if (list) list.push(candidate);
    else rosterByTeam.set(teamId, [candidate]);
  }

  const config: CutsPlanConfig = {
    rosterSize: league.roster_size ?? 13,
    taxiSeats: taxiConfig?.slot_count ?? league.taxi_slots ?? 0,
    taxiMaxExperience: league.taxi_max_experience ?? null,
    currentSeason: league.season ?? '',
  };

  return {
    leagueName: league.name ?? 'Your League',
    config,
    teams: (teams ?? []).map((t) => ({
      teamId: t.id as string,
      teamName: (t.name as string) ?? 'Team',
      roster: rosterByTeam.get(t.id as string) ?? [],
    })),
  };
}

/** Human-readable date for push copy / confirm dialogs, e.g. "Aug 12". */
export function formatDeadline(isoDate: string): string {
  return new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/**
 * Trailing sentence appended to the rookie-draft-completion push, naming the
 * freshly armed cuts deadline. Piggybacking on that push means teams learn the
 * deadline without a second notification. Empty string when nothing was armed
 * (non-dynasty, or a league whose deadline was already cleared).
 */
export function rosterCutsSentence(deadline: unknown): string {
  if (typeof deadline !== 'string' || !deadline) return '';
  return ` Roster cuts are due by ${formatDeadline(deadline)} — teams over the cap will have their newest additions stashed to taxi or dropped automatically.`;
}
