import DateTimePicker, {
  DateTimePickerAndroid,
  DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Keyboard, Modal, Platform, Pressable, StyleSheet, TouchableOpacity, View } from 'react-native';

import { BracketPreview } from '@/components/playoff/BracketPreview';
import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Section } from '@/components/ui/Section';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import {
  getCurrentSeason,
  getMaxPlayoffWeeks,
  getMergeWindows,
  getSchedulableSeasonEnd,
  getSeasonEnd,
  LeagueWizardState,
  PLAYOFF_SEEDING_OPTIONS,
  SPORT_DISPLAY,
  TIEBREAKER_OPTIONS,
} from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { calcLotteryPoolSize, getPlayoffTeamOptions, maxPlayoffWeeksForTeams } from '@/utils/league/lottery';
import { planScheduleWeeks } from '@/utils/league/scheduleWindows';
import { computeMaxWeeks, defaultSeasonStart } from '@/utils/league/seasonWeeks';
import { week1Length } from '@/utils/leagueTime';
import { ms, s } from '@/utils/scale';

interface StepSeasonProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Parse a 'YYYY-MM-DD' string to a local-midnight Date for display. */
function ymdToDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function StepSeason({ state, onChange }: StepSeasonProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [showDatePicker, setShowDatePicker] = useState(false);

  // Parse custom start date or fall back to auto (tomorrow, floored to the
  // pro season's opening night when that's still ahead).
  const seasonStart = state.seasonStartDate
    ? ymdToDate(state.seasonStartDate)
    : defaultSeasonStart(state.sport, state.season);
  const startDow = seasonStart.getDay(); // 0=Sun
  const week1Days = week1Length(startDow);
  const week1IsAtypical = week1Days !== 7; // anything other than Mon-Sun

  // Pro-league season boundary (sport-aware) — parse as local midnight to
  // avoid UTC timezone shift.
  const proEndStr = getSeasonEnd(state.sport, state.season) ?? getSeasonEnd(state.sport, getCurrentSeason(state.sport))!;
  const [y, m, d] = proEndStr.split('-').map(Number);
  const proSeasonEnd = new Date(y, m - 1, d);

  // A terminal break (WNBA FIBA) walls off the season — the league can't start
  // or be scheduled past it, so the effective end the wizard builds around is
  // the day before the break. Without a terminal break this equals proEndStr.
  const effectiveEndStr = getSchedulableSeasonEnd(state.sport, state.season) ?? proEndStr;
  const [ey, em, ed] = effectiveEndStr.split('-').map(Number);
  const effectiveSeasonEnd = new Date(ey, em - 1, ed);

  const cupWeekOn = state.sport === 'nba' && (state.combineCupWeek ?? false);
  const maxTotalWeeks = computeMaxWeeks(state.season, state.sport, seasonStart, cupWeekOn);

  // Earliest selectable date: tomorrow — a league can't start the day it's
  // created — floored to the pro season's opening night when that's still
  // ahead (an NBA league created in July can't start before October tipoff).
  const earliestStart = defaultSeasonStart(state.sport, state.season);

  const commitDate = (date: Date) => {
    date.setHours(0, 0, 0, 0);
    const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    onChange('seasonStartDate', iso);
  };

  // Platform split:
  //  - iOS: keep a Modal open with a spinner-style picker + Done button.
  //    (Using `display="default"` inline on iOS 14+ rendered a second
  //    inline compact picker that crashed on tap.)
  //  - Android: imperative `DateTimePickerAndroid.open()` — shows the
  //    native system dialog directly, then closes itself on dismiss.
  const handleIOSChange = (_event: DateTimePickerEvent, date?: Date) => {
    if (date) commitDate(date);
  };

  const openDatePicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: seasonStart,
        mode: 'date',
        minimumDate: earliestStart,
        maximumDate: effectiveSeasonEnd,
        onChange: (_e, date) => {
          if (date) commitDate(date);
        },
      });
    } else {
      setShowDatePicker(true);
    }
  };

  const maxRegularSeasonWeeks = Math.max(1, maxTotalWeeks - state.playoffWeeks);
  // Playoff weeks are capped by the remaining season, the sport's structural
  // max (NBA 4 = 16-team bracket, WNBA 3 = 8-team bracket), AND what the
  // league's team count can actually bracket — 2 teams can only ever play a
  // 1-week final, so offering 3 weeks would schedule two empty playoff weeks.
  const maxPlayoffWeeks = Math.min(
    getMaxPlayoffWeeks(state.sport),
    maxPlayoffWeeksForTeams(state.teams),
    Math.max(1, maxTotalWeeks - state.regularSeasonWeeks),
  );

  // Break-aware week plan so the preview reflects double weeks / the FIBA
  // bridge instead of naive 7-day stepping. Optional (NBA Cup) windows only
  // count when the league turned the toggle on. Week 1's variable length is
  // handled inside the planner.
  const seasonStartIso = `${seasonStart.getFullYear()}-${String(seasonStart.getMonth() + 1).padStart(2, '0')}-${String(seasonStart.getDate()).padStart(2, '0')}`;
  const previewMergeWindows = getMergeWindows(state.sport, state.season).filter(
    (w) => !w.optional || cupWeekOn,
  );
  const plannedWeeks = planScheduleWeeks({
    seasonStart: seasonStartIso,
    regularSeasonWeeks: state.regularSeasonWeeks,
    playoffWeeks: state.playoffWeeks,
    mergeWindows: previewMergeWindows,
  });
  const regularSeasonEnd = ymdToDate(plannedWeeks[state.regularSeasonWeeks - 1]?.endDate ?? seasonStartIso);
  const playoffsEnd = ymdToDate(plannedWeeks[plannedWeeks.length - 1]?.endDate ?? seasonStartIso);
  const doubleWeekLabels = plannedWeeks
    .filter((w) => w.isDoubleWeek)
    .map((w) => w.mergeLabel ?? 'Double week');
  // A terminal break (WNBA FIBA) caps the season before it — surface why the
  // fantasy season ends before the pro season's listed end date.
  const terminalBreak = previewMergeWindows.find((w) => w.terminal && w.start <= proEndStr);

  // With odd team count, byes are only equal if regularSeasonWeeks is a multiple of team count
  const isOdd = state.teams % 2 !== 0;
  const byeError =
    isOdd && state.regularSeasonWeeks % state.teams !== 0
      ? `With ${state.teams} teams, regular season weeks must be a multiple of ${state.teams} for equal byes (e.g. ${state.teams}, ${state.teams * 2}, ${state.teams * 3}).`
      : null;

  const canHaveDivisions = state.teams >= 4;

  return (
    <View style={styles.container}>
      {/* League Structure (Divisions) */}
      <FormSection title="League Structure">
        <FieldGroup
          label="Divisions"
          helperText={
            state.divisionCount === 2
              ? 'Division winners are guaranteed the top 2 playoff seeds.'
              : canHaveDivisions
                ? 'All teams compete in a single conference.'
                : 'Divisions require at least 4 teams.'
          }
        >
          <SegmentedControl
            options={['No Divisions', '2 Divisions']}
            selectedIndex={state.divisionCount === 2 ? 1 : 0}
            onSelect={(i) => {
              const next = i === 1 ? 2 : 1;
              // Switching back to "No Divisions" unmounts the AnimatedSection
              // holding the division-name inputs. The inputs lose focus, but
              // RN doesn't auto-dismiss the keyboard on unmount — leaving the
              // keyboard stranded over the now-empty section.
              if (next === 1) Keyboard.dismiss();
              onChange('divisionCount', next);
            }}
            disabled={!canHaveDivisions && state.divisionCount !== 2}
          />
        </FieldGroup>
        <AnimatedSection visible={state.divisionCount === 2}>
          <View style={styles.divisionNames}>
            <BrandTextInput
              value={state.division1Name}
              onChangeText={(v) => onChange('division1Name', v)}
              placeholder="Division 1"
              maxLength={24}
              accessibilityLabel="Division 1 name"
              containerStyle={styles.divisionInput}
            />
            <BrandTextInput
              value={state.division2Name}
              onChangeText={(v) => onChange('division2Name', v)}
              placeholder="Division 2"
              maxLength={24}
              accessibilityLabel="Division 2 name"
              containerStyle={styles.divisionInput}
            />
          </View>
        </AnimatedSection>
      </FormSection>

      {/* Playoffs */}
      <FormSection title="Playoffs">
        {state.teams >= 2 &&
          (() => {
            const options = getPlayoffTeamOptions(state.playoffWeeks, state.teams);
            const labels = options.map(String);
            const selectedIdx = options.indexOf(state.playoffTeams);
            const lotteryPool = calcLotteryPoolSize(state.teams, state.playoffTeams);
            const helper =
              lotteryPool > 0
                ? `${lotteryPool} non-playoff team${lotteryPool !== 1 ? 's' : ''} in the lottery pool`
                : undefined;
            return (
              <FieldGroup label="Playoff Teams" helperText={helper}>
                <SegmentedControl
                  options={labels}
                  selectedIndex={selectedIdx === -1 ? labels.length - 1 : selectedIdx}
                  onSelect={(i) => onChange('playoffTeams', options[i])}
                />
                <BracketPreview playoffTeams={state.playoffTeams} style={styles.bracketPreview} />
              </FieldGroup>
            );
          })()}

        <FieldGroup
          label="Seeding Format"
          helperText={
            state.playoffSeedingFormat === 'Standard'
              ? 'Fixed bracket: positions set from initial seeding (1v8/4v5 one side, 2v7/3v6 the other) and feed straight through.'
              : state.playoffSeedingFormat === 'Reseed'
                ? 'Remaining teams are re-ranked each round so the top seed always faces the lowest survivor.'
                : 'After each round, higher seeds pick their next opponent.'
          }
        >
          <SegmentedControl
            options={[...PLAYOFF_SEEDING_OPTIONS]}
            selectedIndex={Math.max(0, PLAYOFF_SEEDING_OPTIONS.indexOf(state.playoffSeedingFormat))}
            onSelect={(i) => onChange('playoffSeedingFormat', PLAYOFF_SEEDING_OPTIONS[i])}
          />
        </FieldGroup>

        <FieldGroup
          label="Tiebreaker Priority"
          helperText={
            state.tiebreakerPrimary === 'Head-to-Head'
              ? 'Tied teams compared by head-to-head record first, then total points scored.'
              : 'Tied teams compared by total points scored first, then head-to-head record.'
          }
        >
          <SegmentedControl
            options={[...TIEBREAKER_OPTIONS]}
            selectedIndex={TIEBREAKER_OPTIONS.indexOf(state.tiebreakerPrimary)}
            onSelect={(i) => onChange('tiebreakerPrimary', TIEBREAKER_OPTIONS[i])}
          />
        </FieldGroup>
      </FormSection>

      {/* Schedule — sits below Playoffs so the Season Preview lands
          right under the regular/playoff week steppers and updates
          visibly as the user edits them. */}
      <FormSection title="Schedule">
        <FieldGroup
          label="Season Start Date"
          helperText={
            state.seasonStartDate
              ? undefined
              : "Auto-selected based on today's date. Tap to choose a different date."
          }
        >
          <TouchableOpacity
            onPress={openDatePicker}
            style={[styles.dateButton, { borderColor: c.border, backgroundColor: c.input }]}
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
              style={styles.resetLink}
            >
              <ThemedText style={[styles.resetLinkText, { color: c.accent }]}>Reset to auto</ThemedText>
            </TouchableOpacity>
          )}
        </FieldGroup>

        {/* iOS date-picker modal — spinner display avoids the iOS 14+
            default-compact mode, which rendered a second inline picker
            that crashed when tapped. Android uses the imperative
            system dialog via `openDatePicker`. */}
        {Platform.OS === 'ios' && showDatePicker && (
          <Modal transparent animationType="fade" visible onRequestClose={() => setShowDatePicker(false)}>
            <Pressable style={styles.pickerBackdrop} onPress={() => setShowDatePicker(false)}>
              <Pressable
                style={[styles.pickerCard, { backgroundColor: c.card, borderColor: c.border }]}
                onPress={(e) => e.stopPropagation()}
              >
                <DateTimePicker
                  value={seasonStart}
                  mode="date"
                  display="spinner"
                  minimumDate={earliestStart}
                  maximumDate={effectiveSeasonEnd}
                  onChange={handleIOSChange}
                  textColor={c.text}
                  themeVariant={scheme}
                  style={styles.pickerBody}
                />
                <BrandButton
                  label="Done"
                  variant="primary"
                  size="default"
                  onPress={() => setShowDatePicker(false)}
                  fullWidth
                />
              </Pressable>
            </Pressable>
          </Modal>
        )}

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
          last={state.sport !== 'nba'}
        />
        {state.sport === 'nba' && (
          <FieldGroup
            label="NBA Cup Week"
            helperText="Combine the NBA Cup knockout week with the following week into one matchup, so the uneven tournament slate doesn't decide a week on its own. The All-Star break is always a double week."
          >
            <SegmentedControl
              options={['Separate weeks', 'Double week']}
              selectedIndex={state.combineCupWeek ? 1 : 0}
              onSelect={(i) => onChange('combineCupWeek', i === 1)}
            />
          </FieldGroup>
        )}
      </FormSection>

      {/* Season preview — treated as a Section so it visually aligns
          with the brand's gold-rule rhythm used in FormSection above. */}
      <Section title="Season Preview">
        {week1IsAtypical && (
          <ThemedText style={[styles.note, { color: c.secondaryText }]}>
            Week 1 is {week1Days > 7 ? 'a long' : 'a short'} week ({week1Days} days) ending Sunday.
          </ThemedText>
        )}
        {doubleWeekLabels.length > 0 && (
          <ThemedText style={[styles.note, { color: c.secondaryText }]}>
            {doubleWeekLabels.length === 1
              ? `${doubleWeekLabels[0]} is a double week — two weeks scored as one matchup.`
              : `Double weeks: ${doubleWeekLabels.join(', ')} — each scores two weeks as one matchup.`}
          </ThemedText>
        )}
        {terminalBreak && (
          <ThemedText style={[styles.note, { color: c.secondaryText }]}>
            Season ends before the {terminalBreak.label ?? 'late-season'} break, so playoffs finish cleanly.
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
          <ThemedText style={[styles.previewLabel, { color: c.secondaryText }]}>
            {terminalBreak ? `Last ${SPORT_DISPLAY[state.sport]} games` : `${SPORT_DISPLAY[state.sport]} season ends`}
          </ThemedText>
          <ThemedText style={[styles.previewValue, { color: c.secondaryText }]}>
            {formatDate(terminalBreak ? effectiveSeasonEnd : proSeasonEnd)}
          </ThemedText>
        </View>
      </Section>

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
  bracketPreview: {
    marginTop: s(10),
  },
  dateButton: {
    borderWidth: 1.5,
    borderRadius: 10,
    paddingVertical: s(10),
    paddingHorizontal: s(12),
  },
  // Explicitly set lineHeight close to the font size so text sits
  // centered in the button. ThemedText's `default` type's baked-in
  // lineHeight of ms(24) was sinking this 15px label toward the
  // bottom of the 44px-tall box (same issue as BrandTextInput).
  dateButtonText: {
    fontSize: ms(15),
    lineHeight: ms(18),
    fontWeight: '500',
  },
  resetLink: {
    marginTop: s(6),
    alignSelf: 'flex-start',
  },
  resetLinkText: {
    fontSize: ms(12),
    fontWeight: '500',
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(20),
  },
  pickerCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 14,
    borderWidth: 1,
    padding: s(16),
  },
  pickerBody: {
    alignSelf: 'center',
    marginBottom: s(8),
  },
  note: {
    fontSize: ms(13),
    marginBottom: s(10),
    fontStyle: 'italic',
  },
  previewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: s(4),
  },
  previewLabel: {
    fontSize: ms(14),
  },
  previewValue: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    marginVertical: s(8),
  },
  divisionNames: {
    flexDirection: 'row',
    gap: s(10),
    marginTop: s(10),
  },
  divisionInput: {
    flex: 1,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(12),
  },
  warningText: {
    fontSize: ms(13),
  },
});
