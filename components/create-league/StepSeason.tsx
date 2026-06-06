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
  getSeasonEnd,
  LeagueWizardState,
  PLAYOFF_SEEDING_OPTIONS,
  SPORT_DISPLAY,
  type Sport,
  TIEBREAKER_OPTIONS,
} from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { calcLotteryPoolSize, getPlayoffTeamOptions } from '@/utils/league/lottery';
import { week1Length } from '@/utils/leagueTime';
import { ms, s } from '@/utils/scale';

interface StepSeasonProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

// Default fantasy-season start: tomorrow, regardless of weekday. A league can
// never start on the day it's created — scoring needs at least a full day's
// lead so the opening slate isn't already underway. Week 1 then absorbs
// whatever leading days fall before the next Sunday — see `week1Length` in
// utils/leagueTime: Mon/Tue/Wed produce a 5-7 day Week 1, Thu/Fri/Sat/Sun
// produce an 8-11 day Week 1 ending the second Sunday.
export function computeSeasonStart(): Date {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() + 1);
  return start;
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Max weeks between season start and pro season end (sport-aware).
 *  Week 1 absorbs any Thu/Fri/Sat/Sun leading days (8-11 day long week);
 *  Mon/Tue/Wed starts give a 5-7 day Week 1. Week 2+ are full Mon–Sun.
 *  `sport` defaults to 'nba' for back-compat with module-level callers
 *  that initialize NBA wizards. */
export function computeMaxWeeks(season: string, sport: Sport = 'nba', customStart?: Date): number {
  const start = customStart ?? computeSeasonStart();
  const endStr = getSeasonEnd(sport, season) ?? getSeasonEnd(sport, getCurrentSeason(sport))!;
  const [y, m, d] = endStr.split('-').map(Number);
  const msPerDay = 24 * 60 * 60 * 1000;

  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(y, m - 1, d);

  // Week 1 ends the FIRST Sunday for Mon/Tue/Wed starts, the SECOND
  // Sunday for Thu/Fri/Sat/Sun — keeps Week 1 ≥ 5 days without ever
  // delaying the first matchup beyond the league's opener.
  const startDow = start.getDay(); // 0=Sun
  const week1Len = week1Length(startDow); // 5..11 days
  const week1EndUtc = startUtc + (week1Len - 1) * msPerDay;

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
  const week1Days = week1Length(startDow);
  const week1IsAtypical = week1Days !== 7; // anything other than Mon-Sun

  // Pro-league season boundary (sport-aware) — parse as local midnight to
  // avoid UTC timezone shift.
  const proEndStr = getSeasonEnd(state.sport, state.season) ?? getSeasonEnd(state.sport, getCurrentSeason(state.sport))!;
  const [y, m, d] = proEndStr.split('-').map(Number);
  const proSeasonEnd = new Date(y, m - 1, d);

  const maxTotalWeeks = computeMaxWeeks(state.season, state.sport, seasonStart);

  // Earliest selectable date is tomorrow — a league can't start the day it's
  // created (matches computeSeasonStart's default).
  const earliestStart = new Date();
  earliestStart.setHours(0, 0, 0, 0);
  earliestStart.setDate(earliestStart.getDate() + 1);

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
        maximumDate: proSeasonEnd,
        onChange: (_e, date) => {
          if (date) commitDate(date);
        },
      });
    } else {
      setShowDatePicker(true);
    }
  };

  const maxRegularSeasonWeeks = Math.max(1, maxTotalWeeks - state.playoffWeeks);
  // Playoff weeks are capped by both the remaining season AND the sport's
  // structural max (NBA 4 = 16-team bracket, WNBA 3 = 8-team bracket).
  // Without the sport cap WNBA leagues could pick 5-7 playoff weeks that
  // can't form a valid bracket against the supported PLAYOFF_OPTIONS.
  const maxPlayoffWeeks = Math.min(
    getMaxPlayoffWeeks(state.sport),
    Math.max(1, maxTotalWeeks - state.regularSeasonWeeks),
  );

  // Week 1 absorbs Thu/Fri/Sat/Sun leading days (long first week ending
  // the second Sunday) so the league never waits a full week for its first
  // matchup. Mon/Tue/Wed start give a short 5-7 day Week 1.
  const week1End = new Date(seasonStart);
  week1End.setDate(seasonStart.getDate() + week1Days - 1);

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
                  maximumDate={proSeasonEnd}
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
          last
        />
      </FormSection>

      {/* Season preview — treated as a Section so it visually aligns
          with the brand's gold-rule rhythm used in FormSection above. */}
      <Section title="Season Preview">
        {week1IsAtypical && (
          <ThemedText style={[styles.note, { color: c.secondaryText }]}>
            Week 1 is {week1Days > 7 ? 'a long' : 'a short'} week ({week1Days} days) ending Sunday.
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
          <ThemedText style={[styles.previewLabel, { color: c.secondaryText }]}>{SPORT_DISPLAY[state.sport]} season ends</ThemedText>
          <ThemedText style={[styles.previewValue, { color: c.secondaryText }]}>{formatDate(proSeasonEnd)}</ThemedText>
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
