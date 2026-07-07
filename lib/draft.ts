import { formatSeason, type Sport } from '@/constants/LeagueDefaults';
import { supabase } from '@/lib/supabase';

export async function generateDraftPicks(
  draftId: string,
  numberOfTeams: number,
  roundsCount: number,
  season: string,
  leagueId: string,
  draftType: 'snake' | 'linear' = 'snake'
) {
  const picks = [];

  for (let round = 1; round <= roundsCount; round++) {
    const isSnakeReverse = draftType === 'snake' && round % 2 === 0;

    if (isSnakeReverse) {
      for (let slot = numberOfTeams; slot >= 1; slot--) {
        picks.push({
          league_id: leagueId,
          draft_id: draftId,
          season: season,
          round: round,
          pick_number: ((round - 1) * numberOfTeams) + (numberOfTeams - slot + 1),
          slot_number: slot
        });
      }
    } else {
      for (let slot = 1; slot <= numberOfTeams; slot++) {
        picks.push({
          league_id: leagueId,
          draft_id: draftId,
          season: season,
          round: round,
          pick_number: ((round - 1) * numberOfTeams) + slot,
          slot_number: slot
        });
      }
    }
  }

  // Insert all picks in chunks
  const chunkSize = 100;
  for (let i = 0; i < picks.length; i += chunkSize) {
    const chunk = picks.slice(i, i + chunkSize);
    await supabase
      .from('draft_picks')
      .insert(chunk)
      .throwOnError();
  }
}

/**
 * Generate placeholder draft_picks rows for future seasons.
 * These have no draft_id (the draft doesn't exist yet) and use slot_number
 * so that team ownership can be assigned later via assignDraftSlots.
 *
 * `sport` is required so the season string format matches the rest of the
 * app (NBA two-year "2027-28" vs WNBA single-year "2027"). Without it,
 * picks for WNBA leagues used to be stored as NBA-format and were silently
 * filtered out by every consumer (`useDraftHub`, `useTeamTradablePicks`).
 */
export async function generateFutureDraftPicks(
  leagueId: string,
  numberOfTeams: number,
  roundsCount: number,
  currentSeason: string,
  maxFutureSeasons: number,
  sport: Sport,
) {
  const startYear = parseInt(currentSeason.split('-')[0], 10);
  const picks = [];

  for (let offset = 1; offset <= maxFutureSeasons; offset++) {
    const season = formatSeason(startYear + offset, sport);

    for (let round = 1; round <= roundsCount; round++) {
      for (let slot = 1; slot <= numberOfTeams; slot++) {
        picks.push({
          league_id: leagueId,
          season,
          round,
          slot_number: slot,
        });
      }
    }
  }

  const chunkSize = 100;
  for (let i = 0; i < picks.length; i += chunkSize) {
    const chunk = picks.slice(i, i + chunkSize);
    await supabase.from('draft_picks').insert(chunk).throwOnError();
  }
}

export async function assignDraftSlots(draftId: string, teamIds: string[]) {
  // teamIds should already be shuffled by caller
  // Assign each team to a slot number (1-N)
  const updates = teamIds.map((teamId, index) => {
    return supabase
      .from('draft_picks')
      .update({ current_team_id: teamId, original_team_id: teamId })
      .eq('draft_id', draftId)
      .eq('slot_number', index + 1);
  });

  // Execute all updates concurrently
  await Promise.all(updates);
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

/** Assign team ownership to future-season picks (picks with no draft_id). */
async function assignFutureSlots(leagueId: string, orderedTeamIds: string[]) {
  const updates = orderedTeamIds.map((teamId, index) => {
    return supabase
      .from('draft_picks')
      .update({ current_team_id: teamId, original_team_id: teamId })
      .eq('league_id', leagueId)
      .is('draft_id', null)
      .eq('slot_number', index + 1);
  });
  await Promise.all(updates);
}

/** Commissioner manually sets the draft order via an ordered list of team IDs. */
export async function manuallyAssignDraftSlots(
  leagueId: string,
  draftId: string,
  orderedTeamIds: string[]
) {
  await assignDraftSlots(draftId, orderedTeamIds);
  await assignFutureSlots(leagueId, orderedTeamIds);
}