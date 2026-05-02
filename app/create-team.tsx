import { useQuery } from '@tanstack/react-query';
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

import { Badge } from '@/components/ui/Badge';
import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { SportBadge } from '@/components/ui/SportBadge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { checkAndAssignDraftSlots } from '@/lib/draft';
import { logger } from '@/utils/logger';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from '@/utils/scale';

import { supabase } from '../lib/supabase';

const FORMAT_LABEL: Record<string, string> = {
  dynasty: 'Dynasty',
  keeper: 'Keeper',
  redraft: 'Redraft',
};

const SCORING_LABEL: Record<string, string> = {
  points: 'Points',
  h2h_categories: 'H2H Categories',
};

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

      const { data: teamData, error: teamError } = await supabase
        .from('teams')
        .insert({
          name: teamName,
          tricode: code,
          league_id: leagueId,
          user_id: user.id,
          is_commissioner: isCommissioner === 'true',
        })
        .select()
        .single();

      if (teamError) throw teamError;

      const { error: incrementError } = await supabase
        .rpc('increment_team_count', { league_id: leagueId });

      if (incrementError) throw incrementError;

      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('current_teams, teams, faab_budget, division_count')
        .eq('id', leagueId)
        .single();

      if (leagueError) throw leagueError;

      // Initialize waiver priority for this team
      await supabase.from('waiver_priority').insert([{
        league_id: leagueId,
        team_id: teamData.id,
        priority: league.current_teams ?? undefined,
        faab_remaining: league.faab_budget ?? 100,
      }]);

      switchLeague(leagueId, teamData.id);
      router.replace('/(tabs)');

      if (league && league.current_teams === league.teams) {
        checkAndAssignDraftSlots(leagueId).catch((e) =>
          logger.error('checkAndAssignDraftSlots failed', e),
        );

        // Auto-assign divisions when league is full
        if (league.division_count === 2) {
          const { data: allTeams } = await supabase
            .from('teams')
            .select('id')
            .eq('league_id', leagueId as string)
            .order('id');

          if (allTeams && allTeams.length > 0) {
            const shuffled = [...allTeams].sort(() => Math.random() - 0.5);
            const half = Math.ceil(shuffled.length / 2);
            const updates = shuffled.map((t, i) => ({
              id: t.id,
              division: (i < half ? 1 : 2) as 1 | 2,
            }));
            for (const u of updates) {
              await supabase.from('teams').update({ division: u.division }).eq('id', u.id);
            }
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

  const formatLabel = leagueInfo?.league_type
    ? FORMAT_LABEL[leagueInfo.league_type] ?? leagueInfo.league_type
    : null;
  const scoringLabel = leagueInfo?.scoring_type
    ? SCORING_LABEL[leagueInfo.scoring_type] ?? leagueInfo.scoring_type
    : null;

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
            <View style={styles.metaRow}>
              {leagueInfo.sport && (
                <SportBadge sport={leagueInfo.sport as Sport} />
              )}
              {formatLabel && <Badge label={formatLabel} variant="neutral" />}
              {scoringLabel && <Badge label={scoringLabel} variant="neutral" />}
            </View>
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
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: s(6),
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
