import { supabase } from '@/lib/supabase';

export async function generateDraftPicks(
  draftId: string, 
  numberOfTeams: number, 
  roundsCount: number,
  season: string,
  leagueId: string
) {
  const picks = [];
  
  // Generate snake draft picks with slot numbers
  for (let round = 1; round <= roundsCount; round++) {
    // Forward rounds (1,3,5...)
    if (round % 2 === 1) {
      for (let slot = 1; slot <= numberOfTeams; slot++) {
        picks.push({
          league_id: leagueId,
          draft_id: draftId,
          season: season,
          round: round,
          pick_number: ((round - 1) * numberOfTeams) + slot,
          slot_number: slot // Team with slot 1 picks first in odd rounds
        });
      }
    } 
    // Snake rounds (2,4,6...)
    else {
      for (let slot = numberOfTeams; slot >= 1; slot--) {
        picks.push({
          league_id: leagueId,
          draft_id: draftId,
          season: season,
          round: round,
          pick_number: ((round - 1) * numberOfTeams) + (numberOfTeams - slot + 1),
          slot_number: slot // Team with slot 1 picks last in even rounds
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
      await assignDraftSlots(draft.id, teams.map(team => team.id));
      
      // Update draft status
  
    }
  }
}