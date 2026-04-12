import { FormSection } from '@/components/ui/FormSection';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { ms, s } from "@/utils/scale";
import { PageHeader } from '@/components/ui/PageHeader';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
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
  const { code: paramCode } = useLocalSearchParams<{ code?: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [code, setCode] = useState(paramCode?.toUpperCase() ?? '');
  const [joining, setJoining] = useState(false);
  const autoJoinTriggered = useRef(false);

  const { data: leagues, isLoading } = useQuery({
    queryKey: queryKeys.publicLeagues(),
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

  // Auto-trigger join when opened via deep link with a code param
  useEffect(() => {
    if (paramCode && !autoJoinTriggered.current) {
      autoJoinTriggered.current = true;
      handleJoinByCode();
    }
  }, [paramCode]);

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

  const slotsAvailable = (league: League) => league.teams - (league.current_teams ?? 0);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader title="Join a League" />

      <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
        {/* Invite code section */}
        <FormSection title="Invite Code">
          <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
            Enter the code your commissioner shared with you.
          </ThemedText>
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
              style={[styles.joinBtn, { backgroundColor: code.trim().length > 0 ? c.accent : c.buttonDisabled }]}
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
        </FormSection>

        {/* Divider */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          <ThemedText style={[styles.dividerText, { color: c.secondaryText }]}>OR</ThemedText>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
        </View>

        {/* Public leagues */}
        <ThemedText type="subtitle" style={styles.publicTitle} accessibilityRole="header">Public Leagues</ThemedText>

        {isLoading ? (
          <View style={styles.loading}><LogoSpinner /></View>
        ) : !leagues?.length ? (
          <View style={styles.emptyState}>
            <Ionicons name="people-outline" size={40} color={c.secondaryText} accessible={false} />
            <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
              No public leagues available
            </ThemedText>
          </View>
        ) : (
          leagues.map(league => (
            <TouchableOpacity
              key={league.id}
              style={[styles.leagueCard, { backgroundColor: c.card, borderColor: c.border }]}
              onPress={() => handleJoinLeague(league)}
              accessibilityRole="button"
              accessibilityLabel={`${league.name}, ${league.current_teams ?? 0} of ${league.teams} teams`}
              accessibilityHint="Join this league"
            >
              <View style={styles.leagueCardTop}>
                <ThemedText type="defaultSemiBold" style={styles.leagueName}>{league.name}</ThemedText>
                <Ionicons name="chevron-forward" size={18} color={c.secondaryText} accessible={false} />
              </View>
              <View style={styles.leagueCardMeta}>
                <View style={styles.leagueMetaItem}>
                  <Ionicons name="people-outline" size={14} color={c.secondaryText} accessible={false} />
                  <ThemedText style={[styles.leagueInfo, { color: c.secondaryText }]}>
                    {league.current_teams ?? 0}/{league.teams} teams
                  </ThemedText>
                </View>
                <View style={[styles.slotsBadge, { backgroundColor: c.accent + '18' }]}>
                  <ThemedText style={[styles.slotsText, { color: c.accent }]}>
                    {slotsAvailable(league)} {slotsAvailable(league) === 1 ? 'spot' : 'spots'} open
                  </ThemedText>
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    paddingHorizontal: s(16),
    paddingTop: s(16),
    paddingBottom: s(16),
  },
  hint: {
    fontSize: ms(13),
    marginBottom: s(10),
    lineHeight: ms(18),
  },
  codeInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  codeInput: {
    flex: 1,
    borderWidth: 1,
    padding: s(12),
    borderRadius: 8,
    fontSize: ms(18),
    fontWeight: '600',
    letterSpacing: 2,
    textAlign: 'center',
  },
  joinBtn: {
    paddingHorizontal: s(20),
    paddingVertical: s(12),
    borderRadius: 8,
  },
  joinBtnText: {
    fontSize: ms(16),
    fontWeight: '600',
  },
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: s(16),
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    marginHorizontal: s(12),
    fontSize: ms(13),
    fontWeight: '600',
  },
  publicTitle: {
    marginBottom: s(12),
  },
  loading: { marginTop: s(20) },
  emptyState: {
    paddingVertical: s(40),
    alignItems: 'center',
    gap: s(12),
  },
  emptyText: {
    fontSize: ms(15),
  },
  leagueCard: {
    padding: s(14),
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: s(10),
  },
  leagueCardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  leagueName: {
    fontSize: ms(16),
    flex: 1,
  },
  leagueCardMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: s(8),
  },
  leagueMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  leagueInfo: {
    fontSize: ms(13),
  },
  slotsBadge: {
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: 10,
  },
  slotsText: {
    fontSize: ms(12),
    fontWeight: '600',
  },
});
