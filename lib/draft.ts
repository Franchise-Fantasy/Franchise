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
 */
export async function generateFutureDraftPicks(
  leagueId: string,
  numberOfTeams: number,
  roundsCount: number,
  currentSeason: string,
  maxFutureSeasons: number,
) {
  const startYear = parseInt(currentSeason.split('-')[0], 10);
  const picks = [];

  for (let offset = 1; offset <= maxFutureSeasons; offset++) {
    const futureStart = startYear + offset;
    const futureEnd = (futureStart + 1) % 100;
    const season = `${futureStart}-${String(futureEnd).padStart(2, '0')}`;

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
  // Check the league's initial_draft_order setting
  const { data: league } = await supabase
    .from('leagues')
    .select('initial_draft_order')
    .eq('id', leagueId)
    .single();

  // If manual, skip auto-assignment — commissioner will set order later
  if (league?.initial_draft_order === 'manual') return;

  // Get the draft ID
  const { data: draft } = await supabase
    .from('drafts')
    .select('id')
    .eq('league_id', leagueId)
    .eq('type', 'initial')
    .single();

  if (draft) {
    // Get all teams in the league
    const { data: teams } = await supabase
      .from('teams')
      .select('id')
      .eq('league_id', leagueId);

    if (teams) {
      const teamIds = teams.map(team => team.id);

      // Shuffle once and reuse for both draft and future picks
      const shuffledTeams = [...teamIds].sort(() => Math.random() - 0.5);

      await assignDraftSlots(draft.id, shuffledTeams);
      await assignFutureSlots(leagueId, shuffledTeams);
    }
  }
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