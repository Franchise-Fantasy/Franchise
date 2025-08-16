import { supabase } from './supabase'

export async function getAvailablePlayers(leagueId: string) {
  const { data, error } = await supabase
    .from('league_players')
    .select('id, player_id, players(name, position, nba_team)')
    .eq('league_id', leagueId)
    .is('team_id', null)

  if (error) throw error
  return data
}

export async function draftPlayer({
    leaguePlayerId,
    teamId,
    draftPickId,
    playerId,
  }: {
    leaguePlayerId: string
    teamId: string
    draftPickId: string
    playerId: string
  }) {
    const { error: lpError } = await supabase
      .from('league_players')
      .update({
        team_id: teamId,
        acquired_via: 'draft',
        acquired_at: new Date().toISOString(),
      })
      .eq('id', leaguePlayerId)
  
    const { error: dpError } = await supabase
      .from('draft_picks')
      .update({
        player_id: playerId,
        selected_at: new Date().toISOString(),
      })
      .eq('id', draftPickId)
  
    const { data: txData, error: txError } = await supabase
      .from('league_transactions')
      .insert({
        league_id: '00000000-0000-0000-0000-000000000001', // temp
        type: 'draft',
        notes: `Player drafted by team ${teamId}`,
      })
      .select()
      .single()
  
    const { error: itemError } = await supabase
      .from('league_transaction_items')
      .insert({
        transaction_id: txData.id,
        player_id: playerId,
        team_to_id: teamId,
      })
  
    if (lpError || dpError || txError || itemError) {
      throw lpError || dpError || txError || itemError
    }
  }
  