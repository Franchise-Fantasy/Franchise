import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

import { BracketPreview } from '@/components/playoff/BracketPreview';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { type Sport, getCurrentSeason, getMaxPlayoffWeeks, getSchedulableSeasonEnd, parseSeasonStartYear, PLAYOFF_SEEDING_OPTIONS, PlayoffSeedingOption, seedingDisplay, SEEDING_TO_DB, SPORT_OPENING_MONTH, startDateBelongsToSeason, TIEBREAKER_DISPLAY, TIEBREAKER_OPTIONS, TIEBREAKER_TO_DB, TiebreakerOption } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { getPlayoffTeamOptions, maxPlayoffWeeksForTeams, snapPlayoffTeams } from '@/utils/league/lottery';
import { minSeasonStartForDraft } from '@/utils/league/seasonStart';
import { computeMaxWeeks, defaultSeasonStart } from '@/utils/league/seasonWeeks';
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
  const [seedingFormat, setSeedingFormat] = useState<PlayoffSeedingOption>('Standard');
  const [tiebreakerPrimary, setTiebreakerPrimary] = useState<TiebreakerOption>('Head-to-Head');
  const [combineCupWeek, setCombineCupWeek] = useState(false);
  // ISO `yyyy-mm-dd`, or null when no date is set for the upcoming season yet.
  const [startDate, setStartDate] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saving, setSaving] = useState(false);

  const sport = (league?.sport as Sport) ?? 'nba';

  // Playoff structure is sized to the league's CONFIGURED size (`league.teams`),
  // not how many members have joined yet. A partially-filled create-league
  // league carries one `league_teams` row per join, so the `teamCount` prop
  // (joined rows) would clamp the bracket to 1–2 teams and write
  // playoff_teams=0 on any save. `league.teams` is the true bracket size;
  // fall back to the prop only if it's somehow unset.
  const bracketSize = (league?.teams as number | undefined) ?? teamCount;

  // Initialize from league when modal opens. Stored playoff values that the
  // team count can't support (a 2-team league carrying a 6-team / 3-week
  // playoff from an unclamped import) are healed here: weeks cap at what the
  // teams can bracket and playoffTeams snaps to a valid option, so the modal
  // previews — and Save persists — a bracket the engine can actually run.
  useEffect(() => {
    if (visible && league) {
      setRegWeeks(league.regular_season_weeks ?? 20);
      const weeks = Math.max(1, Math.min(
        league.playoff_weeks ?? 3,
        getMaxPlayoffWeeks(sport),
        maxPlayoffWeeksForTeams(bracketSize),
      ));
      setPlayoffWeeks(weeks);
      setPlayoffTeams(snapPlayoffTeams(
        league.playoff_teams ?? Math.min(2 ** weeks, bracketSize),
        weeks,
        bracketSize,
      ));
      setSeedingFormat(seedingDisplay(league.playoff_seeding_format, league.reseed_each_round ?? false));
      setCombineCupWeek(league.combine_cup_week ?? false);
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
  }, [visible, league, bracketSize]);

  const playoffTeamOptions = getPlayoffTeamOptions(playoffWeeks, bracketSize);
  const playoffTeamStrings = playoffTeamOptions.map(String);

  function handlePlayoffWeeksChange(value: number) {
    setPlayoffWeeks(value);
    setPlayoffTeams(snapPlayoffTeams(playoffTeams, value, bracketSize));
  }

  async function handleSave() {
    setSaving(true);

    // Refuse to set a start date that lands on or before a scheduled draft's
    // slate — fantasy scoring must begin the day AFTER the draft so games
    // played before picks were made don't count.
    if (startDate) {
      const { data: activeDraft } = await supabase
        .from('drafts')
        .select('draft_date, status')
        .eq('league_id', leagueId)
        .neq('status', 'complete')
        .not('draft_date', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (activeDraft?.draft_date) {
        const minStart = minSeasonStartForDraft({
          sport,
          season: league?.season ?? null,
          draftDate: new Date(activeDraft.draft_date),
        });
        if (startDate < minStart) {
          setSaving(false);
          Alert.alert(
            'Pick a later start date',
            `Your draft is scheduled for ${formatIsoDate(activeDraft.draft_date.slice(0, 10))}. The season needs to start on or after ${formatIsoDate(minStart)} so Week 1 has games and isn't a short stub.`,
          );
          return;
        }
      }
    }

    // Steppers enforce their max live, but the caps move when the Cup toggle
    // or start date change after a value was set — re-clamp at save so an
    // out-of-range combination can't reach the DB. Regular-season weeks yield
    // FIRST (a playoff round is only sacrificed when the season can't shrink
    // any further), matching applyCupWeekToggle and the wizards: flipping the
    // Cup double week on should cost a regular-season week, not a playoff round.
    const cappedPlayoffWeeks = Math.min(
      playoffWeeks,
      getMaxPlayoffWeeks(sport),
      maxPlayoffWeeksForTeams(bracketSize),
    );
    const safeRegWeeks = Math.max(1, Math.min(regWeeks, maxTotalWeeks - cappedPlayoffWeeks));
    const safePlayoffWeeks = Math.min(cappedPlayoffWeeks, Math.max(1, maxTotalWeeks - safeRegWeeks));
    const safePlayoffTeams = snapPlayoffTeams(playoffTeams, safePlayoffWeeks, bracketSize);

    const update: Record<string, unknown> = {
      regular_season_weeks: safeRegWeeks,
      playoff_weeks: safePlayoffWeeks,
      playoff_teams: safePlayoffTeams,
      playoff_seeding_format: (SEEDING_TO_DB[seedingFormat] ?? SEEDING_TO_DB.Standard).format,
      reseed_each_round: (SEEDING_TO_DB[seedingFormat] ?? SEEDING_TO_DB.Standard).reseed,
      tiebreaker_order: TIEBREAKER_TO_DB[tiebreakerPrimary],
      combine_cup_week: sport === 'nba' ? combineCupWeek : false,
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

  // Date-picker bounds: can't start before tomorrow — floored to the pro
  // season's opening night when that's still ahead (an NBA league can't start
  // scoring before the mid-October tipoff) — and can't run past the season's
  // schedulable end: the day before a terminal break (WNBA FIBA) when there is
  // one, else the pro season's regular-season end. The picker opens on the
  // chosen date, or the earliest legal start when nothing is set yet.
  // Memoized on `visible` — the modal stays mounted on league-info while
  // hidden, and defaultSeasonStart's Intl/timezone work shouldn't re-run on
  // every parent render; keying on open also refreshes the "tomorrow" floor
  // for long-lived mounts.
  const minStartDate = useMemo(
    () => defaultSeasonStart(sport, league?.season ?? getCurrentSeason(sport)),
    [visible, sport, league?.season],
  );
  const seasonEndStr = league?.season ? getSchedulableSeasonEnd(sport, league.season) : undefined;
  const maxDate = seasonEndStr
    ? new Date(seasonEndStr + 'T00:00:00')
    : undefined;
  const pickerValue = startDate ? new Date(startDate + 'T00:00:00') : minStartDate;

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
        minimumDate: minStartDate,
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

  // Cap weeks to what fits before the season's terminal break (WNBA FIBA) and
  // pro-season end — mirrors the create-league wizard so playoffs can't be
  // scheduled into/through the break (or past the real season). The Cup
  // double-week toggle consumes one extra calendar week, so it tightens the
  // cap by one when on.
  const maxTotalWeeks = computeMaxWeeks(
    league?.season ?? getCurrentSeason(sport),
    sport,
    startDate ? new Date(startDate + 'T00:00:00') : undefined,
    sport === 'nba' && combineCupWeek,
  );
  const maxRegWeeks = Math.max(1, maxTotalWeeks - playoffWeeks);
  // Playoff weeks also cap at what the team count can bracket (2 teams = a
  // 1-week final) so the schedule never gets trailing weeks the engine skips.
  const maxPlayoffWeeksCap = Math.min(
    getMaxPlayoffWeeks(sport),
    maxPlayoffWeeksForTeams(bracketSize),
    Math.max(1, maxTotalWeeks - regWeeks),
  );

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
            minimumDate={minStartDate}
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
        max={maxRegWeeks}
      />

      {/* Playoff Weeks */}
      <NumberStepper
        label="Playoff Weeks"
        value={playoffWeeks}
        onValueChange={handlePlayoffWeeksChange}
        min={1}
        max={maxPlayoffWeeksCap}
      />

      {/* NBA Cup Week — NBA only. All-Star / FIBA double weeks are unilateral. */}
      {sport === 'nba' && (
        <>
          <View style={[styles.editRow, { borderBottomColor: c.border }]}>
            <ThemedText style={styles.rowLabel}>NBA Cup Week</ThemedText>
          </View>
          <View style={{ marginBottom: s(12) }}>
            <SegmentedControl
              options={['Separate weeks', 'Double week']}
              selectedIndex={combineCupWeek ? 1 : 0}
              onSelect={(i) => setCombineCupWeek(i === 1)}
            />
            <ThemedText style={[styles.helperText, { color: c.secondaryText, marginTop: s(6) }]}>
              Combine the NBA Cup knockout week with the next into one matchup. Applies when the schedule is generated; the All-Star break is always a double week.
            </ThemedText>
          </View>
        </>
      )}

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
        <BracketPreview playoffTeams={playoffTeams} style={{ marginTop: s(10) }} />
      </View>

      {/* Seeding Format */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Seeding Format</ThemedText>
      </View>
      <View style={{ marginBottom: s(12) }}>
        <SegmentedControl
          options={PLAYOFF_SEEDING_OPTIONS}
          selectedIndex={Math.max(0, PLAYOFF_SEEDING_OPTIONS.indexOf(seedingFormat))}
          onSelect={(i) => setSeedingFormat(PLAYOFF_SEEDING_OPTIONS[i])}
        />
      </View>

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
