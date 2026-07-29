import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/Badge';
import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import {
  LeagueMetaChips,
  formatLeagueType,
  formatScoringType,
} from '@/components/ui/LeagueMetaChips';
import { ListRow } from '@/components/ui/ListRow';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { resolveJoinRoute } from '@/utils/league/resolveJoinRoute';
import { logger } from '@/utils/logger';
import { ms, s } from '@/utils/scale';

interface League {
  id: string;
  name: string;
  created_by: string;
  teams: number;
  current_teams: number | null;
  imported_from: string | null;
  sport: string;
  league_type: string;
  scoring_type: string;
}

export default function JoinLeagueScreen() {
  const router = useRouter();
  const { code: paramCode } = useLocalSearchParams<{ code?: string }>();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [code, setCode] = useState(paramCode?.toUpperCase() ?? '');
  const [joining, setJoining] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);
  const autoJoinTriggered = useRef(false);

  const { data: leagues, isLoading } = useQuery({
    queryKey: queryKeys.publicLeagues(),
    queryFn: async () => {
      const user = (await supabase.auth.getUser()).data.user;

      const [leaguesResult, myTeamsResult] = await Promise.all([
        supabase
          .from('leagues')
          .select('id, name, created_by, teams, current_teams, imported_from, sport, league_type, scoring_type')
          .eq('private', false)
          .order('created_at', { ascending: false }),
        user
          ? supabase.from('teams').select('league_id').eq('user_id', user.id)
          : Promise.resolve({ data: [], error: null }),
      ]);

      if (leaguesResult.error) throw leaguesResult.error;
      if (myTeamsResult.error) throw myTeamsResult.error;

      const myLeagueIds = new Set((myTeamsResult.data ?? []).map(t => t.league_id));

      // For imported leagues the `current_teams` counter can equal
      // `teams` while unclaimed slots still exist (every team is
      // pre-created at import time). The per-league click-through
      // in `handleJoinLeague` checks for unclaimed teams precisely,
      // so include imports here regardless of the counter — users
      // who can't actually claim a team will see the right message
      // in join-by-code rather than being silently hidden.
      return (leaguesResult.data as League[]).filter(
        l => (l.imported_from ? true : (l.current_teams ?? 0) < l.teams) && !myLeagueIds.has(l.id)
      );
    }
  });

  const handleJoinByCode = async () => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;

    setCodeError(null);
    setJoining(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        Alert.alert('Error', 'You must be logged in to join a league.');
        return;
      }

      // invite_code is column-revoked from clients, so resolve it via the
      // members-agnostic SD RPC instead of a direct leagues select.
      const { data: matches, error } = await supabase.rpc('resolve_invite_code', {
        p_code: trimmed,
      });
      const league = Array.isArray(matches) ? matches[0] : null;

      if (error || !league) {
        setCodeError('No league found with that invite code.');
        return;
      }

      // Shared preflight — already-joined, unclaimed-team, and capacity checks
      // all live in resolveJoinRoute so this screen, the home invite card, and
      // the push tap can't drift apart.
      const route = await resolveJoinRoute({ leagueId: league.id, userId: user.id });
      if (!route.ok) {
        setCodeError(route.message);
        return;
      }

      router.push({ pathname: route.pathname, params: route.params });
    } catch (err) {
      logger.error('Error joining by code', err);
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

      const route = await resolveJoinRoute({ leagueId: league.id, userId: user.id });
      if (!route.ok) {
        Alert.alert('Cannot join', route.message);
        return;
      }

      router.push({ pathname: route.pathname, params: route.params });
    } catch (error) {
      logger.error('Error joining league', error);
      Alert.alert('Error', 'Failed to join league');
    }
  };

  const slotsAvailable = (league: League) => league.teams - (league.current_teams ?? 0);

  const hasCode = code.trim().length > 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Join a League" />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ── Invite code ── */}
        <Section title="Invite Code">
          <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
            Enter the code your commissioner shared with you.
          </ThemedText>
          <BrandTextInput
            value={code}
            onChangeText={(t) => {
              setCode(t.toUpperCase());
              if (codeError) setCodeError(null);
            }}
            placeholder="ENTER CODE"
            autoCapitalize="characters"
            maxLength={8}
            returnKeyType="go"
            onSubmitEditing={handleJoinByCode}
            errorText={codeError ?? undefined}
            containerStyle={styles.codeInputWrap}
            inputStyle={styles.codeInput}
            accessibilityLabel="League invite code"
            accessibilityHint="Enter the invite code to join a private league"
          />
          <BrandButton
            label={joining ? 'Joining…' : 'Join League'}
            onPress={handleJoinByCode}
            variant="primary"
            disabled={!hasCode}
            loading={joining}
            fullWidth
            accessibilityLabel={joining ? 'Joining league' : 'Join league with code'}
          />
        </Section>

        {/* ── OR divider ── */}
        <View style={styles.dividerRow}>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
          <ThemedText type="varsitySmall" style={[styles.dividerText, { color: c.secondaryText }]}>
            or
          </ThemedText>
          <View style={[styles.dividerLine, { backgroundColor: c.border }]} />
        </View>

        {/* ── Public leagues ── */}
        <Section title="Public Leagues" cardStyle={styles.listCard}>
          {isLoading ? (
            <View style={styles.loading}><LogoSpinner /></View>
          ) : !leagues?.length ? (
            <View style={styles.emptyState}>
              <Ionicons name="people-outline" size={40} color={c.secondaryText} accessible={false} />
              <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
                No public leagues available yet.
              </ThemedText>
            </View>
          ) : (
            leagues.map((league, idx) => {
              const slots = slotsAvailable(league);
              const a11yDetails = [
                formatLeagueType(league.league_type),
                formatScoringType(league.scoring_type),
                league.sport?.toUpperCase(),
              ]
                .filter(Boolean)
                .join(', ');
              return (
                <ListRow
                  key={league.id}
                  index={idx}
                  total={leagues.length}
                  onPress={() => handleJoinLeague(league)}
                  accessibilityLabel={`${league.name}, ${a11yDetails}, ${league.current_teams ?? 0} of ${league.teams} teams`}
                  accessibilityHint="Join this league"
                >
                  <View style={styles.leagueInfo}>
                    <ThemedText
                      type="sectionLabel"
                      style={[styles.leagueName, { color: c.text }]}
                      numberOfLines={1}
                    >
                      {league.name}
                    </ThemedText>
                    <LeagueMetaChips
                      sport={league.sport}
                      leagueType={league.league_type}
                      scoringType={league.scoring_type}
                      size="small"
                    />
                    <View style={styles.leagueMetaRow}>
                      <Ionicons name="people-outline" size={12} color={c.secondaryText} accessible={false} />
                      <ThemedText style={[styles.leagueMeta, { color: c.secondaryText }]}>
                        {league.current_teams ?? 0}/{league.teams} teams
                      </ThemedText>
                      <Badge
                        label={`${slots} ${slots === 1 ? 'spot' : 'spots'} open`}
                        variant="success"
                      />
                    </View>
                  </View>
                  <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
                </ListRow>
              );
            })
          )}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: s(16),
    paddingBottom: s(40),
  },
  hint: {
    fontSize: ms(13),
    marginBottom: s(12),
    lineHeight: ms(18),
  },
  codeInputWrap: {
    marginBottom: s(12),
  },
  codeInput: {
    fontSize: ms(18),
    fontWeight: '600',
    letterSpacing: 2,
    textAlign: 'center',
  },

  // ─── OR divider ──────────────────────────────────────────
  dividerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    marginVertical: s(6),
  },
  dividerLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  dividerText: {
    fontSize: ms(10),
  },

  // ─── Public leagues list ─────────────────────────────────
  // Drops card's horizontal padding so ListRow's own padding handles
  // inset and any future active-row bg spans the card's full width.
  listCard: {
    paddingHorizontal: 0,
  },
  loading: {
    paddingVertical: s(24),
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: s(40),
    alignItems: 'center',
    gap: s(12),
  },
  emptyText: {
    fontSize: ms(14),
    textAlign: 'center',
  },
  leagueInfo: {
    flex: 1,
    minWidth: 0,
    gap: s(4),
  },
  leagueName: {
    fontSize: ms(15),
    lineHeight: ms(20),
  },
  leagueMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  leagueMeta: {
    fontSize: ms(12),
  },
});
