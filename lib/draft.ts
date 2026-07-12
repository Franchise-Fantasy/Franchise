import { formatSeason, type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';

export type BuiltPick = {
  season: string;
  round: number;
  slot_number: number;
  pick_number?: number;
};

/**
 * Pure: lay out an initial draft's picks. Snake rounds reverse the slot order,
 * so slot 1 picks last in round 2. No DB access — the caller decides whether to
 * insert them or hand them to `replace_draft_picks`.
 */
export function buildDraftPicks(
  numberOfTeams: number,
  roundsCount: number,
  season: string,
  draftType: 'snake' | 'linear' = 'snake',
): BuiltPick[] {
  const picks: BuiltPick[] = [];

  for (let round = 1; round <= roundsCount; round++) {
    const isSnakeReverse = draftType === 'snake' && round % 2 === 0;

    for (let slot = 1; slot <= numberOfTeams; slot++) {
      picks.push({
        season,
        round,
        slot_number: slot,
        pick_number:
          (round - 1) * numberOfTeams +
          (isSnakeReverse ? numberOfTeams - slot + 1 : slot),
      });
    }
  }

  return picks;
}

/**
 * Pure: lay out placeholder picks for each future season. These carry no
 * draft_id (the draft doesn't exist yet) and no pick_number — ownership and
 * ordering are assigned later.
 *
 * `sport` is required so the season string matches the rest of the app (NBA
 * two-year "2027-28" vs WNBA single-year "2027"). Without it, WNBA picks were
 * stored in NBA format and silently filtered out by every consumer.
 */
export function buildFutureDraftPicks(
  numberOfTeams: number,
  roundsCount: number,
  currentSeason: string,
  maxFutureSeasons: number,
  sport: Sport,
): BuiltPick[] {
  const startYear = parseInt(currentSeason.split('-')[0], 10);
  const picks: BuiltPick[] = [];

  for (let offset = 1; offset <= maxFutureSeasons; offset++) {
    const season = formatSeason(startYear + offset, sport);
    for (let round = 1; round <= roundsCount; round++) {
      for (let slot = 1; slot <= numberOfTeams; slot++) {
        picks.push({ season, round, slot_number: slot });
      }
    }
  }

  return picks;
}

export async function generateDraftPicks(
  draftId: string,
  numberOfTeams: number,
  roundsCount: number,
  season: string,
  leagueId: string,
  draftType: 'snake' | 'linear' = 'snake'
) {
  const picks = buildDraftPicks(numberOfTeams, roundsCount, season, draftType).map((p) => ({
    ...p,
    league_id: leagueId,
    draft_id: draftId,
  }));

  // One statement, so a draft never ends up with only some of its picks. The
  // old chunked loop committed each 100-row batch separately.
  await supabase.from('draft_picks').insert(picks).throwOnError();
}

export async function generateFutureDraftPicks(
  leagueId: string,
  numberOfTeams: number,
  roundsCount: number,
  currentSeason: string,
  maxFutureSeasons: number,
  sport: Sport,
) {
  const picks = buildFutureDraftPicks(
    numberOfTeams,
    roundsCount,
    currentSeason,
    maxFutureSeasons,
    sport,
  ).map((p) => ({ ...p, league_id: leagueId }));

  await supabase.from('draft_picks').insert(picks).throwOnError();
}

export async function checkAndAssignDraftSlots(leagueId: string) {
  // Slot assignment runs server-side (assign_initial_draft_slots) because it
  // must write EVERY team's picks in one shot. The draft_picks UPDATE policy
  // only lets a member touch their own (or unassigned) picks, so a client-side
  // shuffle by the last joiner would be blocked from assigning other teams'
  // picks. The RPC no-ops unless the league is full, the order isn't manual,
  // and the draft hasn't started — matching the previous client behavior.
  const { error } = await supabase.rpc('assign_initial_draft_slots', {
    p_league_id: leagueId,
  });
  if (error) throw error;
}

/**
 * Commissioner manually sets the draft order via an ordered list of team IDs.
 *
 * A draft order is a permutation — half of one isn't "most of a draft order",
 * it's a corrupt one (two teams on slot 3, nobody on slot 7). This used to be
 * 2N independent UPDATEs fired through Promise.all, across the initial draft's
 * picks and the future-season picks; now it's one transaction.
 */
export async function manuallyAssignDraftSlots(
  leagueId: string,
  draftId: string,
  orderedTeamIds: string[]
) {
  const { error } = await supabase.rpc('assign_draft_slots_manual', {
    p_league_id: leagueId,
    p_draft_id: draftId,
    p_team_ids: orderedTeamIds,
  });
  if (error) throw error;
}

/**
 * Commissioner-only: re-order an imported dynasty league's UPCOMING rookie
 * draft, before it's been created (the seeded picks still have no draft_id).
 * Fixes a wrong reverse-standings / lottery order that was entered during the
 * import.
 *
 * The order is defined by `original_team_id` → `slot_number`. A pick that was
 * traded keeps its `current_team_id` (the new owner) and simply travels to its
 * original team's new slot, so trades survive the reorder. The same order is
 * applied to every round with linear pick numbering, matching the import seed
 * (`buildSeasonPicks`); the snake reversal, if any, happens at draft time.
 *
 * `create-rookie-draft` links these picks to the draft without recomputing
 * slot/pick numbers (except from staged lottery assignments, which don't exist
 * for reverse-record / lottery-done imports), so the new order sticks.
 *
 * One transaction. This used to fetch every pick and fire a chunked
 * Promise.all of per-pick UPDATEs — a failed chunk left the early rounds on the
 * new order and the rest on the old one.
 */
export async function reorderRookieDraftPicks(
  leagueId: string,
  season: string,
  orderedOriginalTeamIds: string[],
) {
  if (orderedOriginalTeamIds.length === 0) return;

  const { error } = await supabase.rpc('reorder_rookie_draft_picks', {
    p_league_id: leagueId,
    p_season: season,
    p_team_ids: orderedOriginalTeamIds,
  });
  if (error) throw error;
}