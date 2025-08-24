import { AvailablePlayers } from '@/components/draft/AvailablePlayers';
import { DraftOrder } from '@/components/draft/DraftOrder';
import { TeamRoster } from '@/components/draft/TeamRoster';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { supabase } from '@/lib/supabase';
import { CurrentPick } from '@/types/draft';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type ViewMode = 'players' | 'roster';



export default function DraftRoomScreen() {
  const { id: draftId } = useLocalSearchParams<{ id: string }>();
  const [viewMode, setViewMode] = useState<ViewMode>('players');
  const [currentPick, setCurrentPick] = useState<CurrentPick | null>(null);

  // First, get the league ID from the draft
  const { data: draftData } = useQuery({
    queryKey: ['draft', draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('league_id')
        .eq('id', draftId)
        .single();

      if (error) throw error;
      return data;
    }
  });

  // Then, use the league ID to get the user's team
  const { data: teamData, isLoading: isLoadingTeam } = useQuery({
    queryKey: ['myTeam', draftData?.league_id],
    queryFn: async () => {
      if (!draftData?.league_id) return null;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.from('teams').select('id').eq('league_id', draftData.league_id).eq('user_id', user.id).single();
      if (error) throw error;
      return data;
    },
    enabled: !!draftData?.league_id
  });



  return (
    <SafeAreaView style={styles.container}>
      <ThemedView style={styles.header}>
        <TouchableOpacity 
          style={styles.headerButton} 
          onPress={() => router.back()}
        >
          <ThemedText style={styles.backButton}>←</ThemedText>
        </TouchableOpacity>
        
        <ThemedText type="title" style={styles.headerText}>
          Draft Room
        </ThemedText>
        
        <View style={styles.headerButton} />
      </ThemedView>

      <View style={styles.content}>
        <DraftOrder 
          draftId={draftId}
          onCurrentPickChange={setCurrentPick}
          leagueId={draftData?.league_id || ''}
          teamId={teamData?.id || ''} 
        />

        {/* Toggle Buttons */}
        <View style={styles.toggleContainer}>
          <TouchableOpacity 
            style={[
              styles.toggleButton,
              viewMode === 'players' && styles.toggleActive
            ]}
            onPress={() => setViewMode('players')}
          >
            <ThemedText style={[
              styles.toggleText,
              viewMode === 'players' && styles.toggleTextActive
            ]}>
              Available Players
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[
              styles.toggleButton,
              viewMode === 'roster' && styles.toggleActive
            ]}
            onPress={() => setViewMode('roster')}
          >
            <ThemedText style={[
              styles.toggleText,
              viewMode === 'roster' && styles.toggleTextActive
            ]}>
              My Team
            </ThemedText>
          </TouchableOpacity>
        </View>

        {/* Main Content Area - now passes currentPick */}
        <View style={styles.mainContent}>
          {viewMode === 'players' ? (
            <AvailablePlayers 
              draftId={draftId} // Correct - using draft ID
              currentPick={currentPick}
              teamId={teamData?.id || ''} 
              leagueId={draftData?.league_id || ''}
            />
          ) : (
            <TeamRoster draftId={draftId}
             teamId= {teamData?.id || ''} // Correct - using draft ID
            />
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ccc',
    backgroundColor: 'white',
    alignItems: 'center',
    height: 50,
    justifyContent: 'space-between',
  },
  headerText: {
    flex: 1,
    textAlign: 'center',
    fontSize: 20,
    fontWeight: 'thin',
    marginHorizontal: 40,
  },
  headerButton: {
    padding: 8,
    width: 36,
    alignItems: 'center',
  },
  content: {
    flex: 1,
  },
  toggleContainer: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: 1,
    borderColor: '#eee',
  },
  toggleButton: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    borderRadius: 8,
  },
  toggleActive: {
    backgroundColor: '#e6f3ff',
  },
  toggleText: {
    color: '#666',
  },
  toggleTextActive: {
    color: '#0066cc',
    fontWeight: 'bold',
  },
  mainContent: {
    flex: 1,
  },
  backButton: {
    fontSize: 24,
    color: '#0066cc',
  },
});