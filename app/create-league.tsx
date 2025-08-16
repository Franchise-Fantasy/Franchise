import { generateDraftPicks } from '@/lib/draft';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, Keyboard, StyleSheet, Text, TextInput, TouchableWithoutFeedback, View } from 'react-native';
import { supabase } from '../lib/supabase';

export default function CreateLeague() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [maxDraftYears, setMaxDraftYears] = useState('')
  const [teams, setTeams] = useState('') // Default to 10 teams
  const [loading, setLoading] = useState(false)
  const [rosterSize, setRosterSize] = useState('')

  const handleCreateLeague = async () => {
    if (!name.trim()) {
      Alert.alert('Please enter a league name.')
      return
    }

    setLoading(true)

    const user = (await supabase.auth.getUser()).data.user
    if (!user) {
      Alert.alert('User not logged in.')
      return
    }

    // Start a Supabase transaction to create both league and draft
    const { data: leagueData, error: leagueError } = await supabase
      .from('leagues')
      .insert({
        name, 
        created_by: user.id,
        max_future_seasons: parseInt(maxDraftYears, 10),
        teams: parseInt(teams),
        roster_size: parseInt(rosterSize),
        private: false

      })
      .select()
      .single();

    if (leagueError) {
      console.error(leagueError)
      Alert.alert('Failed to create league.')
      setLoading(false)
      return 
    }

    // Create the initial draft
    const { data: draftData, error: draftError } = await supabase
      .from('drafts')
      .insert({
        league_id: leagueData.id,
        season: '2025',
        type: 'initial',
        status: 'unscheduled',
        rounds: parseInt(teams),
        picks_per_round: parseInt(rosterSize)
      })
      .select()
      .single();

    if (draftError) {
      console.error(draftError)
      Alert.alert('League created but failed to create draft.')
      setLoading(false)
      return
    }

    // Generate draft picks in the background
    generateDraftPicks(draftData.id, parseInt(teams), parseInt(rosterSize), '2025', leagueData.id)
      .catch(error => console.error('Error generating draft picks:', error));

    // Navigate immediately without waiting for pick generation
    setLoading(false);
    router.push({
      pathname: '/create-team',
      params: { 
        leagueId: leagueData.id,
        isCommissioner: 'true' 
      }
    })
  }

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
      <View style={styles.container}>
        <Text style={styles.heading}>Create a New League</Text>

        <TextInput
          style={styles.input}
          placeholder="League Name"
          value={name}
          onChangeText={setName}
        />

        <TextInput
          style={styles.input}
          placeholder="Number of Teams (e.g. 10)"
          keyboardType="number-pad"
          value={teams}
          onChangeText={setTeams}
          returnKeyType="done"
        />

        <TextInput
          style={styles.input}
          placeholder="Max Future Draft Years (e.g. 5)"
          keyboardType="number-pad"
          value={maxDraftYears}
          onChangeText={setMaxDraftYears}
          returnKeyType="done"
        />

        <TextInput
          style={styles.input}
          placeholder="Roster Size (e.g. 20)"
          keyboardType="number-pad"
          value={rosterSize}
          onChangeText={setRosterSize}
          returnKeyType="done"
        />

        <Button title={loading ? 'Creating...' : 'Create League'} onPress={handleCreateLeague} disabled={loading} />
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


export const options = { 
    headerShown: false,
  };