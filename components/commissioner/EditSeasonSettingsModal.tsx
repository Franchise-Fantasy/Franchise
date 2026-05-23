import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { getSeasonEnd, parseSeasonStartYear, PLAYOFF_SEEDING_OPTIONS, SEEDING_DISPLAY, SEEDING_TO_DB, SPORT_OPENING_MONTH, startDateBelongsToSeason, TIEBREAKER_DISPLAY, TIEBREAKER_OPTIONS, TIEBREAKER_TO_DB, TiebreakerOption } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { getPlayoffTeamOptions } from '@/utils/league/lottery';
import { ms, s } from '@/utils/scale';

// Format an ISO `yyyy-mm-dd` (parsed as local midnight) for display.
function formatIsoDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Convert a Date to a local `yyyy-mm-dd` string (no UTC shift).
function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

interface EditSeasonSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
  teamCount: number;
}

export function EditSeasonSettingsModal({
  visible,
  onClose,
  league,
  leagueId,
  teamCount,
}: EditSeasonSettingsModalProps) {
  const c = useColors();
  const scheme = useColorScheme() ?? 'light';
  const queryClient = useQueryClient();

  const [regWeeks, setRegWeeks] = useState(20);
  const [playoffWeeks, setPlayoffWeeks] = useState(3);
  const [playoffTeams, setPlayoffTeams] = useState(4);
  const [seedingFormat, setSeedingFormat] = useState('Standard');
  const [reseed, setReseed] = useState(false);
  const [tiebreakerPrimary, setTiebreakerPrimary] = useState<TiebreakerOption>('Head-to-Head');
  // ISO `yyyy-mm-dd`, or null when no date is set for the upcoming season yet.
  const [startDate, setStartDate] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const sport = (league?.sport as 'nba' | 'wnba') ?? 'nba';

  // Initialize from league when modal opens
  useEffect(() => {
    if (visible && league) {
      setRegWeeks(league.regular_season_weeks ?? 20);
      setPlayoffWeeks(league.playoff_weeks ?? 3);
      setPlayoffTeams(
        league.playoff_teams ?? Math.min(2 ** (league.playoff_weeks ?? 3), teamCount)
      );
      setSeedingFormat(SEEDING_DISPLAY[league.playoff_seeding_format] ?? 'Standard');
      setReseed(league.reseed_each_round ?? false);
      const primaryKey = (league.tiebreaker_order ?? ['head_to_head', 'points_for'])[0];
      setTiebreakerPrimary((TIEBREAKER_DISPLAY[primaryKey] ?? 'Head-to-Head') as TiebreakerOption);
      // A stored date that predates `league.season` (offseason carry-over)
      // counts as unset so the field prompts for the new season's date.
      setStartDate(
        startDateBelongsToSeason(league.season, league.season_start_date)
          ? league.season_start_date
          : null,
      );
      setShowDatePicker(false);
    }
  }, [visible, league, teamCount]);

  const playoffTeamOptions = getPlayoffTeamOptions(playoffWeeks, teamCount);
  const playoffTeamStrings = playoffTeamOptions.map(String);

  function handlePlayoffWeeksChange(value: number) {
    setPlayoffWeeks(value);
    const options = getPlayoffTeamOptions(value, teamCount);
    if (!options.includes(playoffTeams)) {
      const closest = options.reduce(
        (best, o) => (Math.abs(o - playoffTeams) < Math.abs(best - playoffTeams) ? o : best),
        options[0]
      );
      setPlayoffTeams(closest);
    }
  }

  function handleSeedingChange(index: number) {
    const format = PLAYOFF_SEEDING_OPTIONS[index];
    setSeedingFormat(format);
    if (format === 'Fixed Bracket') {
      setReseed(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    const update: Record<string, unknown> = {
      regular_season_weeks: regWeeks,
      playoff_weeks: playoffWeeks,
      playoff_teams: playoffTeams,
      playoff_seeding_format: SEEDING_TO_DB[seedingFormat] ?? 'standard',
      reseed_each_round: reseed,
      tiebreaker_order: TIEBREAKER_TO_DB[tiebreakerPrimary],
    };
    // Only persist the start date when one has actually been picked — never
    // overwrite the stored value with null if the commissioner left it unset.
    if (startDate) update.season_start_date = startDate;

    const { error } = await supabase
      .from('leagues')
      .update(update)
      .eq('id', leagueId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    onClose();
  }

  // Date-picker bounds: can't start in the past, can't run past the pro
  // season's regular-season end. The picker opens on the chosen date, or a
  // sensible default near today when nothing is set yet.
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const seasonEndStr = league?.season ? getSeasonEnd(sport, league.season) : undefined;
  const maxDate = seasonEndStr
    ? new Date(seasonEndStr + 'T00:00:00')
    : undefined;
  const pickerValue = startDate ? new Date(startDate + 'T00:00:00') : today;

  const commitDate = (date: Date) => {
    date.setHours(0, 0, 0, 0);
    setStartDate(toIsoDate(date));
  };

  // Android shows the native system dialog (not an RN Modal). iOS renders an
  // inline spinner below the row — a nested <Modal> inside the BottomSheet's
  // own Modal freezes taps on iOS (see CLAUDE.md realtime/modal notes).
  const openDatePicker = () => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: pickerValue,
        mode: 'date',
        minimumDate: today,
        maximumDate: maxDate,
        onChange: (_e: DateTimePickerEvent, date?: Date) => {
          if (date) commitDate(date);
        },
      });
    } else {
      setShowDatePicker((v) => !v);
    }
  };

  const startDateLabel = startDate
    ? formatIsoDate(startDate)
    : (() => {
        const month = SPORT_OPENING_MONTH[sport];
        const year = league?.season ? parseSeasonStartYear(league.season) : undefined;
        return month && year ? `Set date · ~${month} ${year}` : 'Set date';
      })();

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Season Settings"
      footer={
        <View style={styles.footer}>
          <BrandButton
            label="Cancel"
            variant="secondary"
            size="large"
            onPress={onClose}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Cancel"
          />
          <BrandButton
            label="Save"
            variant="primary"
            size="large"
            onPress={handleSave}
            loading={saving}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Save"
          />
        </View>
      }
    >
      {/* Start Date — editable until the schedule is generated */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Start Date</ThemedText>
        <TouchableOpacity
          onPress={openDatePicker}
          accessibilityRole="button"
          accessibilityLabel={
            startDate
              ? `Season start date: ${startDateLabel}. Tap to change.`
              : 'Season start date not set. Tap to choose.'
          }
        >
          <ThemedText style={[styles.rowLabel, { color: c.accent }]}>
            {startDateLabel}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* iOS inline spinner — rendered in-place (no nested Modal) */}
      {Platform.OS === 'ios' && showDatePicker && (
        <View style={styles.pickerWrap}>
          <DateTimePicker
            value={pickerValue}
            mode="date"
            display="spinner"
            minimumDate={today}
            maximumDate={maxDate}
            onChange={(_e: DateTimePickerEvent, date?: Date) => {
              if (date) commitDate(date);
            }}
            textColor={c.text}
            themeVariant={scheme}
            style={styles.picker}
          />
          <BrandButton
            label="Done"
            variant="primary"
            size="default"
            onPress={() => setShowDatePicker(false)}
            fullWidth
            accessibilityLabel="Done choosing start date"
          />
        </View>
      )}

      {/* Divisions (read-only) */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Divisions</ThemedText>
        <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>
          {league?.division_count === 2
            ? `${league.division_1_name ?? 'Division 1'} & ${league.division_2_name ?? 'Division 2'}`
            : 'None'}
        </ThemedText>
      </View>

      {/* Regular Season Weeks */}
      <NumberStepper
        label="Regular Season Weeks"
        value={regWeeks}
        onValueChange={setRegWeeks}
        min={1}
        max={30}
      />

      {/* Playoff Weeks */}
      <NumberStepper
        label="Playoff Weeks"
        value={playoffWeeks}
        onValueChange={handlePlayoffWeeksChange}
        min={1}
        max={6}
      />

      {/* Playoff Teams */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Playoff Teams</ThemedText>
      </View>
      <View style={{ marginBottom: s(12) }}>
        <SegmentedControl
          options={playoffTeamStrings}
          selectedIndex={playoffTeamOptions.indexOf(playoffTeams)}
          onSelect={(i) => setPlayoffTeams(playoffTeamOptions[i])}
        />
      </View>

      {/* Seeding Format */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Seeding Format</ThemedText>
      </View>
      <View style={{ marginBottom: s(12) }}>
        <SegmentedControl
          options={PLAYOFF_SEEDING_OPTIONS}
          selectedIndex={PLAYOFF_SEEDING_OPTIONS.indexOf(
            seedingFormat as (typeof PLAYOFF_SEEDING_OPTIONS)[number]
          )}
          onSelect={handleSeedingChange}
        />
      </View>

      {/* Reseed Each Round (only for Standard) */}
      {seedingFormat === 'Standard' && (
        <>
          <View style={[styles.editRow, { borderBottomColor: c.border }]}>
            <ThemedText style={styles.rowLabel}>Reseed Each Round</ThemedText>
          </View>
          <View style={{ marginBottom: s(12) }}>
            <SegmentedControl
              options={['Yes', 'No']}
              selectedIndex={reseed ? 0 : 1}
              onSelect={(i) => setReseed(i === 0)}
            />
          </View>
        </>
      )}

      {/* Tiebreaker Priority */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Tiebreaker Priority</ThemedText>
      </View>
      <View style={{ marginBottom: s(12) }}>
        <SegmentedControl
          options={TIEBREAKER_OPTIONS}
          selectedIndex={TIEBREAKER_OPTIONS.indexOf(tiebreakerPrimary)}
          onSelect={(i) => setTiebreakerPrimary(TIEBREAKER_OPTIONS[i])}
        />
        <ThemedText style={[styles.helperText, { color: c.secondaryText, marginTop: s(6) }]}>
          {tiebreakerPrimary === 'Head-to-Head'
            ? 'Tied teams compared by head-to-head record first, then total points.'
            : 'Tied teams compared by total points first, then head-to-head record.'}
        </ThemedText>
      </View>

      <ThemedText style={[styles.helperText, { color: c.secondaryText }]}>
        Changes take effect for future weeks. Active matchups are not affected.
      </ThemedText>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: {
    fontSize: ms(14),
  },
  pickerWrap: {
    marginBottom: s(12),
  },
  picker: {
    alignSelf: 'center',
    marginBottom: s(8),
  },
  helperText: {
    fontSize: ms(13),
    marginTop: s(2),
  },
});
