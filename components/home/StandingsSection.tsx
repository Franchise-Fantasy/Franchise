import { supabase } from '@/lib/supabase';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useQuery } from '@tanstack/react-query';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { ThemedText } from '../ThemedText';

interface TeamStanding {
  id: string;
  name: string;
  wins: number;
  losses: number;
}

export function StandingsSection({ leagueId }: { leagueId: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

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
      return data.map((team, index) => ({
        ...team,
        rank: index + 1
      }));
    },
    enabled: !!leagueId
  });

  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Standings</ThemedText>
      <View style={styles.standings}>
        {isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : !standings?.length ? (
          <View style={styles.placeholder}>
            <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
              No standings available yet
            </ThemedText>
          </View>
        ) : (
          standings.map(team => (
            <View key={team.id} style={[styles.standingRow, { borderBottomColor: c.border }]}>
              <ThemedText style={[styles.rank, { color: c.secondaryText }]}>{team.rank}</ThemedText>
              <ThemedText style={styles.teamName}>{team.name}</ThemedText>
              <ThemedText style={[styles.record, { color: c.secondaryText }]}>
                {team.wins}-{team.losses}
              </ThemedText>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 2,
    marginBottom: 16,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  standings: { marginTop: 4 },
  standingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rank: { width: 30 },
  teamName: { flex: 1 },
  record: {},
  placeholder: { padding: 20, alignItems: 'center' },
  placeholderText: { fontSize: 14 },
  loading: { marginTop: 16 }
});