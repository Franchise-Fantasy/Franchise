import { PlayerCard } from '@/components/player/PlayerCard';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function RosterScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);

  const { data: scoringWeights } = useLeagueScoring(leagueId ?? '');

  const { data: rosterPlayers, isLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: ['teamRoster', teamId],
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('team_id', teamId!)
        .eq('league_id', leagueId!);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map(lp => lp.player_id);

      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    enabled: !!teamId && !!leagueId,
  });

  const renderPlayer = ({ item }: { item: PlayerSeasonStats }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : undefined;

    return (
      <PlayerCard
        player={item}
        fantasyPoints={fpts}
        onPress={() => setSelectedPlayer(item)}
      />
    );
  };

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <ActivityIndicator style={styles.loading} />
      </SafeAreaView>
    );
  }

  if (!rosterPlayers || rosterPlayers.length === 0) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <View style={styles.empty}>
          <ThemedText style={{ color: c.secondaryText }}>No players on your roster yet.</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <View style={styles.section}>
        <ThemedText type="subtitle" style={styles.sectionTitle}>My Roster</ThemedText>
        <ThemedView style={[styles.sectionContent, { backgroundColor: c.card }]}>
          <FlatList<PlayerSeasonStats>
            data={rosterPlayers}
            renderItem={renderPlayer}
            keyExtractor={(item) => item.player_id}
            scrollEnabled={false}
          />
        </ThemedView>
      </View>
      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId ?? ''}
        onClose={() => setSelectedPlayer(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  section: { padding: 16 },
  sectionTitle: { marginBottom: 8 },
  sectionContent: {
    borderRadius: 8,
    padding: 4,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
