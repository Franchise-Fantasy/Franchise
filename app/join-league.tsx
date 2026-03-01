import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface League {
  id: string;
  name: string;
  created_by: string;
  teams: number;
  current_teams: number | null;
  imported_from: string | null;
}

export default function JoinLeagueScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);

  const { data: leagues, isLoading } = useQuery({
    queryKey: ['public-leagues'],
    queryFn: async () => {
      const user = (await supabase.auth.getUser()).data.user;

      const [leaguesResult, myTeamsResult] = await Promise.all([
        supabase
          .from('leagues')
          .select('id, name, created_by, teams, current_teams, imported_from')
          .eq('private', false)
          .order('created_at', { ascending: false }),
        user
          ? supabase.from('teams').select('league_id').eq('user_id', user.id)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (leaguesResult.error) throw leaguesResult.error;
      if (myTeamsResult.error) throw myTeamsResult.error;

      const myLeagueIds = new Set((myTeamsResult.data ?? []).map(t => t.league_id));

      return (leaguesResult.data as League[]).filter(
        l => (l.current_teams ?? 0) < l.teams && !myLeagueIds.has(l.id)
      );
    }
  });

  const handleJoinByCode = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setJoining(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        Alert.alert('Error', 'You must be logged in to join a league.');
        return;
      }

      const { data: league, error } = await supabase
        .from('leagues')
        .select('id, name, teams, current_teams, imported_from')
        .eq('invite_code', trimmed)
        .maybeSingle();

      if (error || !league) {
        Alert.alert('Invalid Code', 'No league found with that invite code.');
        return;
      }

      if ((league.current_teams ?? 0) >= league.teams) {
        Alert.alert('League Full', 'This league already has the maximum number of teams.');
        return;
      }

      const { data: existingTeam } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', league.id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (existingTeam) {
        Alert.alert('Already Joined', 'You already have a team in this league.');
        return;
      }

      // Imported leagues: claim an existing team instead of creating a new one
      if (league.imported_from) {
        const { data: unclaimed } = await supabase
          .from('teams')
          .select('id')
          .eq('league_id', league.id)
          .is('user_id', null)
          .not('sleeper_roster_id', 'is', null)
          .limit(1);

        if (unclaimed && unclaimed.length > 0) {
          router.push({
            pathname: '/claim-team',
            params: { leagueId: league.id, isCommissioner: 'false' },
          });
          return;
        }
      }

      router.push({
        pathname: '/create-team',
        params: { leagueId: league.id, isCommissioner: 'false' },
      });
    } catch (err) {
      console.error('Error joining by code:', err);
      Alert.alert('Error', 'Something went wrong. Please try again.');
    } finally {
      setJoining(false);
    }
  };

  const handleJoinLeague = async (league: League) => {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        Alert.alert('Error', 'You must be logged in to join a league');
        return;
      }

      // Imported leagues: claim an existing team
      if (league.imported_from) {
        const { data: unclaimed } = await supabase
          .from('teams')
          .select('id')
          .eq('league_id', league.id)
          .is('user_id', null)
          .not('sleeper_roster_id', 'is', null)
          .limit(1);

        if (unclaimed && unclaimed.length > 0) {
          router.push({
            pathname: '/claim-team',
            params: { leagueId: league.id, isCommissioner: 'false' },
          });
          return;
        }
      }

      router.push({
        pathname: '/create-team',
        params: { leagueId: league.id, isCommissioner: 'false' },
      });
    } catch (error) {
      console.error('Error joining league:', error);
      Alert.alert('Error', 'Failed to join league');
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <ThemedText type="title" style={styles.header} accessibilityRole="header">Join a League</ThemedText>

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {/* Invite code section */}
        <View style={[styles.codeSection, { backgroundColor: c.cardAlt }]}>
          <ThemedText type="subtitle" accessibilityRole="header">Have an invite code?</ThemedText>
          <View style={styles.codeInputRow}>
            <TextInput
              style={[styles.codeInput, { borderColor: c.border, backgroundColor: c.input, color: c.text }]}
              placeholder="Enter code"
              placeholderTextColor={c.secondaryText}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase())}
              autoCapitalize="characters"
              maxLength={8}
              returnKeyType="go"
              onSubmitEditing={handleJoinByCode}
              accessibilityLabel="League invite code"
              accessibilityHint="Enter the invite code to join a private league"
            />
            <TouchableOpacity
              style={[styles.joinBtn, { backgroundColor: code.trim().length > 0 ? c.accent : c.border }]}
              onPress={handleJoinByCode}
              disabled={!code.trim() || joining}
              accessibilityRole="button"
              accessibilityLabel={joining ? 'Joining league' : 'Join league with code'}
              accessibilityState={{ disabled: !code.trim() || joining }}
            >
              <Text style={[styles.joinBtnText, { color: code.trim().length > 0 ? c.accentText : c.secondaryText }]}>
                {joining ? '...' : 'Join'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          <ThemedText style={[styles.dividerText, { color: c.secondaryText }]}>OR</ThemedText>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
        </View>

        {/* Public leagues */}
        <ThemedText type="subtitle" style={styles.publicTitle} accessibilityRole="header">Public Leagues</ThemedText>

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
              onPress={() => handleJoinLeague(league)}
              accessibilityRole="button"
              accessibilityLabel={`${league.name}, ${league.current_teams ?? 0} of ${league.teams} teams`}
              accessibilityHint="Join this league"
            >
              <ThemedText type="subtitle">{league.name}</ThemedText>
              <ThemedText style={[styles.leagueInfo, { color: c.secondaryText }]}>
                Teams: {league.current_teams ?? 0}/{league.teams}
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
  codeSection: {
    padding: 16,
    borderRadius: 10,
    marginBottom: 16,
  },
  codeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  codeInput: {
    flex: 1,
    borderWidth: 1,
    padding: 12,
    borderRadius: 8,
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 2,
    textAlign: 'center',
  },
  joinBtn: {
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
  },
  joinBtnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    marginHorizontal: 12,
    fontSize: 13,
    fontWeight: '600',
  },
  publicTitle: {
    marginBottom: 12,
  },
  loading: { marginTop: 20 },
  emptyState: { padding: 20, alignItems: 'center' },
  leagueCard: { padding: 16, borderRadius: 8, marginBottom: 12 },
  leagueInfo: { marginTop: 4, fontSize: 14 },
});

export const options = {
  headerShown: false,
};
