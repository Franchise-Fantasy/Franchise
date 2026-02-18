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
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

type ViewMode = 'players' | 'roster';



export default function DraftRoomScreen() {
  const colorScheme = useColorScheme() ?? 'light';
  const colors = Colors[colorScheme];
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
    <SafeAreaView style={[styles.container, { backgroundColor: colors.background }]}>
      <ThemedView style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity
          style={styles.headerButton}
          onPress={() => router.back()}
        >
          <ThemedText style={[styles.backButton, { color: colors.activeText }]}>←</ThemedText>
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

        {/* Main Content Area */}
        <View style={styles.mainContent}>
          {viewMode === 'players' ? (
            <AvailablePlayers
              draftId={draftId}
              currentPick={currentPick}
              teamId={teamData?.id || ''}
              leagueId={draftData?.league_id || ''}
            />
          ) : (
            <TeamRoster draftId={draftId}
             teamId={teamData?.id || ''}
            />
          )}
        </View>

        {/* Toggle Buttons — bottom bar */}
        <View style={[styles.toggleContainer, { borderTopColor: colors.border, backgroundColor: colors.background }]}>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              viewMode === 'players' && { backgroundColor: colors.activeCard }
            ]}
            onPress={() => setViewMode('players')}
          >
            <ThemedText style={[
              { color: colors.secondaryText },
              viewMode === 'players' && { color: colors.activeText, fontWeight: 'bold' }
            ]}>
              Available Players
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.toggleButton,
              viewMode === 'roster' && { backgroundColor: colors.activeCard }
            ]}
            onPress={() => setViewMode('roster')}
          >
            <ThemedText style={[
              { color: colors.secondaryText },
              viewMode === 'roster' && { color: colors.activeText, fontWeight: 'bold' }
            ]}>
              My Team
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    padding: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
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
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  mainContent: {
    flex: 1,
  },
  backButton: {
    fontSize: 24,
  },
});