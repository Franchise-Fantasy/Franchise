import { StepReview as BaseReview } from '@/components/create-league/StepReview';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';

import type { ScreenshotImportState } from './state';

interface StepReviewProps {
  state: ScreenshotImportState;
  onSubmit: () => void;
  onBack: () => void;
  loading: boolean;
}

/**
 * Screenshot-import Review step. Reuses create-league's StepReview
 * (which renders every per-category config summary + the primary
 * CTA) with a custom headerContent that shows the import-specific
 * bits: total players extracted, teams, and history seasons. Same
 * pattern as the Sleeper-import Review.
 */
export function StepReview({ state, onSubmit, onBack, loading }: StepReviewProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const totalPlayers = state.teams.reduce(
    (sum, t) => sum + t.matched.length + t.resolvedMappings.size,
    0,
  );
  const extractedSeasons = state.historySeasons.filter((h) => h.extracted?.teams?.length);

  return (
    <BaseReview
      state={state.wizardState}
      onSubmit={onSubmit}
      onBack={onBack}
      loading={loading}
      submitLabel="Import League"
      headerContent={
        <>
          <Section title="Import Summary">
            <SummaryRow label="Total Players" value={String(totalPlayers)} />
            <SummaryRow
              label="History"
              value={
                extractedSeasons.length > 0
                  ? `${extractedSeasons.length} season${extractedSeasons.length > 1 ? 's' : ''}`
                  : 'None'
              }
              last
            />
          </Section>

          <Section title={`Teams (${state.teams.length})`} cardStyle={styles.teamsCard}>
            {state.teams.map((team, i) => (
              <View
                key={i}
                style={[
                  styles.teamRow,
                  { borderBottomColor: c.border },
                  i === state.teams.length - 1 && { borderBottomWidth: 0 },
                ]}
              >
                <View style={styles.teamInfo}>
                  <ThemedText style={[styles.teamName, { color: c.text }]} numberOfLines={1}>
                    {team.team_name}
                  </ThemedText>
                  <Text style={[styles.teamCount, { color: c.secondaryText }]}>
                    {team.matched.length + team.resolvedMappings.size} players
                  </Text>
                </View>
                <Ionicons
                  name={team.extracted ? 'checkmark-circle' : 'alert-circle'}
                  size={ms(18)}
                  color={team.extracted ? c.success : c.warning}
                  accessible={false}
                />
              </View>
            ))}
          </Section>
        </>
      }
    />
  );
}

function SummaryRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  return (
    <View style={[styles.summaryRow, last && { paddingBottom: 0 }]}>
      <ThemedText style={[styles.summaryLabel, { color: c.secondaryText }]}>{label}</ThemedText>
      <Text style={[styles.summaryValue, { color: c.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(5),
    gap: s(12),
  },
  summaryLabel: {
    fontSize: ms(14),
    flexShrink: 1,
  },
  summaryValue: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    fontWeight: '700',
    letterSpacing: 0.5,
    textAlign: 'right',
    flexShrink: 1,
  },
  teamsCard: {
    paddingHorizontal: 0,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(14),
    gap: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    minWidth: 0,
  },
  teamName: {
    fontSize: ms(14),
    fontWeight: '500',
    flexShrink: 1,
  },
  teamCount: {
    fontFamily: Fonts.mono,
    fontSize: ms(12),
    fontWeight: '600',
    letterSpacing: 0.3,
  },
});
