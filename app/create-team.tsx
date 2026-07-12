import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  Alert,
  Keyboard,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableWithoutFeedback,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { LeagueMetaChips } from '@/components/ui/LeagueMetaChips';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { checkAndAssignDraftSlots } from '@/lib/draft';
import { logger } from '@/utils/logger';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from '@/utils/scale';

import { supabase } from '../lib/supabase';

export default function CreateTeam() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const leagueId = String(params.leagueId ?? '');
  const isCommissioner = String(params.isCommissioner ?? 'false');
  const [teamName, setTeamName] = useState('');
  const [tricode, setTricode] = useState('');
  const [loading, setLoading] = useState(false);
  const tricodeRef = useRef<TextInput>(null);
  const { switchLeague } = useAppState();
  const queryClient = useQueryClient();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: leagueInfo } = useQuery({
    queryKey: [...queryKeys.league(leagueId), 'create-team-summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('name, sport, league_type, scoring_type')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  const handleCancel = () => {
    if (loading) return;
    router.back();
  };

  const handleCreateTeam = async () => {
    if (!teamName.trim()) {
      Alert.alert('Please enter a team name.');
      return;
    }
    if (containsBlockedContent(teamName)) {
      Alert.alert('Invalid name', 'That team name contains language that isn’t allowed.');
      return;
    }
    const code = tricode.trim().toUpperCase();
    if (!code || code.length < 2 || code.length > 3 || !/^[A-Z0-9]+$/.test(code)) {
      Alert.alert('Tricode must be 2-3 characters (e.g. LAL, BOS).');
      return;
    }

    setLoading(true);

    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) {
        Alert.alert('User not logged in.');
        return;
      }

      // The team row, the league's seat count, the waiver-priority row, and the
      // tentative join-order pick claim are one operation. As four writes, a
      // failure after the team insert left the seat taken but uncounted — so the
      // next joiner got the same waiver priority and the league never registered
      // as full, meaning the real draft order was never drawn.
      const { data: joined, error: joinError } = await supabase.rpc('join_league_team', {
        p_league_id: leagueId,
        p_name: teamName,
        p_tricode: code,
        p_is_commissioner: isCommissioner === 'true',
      });
      if (joinError) throw joinError;

      const { team_id: teamId, current_teams, max_teams, division_count } =
        joined as unknown as {
          team_id: string;
          current_teams: number | null;
          max_teams: number | null;
          division_count: number | null;
        };

      switchLeague(leagueId, teamId);
      // Surface the new membership in the home league switcher immediately —
      // its list query is otherwise cached and won't include this league.
      queryClient.invalidateQueries({ queryKey: queryKeys.userLeagues(user.id) });
      router.replace('/(tabs)');

      if (current_teams != null && current_teams === max_teams) {
        checkAndAssignDraftSlots(leagueId).catch((e) =>
          logger.error('checkAndAssignDraftSlots failed', e),
        );

        // Auto-assign divisions when the league fills. The shuffle stays here
        // (SQL has no seedable RNG we want to depend on); the split is applied
        // in one statement so a failure can't leave half the league undivided.
        if (division_count === 2) {
          const { data: allTeams } = await supabase
            .from('teams')
            .select('id')
            .eq('league_id', leagueId as string)
            .order('id');

          if (allTeams && allTeams.length > 0) {
            const shuffled = [...allTeams].sort(() => Math.random() - 0.5);
            const half = Math.ceil(shuffled.length / 2);
            await supabase.rpc('assign_team_divisions', {
              p_league_id: leagueId,
              p_division_1_team_ids: shuffled.slice(0, half).map((t) => t.id),
            });
          }
        }
      }

    } catch (error) {
      logger.error('Create team failed', error);
      Alert.alert('Failed to create team.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title="Create Team" />

      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          <ThemedText type="title" style={styles.heading} accessibilityRole="header">
            Create Your Team
          </ThemedText>
          <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
            {leagueInfo?.name
              ? `Joining ${leagueInfo.name}.`
              : 'Pick a name and tricode for your franchise.'}
          </ThemedText>

          {leagueInfo && (
            <LeagueMetaChips
              sport={leagueInfo.sport}
              leagueType={leagueInfo.league_type}
              scoringType={leagueInfo.scoring_type}
              style={styles.metaRow}
            />
          )}

          <Section title="Team Details" cardStyle={styles.card}>
            <BrandTextInput
              label="Team Name"
              value={teamName}
              onChangeText={setTeamName}
              placeholder="e.g. Lake Show"
              maxLength={32}
              returnKeyType="next"
              onSubmitEditing={() => tricodeRef.current?.focus()}
              accessibilityLabel="Team name"
              containerStyle={styles.field}
            />

            <BrandTextInput
              ref={tricodeRef}
              label="Tricode"
              helperText="2–3 letters or numbers (e.g. LAL, BOS, NYK)."
              value={tricode}
              onChangeText={(t) => setTricode(t.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3))}
              placeholder="LAL"
              autoCapitalize="characters"
              maxLength={3}
              returnKeyType="done"
              onSubmitEditing={handleCreateTeam}
              accessibilityLabel="Team tricode"
              accessibilityHint="2 to 4 characters, letters and numbers only"
              inputStyle={styles.tricodeInput}
            />
          </Section>

          <View style={styles.actions}>
            <BrandButton
              label={loading ? 'Creating…' : 'Create Team'}
              onPress={handleCreateTeam}
              variant="primary"
              loading={loading}
              disabled={loading}
              fullWidth
              accessibilityLabel={loading ? 'Creating team' : 'Create team'}
            />
            <BrandButton
              label="Cancel"
              onPress={handleCancel}
              variant="secondary"
              disabled={loading}
              fullWidth
              accessibilityLabel="Cancel and go back"
            />
          </View>
        </ScrollView>
      </TouchableWithoutFeedback>
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
  heading: {
    textAlign: 'center',
    marginTop: s(8),
  },
  subtitle: {
    textAlign: 'center',
    fontSize: ms(14),
    lineHeight: ms(20),
    marginTop: s(6),
    marginBottom: s(12),
  },
  metaRow: {
    justifyContent: 'center',
    marginBottom: s(20),
  },
  card: {
    paddingHorizontal: s(14),
    paddingTop: s(14),
    paddingBottom: s(14),
    gap: s(12),
  },
  field: {
    marginBottom: s(4),
  },
  tricodeInput: {
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
  actions: {
    gap: s(10),
    marginTop: s(8),
  },
});

export const options = {
  headerShown: false,
};
