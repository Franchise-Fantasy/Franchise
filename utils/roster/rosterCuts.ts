import { supabase } from "@/lib/supabase";

import {
  computeCutsPlan,
  type CutsCandidate,
  type CutsPlan,
  type CutsPlanConfig,
} from "@/utils/roster/rosterCutsShared";

export { computeCutsPlan, type CutsCandidate, type CutsPlan, type CutsPlanConfig };

export interface TeamCutsPlan extends CutsPlan {
  teamId: string;
  teamName: string;
}

/**
 * Client half of the shared roster-cuts core (rosterCutsShared.ts, which
 * documents the rules). Mirrors utils/roster/overCap.ts: pure planning lives in
 * the shared file, this adds the module-supabase reads.
 *
 * The edge twin (supabase/functions/_shared/rosterCuts.ts) runs the same
 * `computeCutsPlan` over the same shape, so the at-risk players the GM sees in
 * OverCapBanner are exactly the ones enforce-roster-cuts will act on. Edit both
 * wrappers in the same commit — no scanner covers this pair.
 *
 * Future-dated rows are excluded (`acquired_at <= now()`) for parity with
 * fetchOverCapState — a deferred add isn't on the roster yet.
 */
async function fetchCutsInputs(leagueId: string, teamId?: string) {
  const nowIso = new Date().toISOString();

  let rosterQuery = supabase
    .from("league_players")
    .select(
      "team_id, player_id, roster_slot, acquired_at, promoted_from_taxi, players!inner(name, draft_year)",
    )
    .eq("league_id", leagueId)
    .lte("acquired_at", nowIso);
  if (teamId) rosterQuery = rosterQuery.eq("team_id", teamId);

  // Fetched first so `season` can scope the rookie-pick query below (that read
  // otherwise grows with every season the league has ever played).
  const { data: league, error: leagueErr } = await supabase
    .from("leagues")
    .select("roster_size, taxi_slots, taxi_max_experience, season")
    .eq("id", leagueId)
    .single();
  if (leagueErr) throw leagueErr;

  const [
    { data: taxiConfig, error: taxiErr },
    { data: teams, error: teamsErr },
    { data: rosterRows, error: rosterErr },
    { data: rookiePicks, error: picksErr },
  ] = await Promise.all([
    supabase
      .from("league_roster_config")
      .select("slot_count")
      .eq("league_id", leagueId)
      .eq("position", "TAXI")
      .maybeSingle(),
    supabase.from("teams").select("id, name").eq("league_id", leagueId),
    rosterQuery,
    supabase
      .from("draft_picks")
      .select("player_id, pick_number, drafts!inner(type)")
      .eq("league_id", leagueId)
      .eq("season", league?.season ?? "")
      .eq("drafts.type", "rookie")
      .not("player_id", "is", null),
  ]);

  // Every read must throw, not degrade — a failed taxi-config read would fall
  // back to leagues.taxi_slots (usually 0, since replace_roster_config never
  // updates it) and show the GM a drop plan where a stash plan was correct.
  if (taxiErr) throw taxiErr;
  if (teamsErr) throw teamsErr;
  if (rosterErr) throw rosterErr;
  if (picksErr) throw picksErr;

  const pickByPlayer = new Map<string, number>();
  for (const row of rookiePicks ?? []) {
    if (!row.player_id || row.pick_number === null) continue;
    const existing = pickByPlayer.get(row.player_id);
    if (existing === undefined || row.pick_number > existing) {
      pickByPlayer.set(row.player_id, row.pick_number);
    }
  }

  const rosterByTeam = new Map<string, CutsCandidate[]>();
  for (const row of rosterRows ?? []) {
    if (!row.team_id) continue;
    const player = row.players as unknown as {
      name: string;
      draft_year: number | null;
    } | null;
    const candidate: CutsCandidate = {
      player_id: row.player_id,
      name: player?.name ?? "Unknown player",
      roster_slot: row.roster_slot,
      acquired_at: row.acquired_at ?? nowIso,
      promoted_from_taxi: !!row.promoted_from_taxi,
      draft_year: player?.draft_year ?? null,
      rookie_pick_number: pickByPlayer.get(row.player_id) ?? null,
    };
    const list = rosterByTeam.get(row.team_id);
    if (list) list.push(candidate);
    else rosterByTeam.set(row.team_id, [candidate]);
  }

  // Taxi seats come from league_roster_config, not leagues.taxi_slots:
  // replace_roster_config rewrites the config rows but never that column, and
  // the roster page renders its taxi section from the config.
  const config: CutsPlanConfig = {
    rosterSize: league?.roster_size ?? 13,
    taxiSeats: taxiConfig?.slot_count ?? league?.taxi_slots ?? 0,
    taxiMaxExperience: league?.taxi_max_experience ?? null,
    currentSeason: league?.season ?? "",
  };

  return { config, teams: teams ?? [], rosterByTeam };
}

/** The cuts plan for one team — powers the OverCapBanner at-risk preview. */
export async function fetchTeamCutsPlan(
  leagueId: string,
  teamId: string,
): Promise<CutsPlan> {
  const { config, rosterByTeam } = await fetchCutsInputs(leagueId, teamId);
  return computeCutsPlan(rosterByTeam.get(teamId) ?? [], config);
}

/**
 * Cuts plans for every over-cap team in the league, for the commissioner's
 * Start Season confirm dialog. Teams already at or under the cap are omitted.
 */
export async function fetchLeagueCutsPlans(
  leagueId: string,
): Promise<TeamCutsPlan[]> {
  const { config, teams, rosterByTeam } = await fetchCutsInputs(leagueId);
  return teams
    .map((t) => ({
      teamId: t.id,
      teamName: t.name ?? "Team",
      ...computeCutsPlan(rosterByTeam.get(t.id) ?? [], config),
    }))
    .filter((p) => p.overBy > 0);
}
