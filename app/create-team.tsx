import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Button, Keyboard, StyleSheet, TextInput, TouchableWithoutFeedback } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { checkAndAssignDraftSlots } from '@/lib/draft';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from "@/utils/scale";

import { supabase } from '../lib/supabase';

export default function CreateTeam() {
  const router = useRouter()
  const params = useLocalSearchParams()
  const leagueId = String(params.leagueId ?? '')
  const isCommissioner = String(params.isCommissioner ?? 'false')
  const [teamName, setTeamName] = useState('')
  const [tricode, setTricode] = useState('')
  const [loading, setLoading] = useState(false)
  const queryClient = useQueryClient();
  const { switchLeague } = useAppState();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      Alert.alert('Please enter a team name.')
      return
    }
    if (containsBlockedContent(teamName)) {
      Alert.alert('Invalid name', 'That team name contains language that isn\u2019t allowed.');
      return;
    }
    const code = tricode.trim().toUpperCase();
    if (!code || code.length < 2 || code.length > 4 || !/^[A-Z0-9]+$/.test(code)) {
      Alert.alert('Tricode must be 2-4 characters (e.g. LAL, BOS).')
      return
    }

    setLoading(true)

    try {
      const user = (await supabase.auth.getUser()).data.user
      if (!user) {
        Alert.alert('User not logged in.')
        return
      }

      const { data: teamData, error: teamError } = await supabase
        .from('teams')
        .insert({
          name: teamName,
          tricode: code,
          league_id: leagueId,
          user_id: user.id,
          is_commissioner: isCommissioner === 'true'
        })
        .select()
        .single();

      if (teamError) throw teamError;

      const { data: incrementResult, error: incrementError } = await supabase
        .rpc('increment_team_count', { league_id: leagueId });

      if (incrementError) throw incrementError;

      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('current_teams, teams, faab_budget, division_count')
        .eq('id', leagueId)
        .single();

      if (leagueError) throw leagueError;

      // Initialize waiver priority for this team
      await supabase.from('waiver_priority').insert([{
        league_id: leagueId,
        team_id: teamData.id,
        priority: league.current_teams ?? undefined,
        faab_remaining: league.faab_budget ?? 100,
      }]);

      switchLeague(leagueId, teamData.id);
      router.replace('/(tabs)');

      if (league && league.current_teams === league.teams) {
        checkAndAssignDraftSlots(leagueId).catch(console.error);

        // Auto-assign divisions when league is full
        if (league.division_count === 2) {
          const { data: allTeams } = await supabase
            .from('teams')
            .select('id')
            .eq('league_id', leagueId as string)
            .order('id');

          if (allTeams && allTeams.length > 0) {
            // Shuffle teams randomly
            const shuffled = [...allTeams].sort(() => Math.random() - 0.5);
            const half = Math.ceil(shuffled.length / 2);
            const updates = shuffled.map((t, i) => ({
              id: t.id,
              division: (i < half ? 1 : 2) as 1 | 2,
            }));
            for (const u of updates) {
              await supabase.from('teams').update({ division: u.division }).eq('id', u.id);
            }
          }
        }
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
      <ThemedView style={styles.container}>
        <ThemedText type="title" style={styles.heading} accessibilityRole="header">Create Your Team</ThemedText>

        <TextInput
          style={[styles.input, { borderColor: c.border, backgroundColor: c.input, color: c.text }]}
          placeholder="Team Name"
          placeholderTextColor={c.secondaryText}
          value={teamName}
          onChangeText={setTeamName}
          returnKeyType="next"
          accessibilityLabel="Team name"
        />

        <TextInput
          style={[styles.input, { borderColor: c.border, backgroundColor: c.input, color: c.text }]}
          placeholder="Tricode (e.g. LAL, BOS)"
          placeholderTextColor={c.secondaryText}
          value={tricode}
          onChangeText={(t) => setTricode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4))}
          autoCapitalize="characters"
          maxLength={4}
          returnKeyType="done"
          onSubmitEditing={handleCreateTeam}
          accessibilityLabel="Team tricode"
          accessibilityHint="2 to 4 characters, letters and numbers only"
        />

        <Button
          title={loading ? 'Creating...' : 'Create Team'}
          onPress={handleCreateTeam}
          disabled={loading}
          accessibilityLabel={loading ? 'Creating team' : 'Create Team'}
        />
      </ThemedView>
    </TouchableWithoutFeedback>
  )
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    flex: 1,
    justifyContent: 'center',
  },
  heading: {
    marginBottom: 16,
    textAlign: 'center',
  },
  input: {
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    borderRadius: 6,
    fontSize: ms(16),
  }
})

export const options = { 
  headerShown: false,
};
