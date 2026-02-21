import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import {
  CURRENT_NBA_SEASON,
  LeagueWizardState,
  NBA_SEASON_END,
} from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, View } from 'react-native';

interface StepSeasonProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

// Returns the Monday that starts the fantasy season.
// If today has >= 5 days left in its Mon-Sun week, use this Monday.
// Otherwise use next Monday (week 1 will be extended to cover the short partial week).
function computeSeasonStart(): Date {
  const today = new Date();
  // dayOfWeek: 0=Sun, 1=Mon, ..., 6=Sat
  const dayOfWeek = today.getDay();
  // Days since the most recent Monday (Monday = 0 offset)
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - daysSinceMonday);
  thisMonday.setHours(0, 0, 0, 0);

  // Days remaining in this week including today (Sun = last day)
  const daysLeftInWeek = 7 - daysSinceMonday;

  if (daysLeftInWeek >= 5) {
    return thisMonday;
  }
  // Too late in the week — start next Monday
  const nextMonday = new Date(thisMonday);
  nextMonday.setDate(thisMonday.getDate() + 7);
  return nextMonday;
}

// Days remaining in current week from today (used to detect short first week)
function daysRemainingInCurrentWeek(): number {
  const today = new Date();
  const dayOfWeek = today.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  return 7 - daysSinceMonday;
}

function addWeeks(date: Date, weeks: number): Date {
  const result = new Date(date);
  result.setDate(date.getDate() + weeks * 7);
  return result;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function StepSeason({ state, onChange }: StepSeasonProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const seasonStart = computeSeasonStart();
  const shortFirstWeek = daysRemainingInCurrentWeek() < 5;

  // Regular season ends after regularSeasonWeeks full weeks from start
  const regularSeasonEnd = addWeeks(seasonStart, state.regularSeasonWeeks);
  // Subtract 1 day to get the last day (Sunday) of the final regular season week
  regularSeasonEnd.setDate(regularSeasonEnd.getDate() - 1);

  // Playoffs start the next Monday after regular season
  const playoffsStart = new Date(regularSeasonEnd);
  playoffsStart.setDate(regularSeasonEnd.getDate() + 1);

  // Playoffs end after playoffWeeks weeks
  const playoffsEnd = addWeeks(playoffsStart, state.playoffWeeks);
  playoffsEnd.setDate(playoffsEnd.getDate() - 1);

  // NBA season boundary — parse as local midnight to avoid UTC timezone shift
  const nbaEndStr = NBA_SEASON_END[state.season] ?? NBA_SEASON_END[CURRENT_NBA_SEASON];
  const [y, m, d] = nbaEndStr.split('-').map(Number);
  const nbaEnd = new Date(y, m - 1, d);
  const exceedsNba = playoffsEnd > nbaEnd;

  // With odd team count, byes are only equal if regularSeasonWeeks is a multiple of team count
  const isOdd = state.teams % 2 !== 0;
  const byeError =
    isOdd && state.regularSeasonWeeks % state.teams !== 0
      ? `With ${state.teams} teams, regular season weeks must be a multiple of ${state.teams} for equal byes (e.g. ${state.teams}, ${state.teams * 2}, ${state.teams * 3}).`
      : null;

  return (
    <View style={styles.container}>
      <ThemedText type="subtitle" style={styles.heading}>Season Settings</ThemedText>

      <View style={styles.section}>
        <NumberStepper
          label="Regular Season"
          value={state.regularSeasonWeeks}
          onValueChange={(v) => onChange('regularSeasonWeeks', v)}
          min={4}
          max={22}
          suffix=" wks"
        />
        <NumberStepper
          label="Playoffs"
          value={state.playoffWeeks}
          onValueChange={(v) => onChange('playoffWeeks', v)}
          min={1}
          max={4}
          suffix=" wks"
        />
      </View>

      {/* Season preview card */}
      <View style={[styles.previewCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.previewTitle}>Season Preview</ThemedText>

        {shortFirstWeek && (
          <ThemedText style={[styles.note, { color: c.secondaryText }]}>
            Week 1 will cover the current partial week + the first full week.
          </ThemedText>
        )}

        <View style={styles.previewRow}>
          <ThemedText style={[styles.previewLabel, { color: c.secondaryText }]}>Season starts</ThemedText>
          <ThemedText style={styles.previewValue}>{formatDate(seasonStart)}</ThemedText>
        </View>
        <View style={styles.previewRow}>
          <ThemedText style={[styles.previewLabel, { color: c.secondaryText }]}>
            Regular season ends
          </ThemedText>
          <ThemedText style={styles.previewValue}>{formatDate(regularSeasonEnd)}</ThemedText>
        </View>
        <View style={styles.previewRow}>
          <ThemedText style={[styles.previewLabel, { color: c.secondaryText }]}>Playoffs end</ThemedText>
          <ThemedText style={[styles.previewValue, exceedsNba && { color: c.error ?? '#e53e3e' }]}>
            {formatDate(playoffsEnd)}
          </ThemedText>
        </View>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <View style={styles.previewRow}>
          <ThemedText style={[styles.previewLabel, { color: c.secondaryText }]}>NBA season ends</ThemedText>
          <ThemedText style={[styles.previewValue, { color: c.secondaryText }]}>{formatDate(nbaEnd)}</ThemedText>
        </View>
      </View>

      {exceedsNba && (
        <View style={[styles.warningBox, { backgroundColor: '#fff3cd', borderColor: '#ffc107' }]}>
          <ThemedText style={[styles.warningText, { color: '#856404' }]}>
            Your playoffs would extend past the NBA regular season. Reduce your week count or the results may be incomplete.
          </ThemedText>
        </View>
      )}

      {byeError && (
        <View style={[styles.warningBox, { backgroundColor: '#fee2e2', borderColor: '#ef4444', marginTop: 8 }]}>
          <ThemedText style={[styles.warningText, { color: '#b91c1c' }]}>
            {byeError}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  previewCard: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  previewTitle: {
    marginBottom: 12,
  },
  note: {
    fontSize: 13,
    marginBottom: 10,
    fontStyle: 'italic',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  previewLabel: {
    fontSize: 14,
  },
  previewValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: 8,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
  },
  warningText: {
    fontSize: 13,
  },
});
