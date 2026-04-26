import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { PLAYER_LOCK_DISPLAY, PLAYER_LOCK_OPTIONS, PLAYER_LOCK_TO_DB, WAIVER_DAY_LABELS, WAIVER_TYPE_OPTIONS } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

const WAIVER_DISPLAY: Record<string, string> = { standard: 'Standard', faab: 'FAAB', none: 'None' };
const WAIVER_TO_DB: Record<string, string> = { Standard: 'standard', FAAB: 'faab', None: 'none' };

interface EditWaiverSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
}

export function EditWaiverSettingsModal({ visible, onClose, league, leagueId }: EditWaiverSettingsModalProps) {
  const c = useColors();
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
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Waiver Settings"
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
      {/* Waiver Type */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Waiver Type</ThemedText>
      </View>
      <View style={{ paddingVertical: s(8) }}>
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
          <View style={{ paddingVertical: s(8) }}>
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
      <View style={{ paddingVertical: s(8) }}>
        <SegmentedControl
          options={PLAYER_LOCK_OPTIONS}
          selectedIndex={PLAYER_LOCK_OPTIONS.indexOf(playerLock as any)}
          onSelect={(i) => setPlayerLock(PLAYER_LOCK_OPTIONS[i])}
        />
      </View>
      <ThemedText style={{ fontSize: ms(13), color: c.secondaryText, marginBottom: s(12) }}>
        {playerLock === 'Daily'
          ? 'Once the first NBA game starts each day, adds process the next day'
          : 'Players whose games have started cannot be added or dropped'}
      </ThemedText>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: s(12), borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: ms(14) },
});
