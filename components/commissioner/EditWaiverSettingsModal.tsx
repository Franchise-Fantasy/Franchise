import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { PLAYER_LOCK_DISPLAY, PLAYER_LOCK_OPTIONS, PLAYER_LOCK_TO_DB, WAIVER_DAY_LABELS, WAIVER_TYPE_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

const WAIVER_DISPLAY: Record<string, string> = { standard: 'Standard', faab: 'FAAB', none: 'None' };
const WAIVER_TO_DB: Record<string, string> = { Standard: 'standard', FAAB: 'faab', None: 'none' };

interface EditWaiverSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
}

export function EditWaiverSettingsModal({ visible, onClose, league, leagueId }: EditWaiverSettingsModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [waiverType, setWaiverType] = useState('Standard');
  const [waiverPeriod, setWaiverPeriod] = useState(2);
  const [faabBudget, setFaabBudget] = useState(100);
  const [waiverDay, setWaiverDay] = useState(3);
  const [weeklyLimit, setWeeklyLimit] = useState(0);
  const [playerLock, setPlayerLock] = useState('Daily');
  const [saving, setSaving] = useState(false);

  // Initialize from league when modal opens
  useEffect(() => {
    if (visible && league) {
      setWaiverType(WAIVER_DISPLAY[league.waiver_type] ?? 'Standard');
      setWaiverPeriod(league.waiver_period_days ?? 2);
      setFaabBudget(league.faab_budget ?? 100);
      setWaiverDay(league.waiver_day_of_week ?? 3);
      setWeeklyLimit(league.weekly_acquisition_limit ?? 0);
      setPlayerLock(PLAYER_LOCK_DISPLAY[league.player_lock_type] ?? 'Daily');
    }
  }, [visible, league]);

  async function handleSave() {
    setSaving(true);
    const waiverDb = WAIVER_TO_DB[waiverType] ?? 'standard';
    const { error } = await supabase.from('leagues').update({
      waiver_type: waiverDb,
      waiver_period_days: waiverDb === 'none' ? 0 : waiverPeriod,
      faab_budget: faabBudget,
      waiver_day_of_week: waiverDay,
      weekly_acquisition_limit: weeklyLimit === 0 ? null : weeklyLimit,
      player_lock_type: PLAYER_LOCK_TO_DB[playerLock as keyof typeof PLAYER_LOCK_TO_DB] ?? 'daily',
    }).eq('id', leagueId);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    onClose();
  }

  const typeIndex = WAIVER_TYPE_OPTIONS.indexOf(waiverType as any);

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}} accessibilityViewIsModal={true}>
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          {/* Title */}
          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Waiver Settings</ThemedText>
          </View>

          <ScrollView style={styles.scroll} bounces={false} nestedScrollEnabled>
            {/* Waiver Type */}
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Waiver Type</ThemedText>
            </View>
            <View style={{ paddingVertical: 8 }}>
              <SegmentedControl
                options={WAIVER_TYPE_OPTIONS}
                selectedIndex={typeIndex >= 0 ? typeIndex : 0}
                onSelect={(i) => setWaiverType(WAIVER_TYPE_OPTIONS[i])}
              />
            </View>

            {/* Waiver Period (not shown for 'None') */}
            {waiverType !== 'None' && (
              <NumberStepper
                label="Waiver Period"
                value={waiverPeriod}
                onValueChange={setWaiverPeriod}
                min={1}
                max={5}
                suffix=" days"
              />
            )}

            {/* Process Day (FAAB only) */}
            {waiverType === 'FAAB' && (
              <>
                <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                  <ThemedText style={styles.rowLabel}>Process Day</ThemedText>
                </View>
                <View style={{ paddingVertical: 8 }}>
                  <SegmentedControl
                    options={WAIVER_DAY_LABELS}
                    selectedIndex={waiverDay}
                    onSelect={setWaiverDay}
                  />
                </View>
              </>
            )}

            {/* FAAB Budget (FAAB only) */}
            {waiverType === 'FAAB' && (
              <NumberStepper
                label="FAAB Budget"
                value={faabBudget}
                onValueChange={setFaabBudget}
                min={10}
                max={1000}
                step={10}
                suffix="$"
              />
            )}

            {/* Weekly Acquisition Limit */}
            <NumberStepper
              label="Weekly Add Limit"
              value={weeklyLimit}
              onValueChange={setWeeklyLimit}
              min={0}
              max={20}
              suffix={weeklyLimit === 0 ? ' (unlimited)' : ' per week'}
              accessibilityLabel="Weekly acquisition limit, 0 means unlimited"
            />

            {/* Player Lock */}
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Player Lock</ThemedText>
            </View>
            <View style={{ paddingVertical: 8 }}>
              <SegmentedControl
                options={PLAYER_LOCK_OPTIONS}
                selectedIndex={PLAYER_LOCK_OPTIONS.indexOf(playerLock as any)}
                onSelect={(i) => setPlayerLock(PLAYER_LOCK_OPTIONS[i])}
              />
            </View>
            <ThemedText style={{ fontSize: 13, color: c.secondaryText, marginBottom: 12 }}>
              {playerLock === 'Daily'
                ? 'Once the first NBA game starts each day, adds process the next day'
                : 'Players whose games have started cannot be added or dropped'}
            </ThemedText>
          </ScrollView>

          {/* Footer */}
          <View style={[styles.footer, { borderTopColor: c.border }]}>
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
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.btnText, { color: c.accentText }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12, paddingBottom: 40, maxHeight: '85%' },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  titleRow: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 16, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '600' },
  scroll: { flexShrink: 1, paddingHorizontal: 16 },
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 14 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 15, fontWeight: '600' },
});
