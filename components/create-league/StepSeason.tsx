import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import {
  CURRENT_NBA_SEASON,
  LeagueWizardState,
  NBA_SEASON_END,
  PLAYOFF_SEEDING_OPTIONS,
} from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { calcLotteryPoolSize, getPlayoffTeamOptions } from '@/utils/lottery';
import { StyleSheet, View } from 'react-native';

interface StepSeasonProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

// Returns the date that starts the fantasy season.
// Mon/Tue/Wed: start today (Week 1 may be a short week ending Sunday).
// Thu–Sun: start next Monday (full week).
export function computeSeasonStart(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dow = today.getDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysSinceMonday = dow === 0 ? 6 : dow - 1;
  const daysLeftInWeek = 7 - daysSinceMonday;

  if (daysLeftInWeek >= 5) {
    // Mon/Tue/Wed — start today
    return today;
  }
  // Thu–Sun — start next Monday
  const nextMonday = new Date(today);
  nextMonday.setDate(today.getDate() + (7 - daysSinceMonday));
  return nextMonday;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Max weeks between season start and NBA season end.
 *  Week 1 may be partial (e.g. Tue–Sun), Week 2+ are full Mon–Sun. */
export function computeMaxWeeks(season: string): number {
  const start = computeSeasonStart();
  const endStr = NBA_SEASON_END[season] ?? NBA_SEASON_END[CURRENT_NBA_SEASON];
  const [y, m, d] = endStr.split('-').map(Number);
  const msPerDay = 24 * 60 * 60 * 1000;

  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(y, m - 1, d);

  // Week 1 ends the first Sunday after (or on) start
  const startDow = start.getDay(); // 0=Sun
  const daysUntilSun = startDow === 0 ? 0 : 7 - startDow;
  const week1EndUtc = startUtc + daysUntilSun * msPerDay;

  // Week 2+ starts the Monday after Week 1
  const week2StartUtc = week1EndUtc + msPerDay;
  if (week2StartUtc > endUtc) return 1;

  const remainingDays = (endUtc - week2StartUtc) / msPerDay + 1;
  return 1 + Math.floor(remainingDays / 7);
}

export function StepSeason({ state, onChange }: StepSeasonProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const seasonStart = computeSeasonStart();
  const startDow = seasonStart.getDay(); // 0=Sun
  const shortFirstWeek = startDow !== 1; // not Monday

  // NBA season boundary — parse as local midnight to avoid UTC timezone shift
  const nbaEndStr = NBA_SEASON_END[state.season] ?? NBA_SEASON_END[CURRENT_NBA_SEASON];
  const [y, m, d] = nbaEndStr.split('-').map(Number);
  const nbaEnd = new Date(y, m - 1, d);

  const maxTotalWeeks = computeMaxWeeks(state.season);

  const maxRegularSeasonWeeks = Math.max(1, maxTotalWeeks - state.playoffWeeks);
  const maxPlayoffWeeks = Math.max(1, maxTotalWeeks - state.regularSeasonWeeks);

  // Week 1 ends the first Sunday after (or on) seasonStart
  const daysUntilSun = startDow === 0 ? 0 : 7 - startDow;
  const week1End = new Date(seasonStart);
  week1End.setDate(seasonStart.getDate() + daysUntilSun);

  // Regular season end = Week 1 Sunday + (regularSeasonWeeks - 1) full weeks
  const regularSeasonEnd = new Date(week1End);
  regularSeasonEnd.setDate(week1End.getDate() + (state.regularSeasonWeeks - 1) * 7);

  // Playoffs start the next Monday after regular season
  const playoffsStart = new Date(regularSeasonEnd);
  playoffsStart.setDate(regularSeasonEnd.getDate() + 1);

  // Playoffs end after playoffWeeks full weeks (each Mon-Sun)
  const playoffsEnd = new Date(playoffsStart);
  playoffsEnd.setDate(playoffsStart.getDate() + state.playoffWeeks * 7 - 1);

  // With odd team count, byes are only equal if regularSeasonWeeks is a multiple of team count
  const isOdd = state.teams % 2 !== 0;
  const byeError =
    isOdd && state.regularSeasonWeeks % state.teams !== 0
      ? `With ${state.teams} teams, regular season weeks must be a multiple of ${state.teams} for equal byes (e.g. ${state.teams}, ${state.teams * 2}, ${state.teams * 3}).`
      : null;

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Season Settings</ThemedText>

      <View style={styles.section}>
        <NumberStepper
          label="Regular Season"
          value={state.regularSeasonWeeks}
          onValueChange={(v) => onChange('regularSeasonWeeks', v)}
          min={1}
          max={maxRegularSeasonWeeks}
          suffix=" wks"
        />
        <NumberStepper
          label="Playoffs"
          value={state.playoffWeeks}
          onValueChange={(v) => onChange('playoffWeeks', v)}
          min={1}
          max={maxPlayoffWeeks}
          suffix=" wks"
        />
      </View>

      {state.teams >= 2 && (
        <View style={styles.section}>
          <ThemedText style={styles.label}>Playoff Teams</ThemedText>
          {(() => {
            const options = getPlayoffTeamOptions(state.playoffWeeks, state.teams);
            const labels = options.map(String);
            const selectedIdx = options.indexOf(state.playoffTeams);
            return (
              <SegmentedControl
                options={labels}
                selectedIndex={selectedIdx === -1 ? labels.length - 1 : selectedIdx}
                onSelect={(i) => onChange('playoffTeams', options[i])}
              />
            );
          })()}
          {(() => {
            const lotteryPool = calcLotteryPoolSize(state.teams, state.playoffTeams);
            if (lotteryPool > 0) {
              return (
                <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
                  {lotteryPool} non-playoff team{lotteryPool !== 1 ? 's' : ''} in the lottery pool
                </ThemedText>
              );
            }
            return null;
          })()}
        </View>
      )}

      {/* Playoff Seeding Format */}
      <View style={styles.section}>
        <ThemedText style={styles.label}>Playoff Seeding Format</ThemedText>
        <SegmentedControl
          options={[...PLAYOFF_SEEDING_OPTIONS]}
          selectedIndex={PLAYOFF_SEEDING_OPTIONS.indexOf(state.playoffSeedingFormat)}
          onSelect={(i) => {
            onChange('playoffSeedingFormat', PLAYOFF_SEEDING_OPTIONS[i]);
            if (PLAYOFF_SEEDING_OPTIONS[i] === 'Fixed Bracket') {
              onChange('reseedEachRound', false);
            }
          }}
        />
        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          {state.playoffSeedingFormat === 'Standard'
            ? 'Highest remaining seed plays lowest remaining seed each round.'
            : state.playoffSeedingFormat === 'Fixed Bracket'
              ? 'Traditional bracket halves: 1v8/4v5 one side, 2v7/3v6 the other.'
              : 'After each round, higher seeds pick their next opponent.'}
        </ThemedText>
      </View>

      {/* Reseed Toggle — only for Standard */}
      {state.playoffSeedingFormat === 'Standard' && (
        <View style={styles.section}>
          <ThemedText style={styles.label}>Reseed Each Round</ThemedText>
          <SegmentedControl
            options={['Yes', 'No']}
            selectedIndex={state.reseedEachRound ? 0 : 1}
            onSelect={(i) => onChange('reseedEachRound', i === 0)}
          />
          <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
            {state.reseedEachRound
              ? 'After each round, remaining teams re-ranked so top seed always faces bottom seed.'
              : 'Bracket positions fixed from initial seeding.'}
          </ThemedText>
        </View>
      )}

      {/* Season preview card */}
      <View style={[styles.previewCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.previewTitle}>Season Preview</ThemedText>

        {shortFirstWeek && (
          <ThemedText style={[styles.note, { color: c.secondaryText }]}>
            Week 1 is a short week ({daysUntilSun + 1} days) ending Sunday.
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
          <ThemedText style={styles.previewValue}>{formatDate(playoffsEnd)}</ThemedText>
        </View>
        <View style={[styles.divider, { backgroundColor: c.border }]} />
        <View style={styles.previewRow}>
          <ThemedText style={[styles.previewLabel, { color: c.secondaryText }]}>NBA season ends</ThemedText>
          <ThemedText style={[styles.previewValue, { color: c.secondaryText }]}>{formatDate(nbaEnd)}</ThemedText>
        </View>
      </View>

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
  label: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: '500',
  },
  hint: {
    fontSize: 13,
    marginTop: 6,
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
