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
  // Randomly shuffle team IDs
  const shuffledTeams = [...teamIds].sort(() => Math.random() - 0.5);

  // Assign each team to a slot number (1-N)
  const updates = shuffledTeams.map((teamId, index) => {
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
      await assignDraftSlots(draft.id, teamIds);

      // Also assign team ownership to future-season picks (no draft_id)
      // using the same slot mapping
      const shuffledTeams = [...teamIds].sort(() => Math.random() - 0.5);
      const futureUpdates = shuffledTeams.map((teamId, index) => {
        return supabase
          .from('draft_picks')
          .update({ current_team_id: teamId, original_team_id: teamId })
          .eq('league_id', leagueId)
          .is('draft_id', null)
          .eq('slot_number', index + 1);
      });
      await Promise.all(futureUpdates);
    }
  }
}