import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface League {
  id: string;
  name: string;
  created_by: string;
  teams: number;
}

export default function JoinLeagueScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: leagues, isLoading } = useQuery({
    queryKey: ['public-leagues'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('id, name, created_by, teams')
        .eq('private', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as League[];
    }
  });

  const handleJoinLeague = async (leagueId: string) => {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        Alert.alert('Error', 'You must be logged in to join a league');
        return;
      }

      router.push({
        pathname: '/create-team',
        params: { 
          leagueId,
          isCommissioner: 'false'
        }
      });

    } catch (error) {
      console.error('Error joining league:', error);
      Alert.alert('Error', 'Failed to join league');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <ThemedText type="title" style={styles.header}>Join a League</ThemedText>
      
      <ScrollView style={styles.content}>
        {isLoading ? (
          <ActivityIndicator style={styles.loading} />
        ) : !leagues?.length ? (
          <ThemedView style={styles.emptyState}>
            <ThemedText>No public leagues available</ThemedText>
          </ThemedView>
        ) : (
          leagues.map(league => (
            <TouchableOpacity
              key={league.id}
              style={[styles.leagueCard, { backgroundColor: c.cardAlt }]}
              onPress={() => handleJoinLeague(league.id)}
            >
              <ThemedText type="subtitle">{league.name}</ThemedText>
              <ThemedText style={[styles.leagueInfo, { color: c.secondaryText }]}>
                Teams: {league.teams}
              </ThemedText>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16, textAlign: 'center' },
  content: { flex: 1, padding: 16 },
  loading: { marginTop: 20 },
  emptyState: { padding: 20, alignItems: 'center' },
  leagueCard: { padding: 16, borderRadius: 8, marginBottom: 12 },
  leagueInfo: { marginTop: 4, fontSize: 14 }
});

export const options = { 
  headerShown: false,
};