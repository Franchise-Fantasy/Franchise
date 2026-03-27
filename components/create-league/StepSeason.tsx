import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import {
  CURRENT_NBA_SEASON,
  LeagueWizardState,
  NBA_SEASON_END,
  PLAYOFF_SEEDING_OPTIONS,
  TIEBREAKER_OPTIONS,
} from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { calcLotteryPoolSize, getPlayoffTeamOptions } from '@/utils/lottery';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

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
export function computeMaxWeeks(season: string, customStart?: Date): number {
  const start = customStart ?? computeSeasonStart();
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
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Parse custom start date or fall back to auto
  const seasonStart = state.seasonStartDate
    ? (() => {
        const [sy, sm, sd] = state.seasonStartDate.split('-').map(Number);
        return new Date(sy, sm - 1, sd);
      })()
    : computeSeasonStart();
  const startDow = seasonStart.getDay(); // 0=Sun
  const shortFirstWeek = startDow !== 1; // not Monday

  // NBA season boundary — parse as local midnight to avoid UTC timezone shift
  const nbaEndStr = NBA_SEASON_END[state.season] ?? NBA_SEASON_END[CURRENT_NBA_SEASON];
  const [y, m, d] = nbaEndStr.split('-').map(Number);
  const nbaEnd = new Date(y, m - 1, d);

  const maxTotalWeeks = computeMaxWeeks(state.season, seasonStart);

  // Earliest selectable date is today
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const handleDateChange = (_event: DateTimePickerEvent, date?: Date) => {
    setShowDatePicker(false);
    if (!date) return;
    date.setHours(0, 0, 0, 0);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    onChange('seasonStartDate', iso);
  };

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

  const canHaveDivisions = state.teams >= 4;

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Season Settings</ThemedText>

      {/* League Structure (Divisions) */}
      <View style={styles.section}>
        <ThemedText style={styles.label}>League Structure</ThemedText>
        <SegmentedControl
          options={['No Divisions', '2 Divisions']}
          selectedIndex={state.divisionCount === 2 ? 1 : 0}
          onSelect={(i) => onChange('divisionCount', i === 1 ? 2 : 1)}
          disabled={!canHaveDivisions && state.divisionCount !== 2}
        />
        {state.divisionCount === 2 && (
          <View style={styles.divisionNames}>
            <TextInput
              style={[styles.divisionInput, { borderColor: c.border, backgroundColor: c.input, color: c.text }]}
              value={state.division1Name}
              onChangeText={(v) => onChange('division1Name', v)}
              placeholder="Division 1"
              placeholderTextColor={c.secondaryText}
              maxLength={24}
              accessibilityLabel="Division 1 name"
            />
            <TextInput
              style={[styles.divisionInput, { borderColor: c.border, backgroundColor: c.input, color: c.text }]}
              value={state.division2Name}
              onChangeText={(v) => onChange('division2Name', v)}
              placeholder="Division 2"
              placeholderTextColor={c.secondaryText}
              maxLength={24}
              accessibilityLabel="Division 2 name"
            />
          </View>
        )}
        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          {state.divisionCount === 2
            ? 'Division winners are guaranteed the top 2 playoff seeds.'
            : 'All teams compete in a single conference.'}
        </ThemedText>
        {!canHaveDivisions && (
          <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
            Divisions require at least 4 teams.
          </ThemedText>
        )}
      </View>

      {/* Season Start Date */}
      <View style={styles.section}>
        <ThemedText style={styles.label}>Season Start Date</ThemedText>
        <TouchableOpacity
          onPress={() => setShowDatePicker(true)}
          style={[styles.dateButton, { borderColor: c.border, backgroundColor: c.card }]}
          accessibilityRole="button"
          accessibilityLabel={`Season start date: ${formatDate(seasonStart)}. Tap to change.`}
        >
          <ThemedText style={styles.dateButtonText}>{formatDate(seasonStart)}</ThemedText>
        </TouchableOpacity>
        {state.seasonStartDate && (
          <TouchableOpacity
            onPress={() => onChange('seasonStartDate', null)}
            accessibilityRole="button"
            accessibilityLabel="Reset to automatic start date"
          >
            <ThemedText style={[styles.hint, { color: c.accent }]}>Reset to auto</ThemedText>
          </TouchableOpacity>
        )}
        {!state.seasonStartDate && (
          <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
            Auto-selected based on today's date. Tap to choose a different date.
          </ThemedText>
        )}
        {showDatePicker && (
          <DateTimePicker
            value={seasonStart}
            mode="date"
            display="default"
            minimumDate={today}
            maximumDate={nbaEnd}
            onChange={handleDateChange}
          />
        )}
      </View>

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

      {/* Tiebreaker Priority */}
      <View style={styles.section}>
        <ThemedText style={styles.label}>Tiebreaker Priority</ThemedText>
        <SegmentedControl
          options={[...TIEBREAKER_OPTIONS]}
          selectedIndex={TIEBREAKER_OPTIONS.indexOf(state.tiebreakerPrimary)}
          onSelect={(i) => onChange('tiebreakerPrimary', TIEBREAKER_OPTIONS[i])}
        />
        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          {state.tiebreakerPrimary === 'Head-to-Head'
            ? 'Tied teams compared by head-to-head record first, then total points scored.'
            : 'Tied teams compared by total points scored first, then head-to-head record.'}
        </ThemedText>
      </View>

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
        <View style={[styles.warningBox, { backgroundColor: c.dangerMuted, borderColor: c.danger, marginTop: 8 }]}>
          <ThemedText style={[styles.warningText, { color: c.danger }]}>
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
  dateButton: {
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  dateButtonText: {
    fontSize: 16,
    fontWeight: '500',
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
  divisionNames: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 10,
  },
  divisionInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
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
