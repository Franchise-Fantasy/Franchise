import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';

interface TeamStanding {
  id: string;
  name: string;
  wins: number;
  losses: number;
}

export function StandingsSection({ leagueId }: { leagueId: string }) {
  const { data: standings, isLoading } = useQuery({
    queryKey: ['standings', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, wins, losses')
        .eq('league_id', leagueId)
        .order('wins', { ascending: false });

      if (error) throw error;
        console.log('[StandingsSection] Fetched standings:', data); 
      // Add rank to each team based on position in array
      return data.map((team, index) => ({
        ...team,
        rank: index + 1
      }));
    },
    enabled: !!leagueId
  });

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="subtitle">Standings</ThemedText>
      <View style={styles.standings}>
        {isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : !standings?.length ? (
          <View style={styles.placeholder}>
            <ThemedText style={styles.placeholderText}>
              No standings available yet
            </ThemedText>
          </View>
        ) : (
          standings.map(team => (
            <View key={team.id} style={styles.standingRow}>
              <ThemedText style={styles.rank}>{team.rank}</ThemedText>
              <ThemedText style={styles.teamName}>{team.name}</ThemedText>
              <ThemedText style={styles.record}>
                {team.wins}-{team.losses}
              </ThemedText>
            </View>
          ))
        )}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
    padding: 16,
  },
  standings: {
    marginTop: 8,
  },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  rank: {
    width: 30,
    color: '#666',
  },
  teamName: {
    flex: 1,
  },
  record: {
    color: '#666',
  },
  placeholder: {
    padding: 20,
    alignItems: 'center',
  },
  placeholderText: {
    color: '#999',
    fontSize: 14,
  },
  loading: {
    marginTop: 16,
  }
});