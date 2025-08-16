import { useAppState } from '@/context/AppStateProvider'; // Fix the import path
import { checkAndAssignDraftSlots } from '@/lib/draft';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, Keyboard, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { supabase } from '../lib/supabase';

export default function CreateTeam() {
  const router = useRouter()
  const { leagueId, isCommissioner } = useLocalSearchParams()
  const [teamName, setTeamName] = useState('')
  const [loading, setLoading] = useState(false)
  const queryClient = useQueryClient();
  const { setTeamId, setLeagueId } = useAppState();

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      Alert.alert('Please enter a team name.')
      return
    }

    setLoading(true)

    try {
      const user = (await supabase.auth.getUser()).data.user
      if (!user) {
        Alert.alert('User not logged in.')
        return
      }

      // Start a transaction
      const { data: teamData, error: teamError } = await supabase
        .from('teams')
        .insert({
          name: teamName,
          league_id: leagueId,
          user_id: user.id,
          is_commissioner: isCommissioner === 'true'
        })
        .select()
        .single();

      if (teamError) throw teamError;

      // Increment current_teams and check if league is full
      const { data: incrementResult, error: incrementError } = await supabase
        .rpc('increment_team_count', { league_id: leagueId });

      if (incrementError) throw incrementError;

      // Get updated league data
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('current_teams, teams')
        .eq('id', leagueId)
        .single();

      if (leagueError) throw leagueError;

      // Update AppState context and navigate immediately
      setTeamId(teamData.id);
      setLeagueId(leagueId as string);
      router.replace('/(tabs)');

      // Run draft slot assignment in background if league is full
      if (league && league.current_teams === league.teams) {
        checkAndAssignDraftSlots(leagueId as string).catch(console.error);
      }

    } catch (error) {
      console.error(error);
      Alert.alert('Failed to create team.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <Text style={styles.heading}>Create Your Team</Text>

        <TextInput
          style={styles.input}
          placeholder="Team Name"
          value={teamName}
          onChangeText={setTeamName}
          returnKeyType="done"
        />

        <Button 
          title={loading ? 'Creating...' : 'Create Team'} 
          onPress={handleCreateTeam} 
          disabled={loading} 
        />
      </View>
    </TouchableWithoutFeedback>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#fff'
  },
  heading: {
    fontSize: 24,
    marginBottom: 16,
    textAlign: 'center',
    fontWeight: 'bold'
  },
  input: {
    borderColor: '#ccc',
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    borderRadius: 6
  }
})