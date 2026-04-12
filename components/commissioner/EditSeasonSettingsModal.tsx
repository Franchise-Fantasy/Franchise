import { ThemedText } from '@/components/ui/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { PLAYOFF_SEEDING_OPTIONS, SEEDING_DISPLAY, SEEDING_TO_DB, TIEBREAKER_DISPLAY, TIEBREAKER_OPTIONS, TIEBREAKER_TO_DB, TiebreakerOption } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
import { getPlayoffTeamOptions } from '@/utils/lottery';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [regWeeks, setRegWeeks] = useState(20);
  const [playoffWeeks, setPlayoffWeeks] = useState(3);
  const [playoffTeams, setPlayoffTeams] = useState(4);
  const [seedingFormat, setSeedingFormat] = useState('Standard');
  const [reseed, setReseed] = useState(false);
  const [tiebreakerPrimary, setTiebreakerPrimary] = useState<TiebreakerOption>('Head-to-Head');
  const [saving, setSaving] = useState(false);

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
    const { error } = await supabase
      .from('leagues')
      .update({
        regular_season_weeks: regWeeks,
        playoff_weeks: playoffWeeks,
        playoff_teams: playoffTeams,
        playoff_seeding_format: SEEDING_TO_DB[seedingFormat] ?? 'standard',
        reseed_each_round: reseed,
        tiebreaker_order: TIEBREAKER_TO_DB[tiebreakerPrimary],
      })
      .eq('id', leagueId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    onClose();
  }

  const formattedStartDate = league?.season_start_date
    ? new Date(league.season_start_date + 'T00:00:00').toLocaleDateString()
    : '-';

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { backgroundColor: c.card }]} accessibilityViewIsModal={true}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          {/* Title */}
          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Season Settings</ThemedText>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            {/* Start Date (read-only) */}
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Start Date</ThemedText>
              <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>
                {formattedStartDate}
              </ThemedText>
            </View>

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
          </ScrollView>

          {/* Footer */}
          <View style={styles.footer}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel" style={[styles.btn, { backgroundColor: c.cardAlt }]} onPress={onClose}>
              <ThemedText style={styles.btnText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Save"
              accessibilityState={{ disabled: saving }}
              style={[styles.btn, { backgroundColor: saving ? c.buttonDisabled : c.accent }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <LogoSpinner size={18} />
              ) : (
                <ThemedText style={[styles.btnText, { color: c.accentText }]}>Save</ThemedText>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'transparent',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: s(12),
    paddingBottom: s(40),
    maxHeight: '85%',
  },
  handle: {
    width: s(40),
    height: s(4),
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: s(12),
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: s(16),
    marginBottom: s(16),
  },
  title: {
    fontSize: ms(17),
    fontWeight: '600',
  },
  scroll: {
    flexShrink: 1,
    paddingHorizontal: s(16),
  },
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
  helperText: {
    fontSize: ms(13),
    marginTop: s(2),
  },
  footer: {
    flexDirection: 'row',
    gap: s(12),
    paddingHorizontal: s(16),
    paddingTop: s(16),
  },
  btn: {
    flex: 1,
    paddingVertical: s(14),
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
});
