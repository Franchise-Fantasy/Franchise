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
import {
  FAAB_TIEBREAK_DISPLAY,
  FAAB_TIEBREAK_OPTIONS,
  FAAB_TIEBREAK_TO_DB,
  FaabTiebreakOption,
  PLAYER_LOCK_DISPLAY,
  PLAYER_LOCK_OPTIONS,
  PLAYER_LOCK_TO_DB,
  WAIVER_PRIORITY_RESET_DISPLAY,
  WAIVER_PRIORITY_RESET_OPTIONS,
  WAIVER_PRIORITY_RESET_TO_DB,
  WAIVER_TYPE_OPTIONS,
  WaiverPriorityResetOption,
} from '@/constants/LeagueDefaults';
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
  // NFL: one weekly waiver run (Wed 5am ET) and a fixed kickoff lock — the
  // day-period and lock pickers have nothing to choose. See the waiver_until
  // RPC, which owns the cadence for every writer of league_waivers.
  const isNfl = league?.sport === 'nfl';

  const [waiverType, setWaiverType] = useState('Standard');
  const [waiverPeriod, setWaiverPeriod] = useState(2);
  const [faabBudget, setFaabBudget] = useState(100);
  const [faabTiebreak, setFaabTiebreak] = useState<FaabTiebreakOption>('Earliest Bid');
  const [priorityReset, setPriorityReset] = useState<WaiverPriorityResetOption>('Reverse Standings');
  const [weeklyLimit, setWeeklyLimit] = useState(0);
  const [playerLock, setPlayerLock] = useState('Daily');
  const [saving, setSaving] = useState(false);

  // Initialize from league when modal opens
  useEffect(() => {
    if (visible && league) {
      setWaiverType(WAIVER_DISPLAY[league.waiver_type] ?? 'Standard');
      setWaiverPeriod(league.waiver_period_days ?? 2);
      setFaabBudget(league.faab_budget ?? 100);
      setFaabTiebreak(FAAB_TIEBREAK_DISPLAY[league.faab_tiebreak] ?? 'Earliest Bid');
      setPriorityReset(WAIVER_PRIORITY_RESET_DISPLAY[league.waiver_priority_reset] ?? 'Reverse Standings');
      setWeeklyLimit(league.weekly_acquisition_limit ?? 0);
      setPlayerLock(PLAYER_LOCK_DISPLAY[league.player_lock_type] ?? 'Daily');
    }
  }, [visible, league]);

  // Priority order only matters for Standard leagues, or FAAB leagues that break
  // equal-bid ties by waiver priority (matches process-waivers / advance-season).
  const priorityResetRelevant =
    waiverType === 'Standard' || (waiverType === 'FAAB' && faabTiebreak === 'Waiver Priority');

  async function handleSave() {
    setSaving(true);
    const waiverDb = WAIVER_TO_DB[waiverType] ?? 'standard';
    const { error } = await supabase.from('leagues').update({
      waiver_type: waiverDb,
      waiver_period_days: waiverDb === 'none' ? 0 : waiverPeriod,
      faab_budget: faabBudget,
      faab_tiebreak: FAAB_TIEBREAK_TO_DB[faabTiebreak],
      waiver_priority_reset: WAIVER_PRIORITY_RESET_TO_DB[priorityReset],
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

      {/* Waiver Period (not shown for 'None'; NFL runs a fixed weekly clear) */}
      {waiverType !== 'None' && (
        isNfl ? (
          <View style={[styles.editRow, { borderBottomColor: c.border }]}>
            <ThemedText style={styles.rowLabel}>Waiver Run</ThemedText>
            <ThemedText style={[styles.rowValue, { color: c.secondaryText }]}>
              Weekly · Wed 5:00 AM ET
            </ThemedText>
          </View>
        ) : (
          <NumberStepper
            label="Waiver Period"
            value={waiverPeriod}
            onValueChange={setWaiverPeriod}
            min={1}
            max={5}
            suffix=" days"
          />
        )
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

      {/* FAAB Bid Tiebreaker (FAAB only) */}
      {waiverType === 'FAAB' && (
        <>
          <View style={[styles.editRow, { borderBottomColor: c.border }]}>
            <ThemedText style={styles.rowLabel}>Bid Tiebreaker</ThemedText>
          </View>
          <View style={{ paddingVertical: s(8) }}>
            <SegmentedControl
              options={FAAB_TIEBREAK_OPTIONS}
              selectedIndex={Math.max(0, FAAB_TIEBREAK_OPTIONS.indexOf(faabTiebreak))}
              onSelect={(i) => setFaabTiebreak(FAAB_TIEBREAK_OPTIONS[i])}
            />
          </View>
        </>
      )}

      {/* Waiver Priority Reset (Standard, or FAAB w/ priority tiebreak) */}
      {priorityResetRelevant && (
        <>
          <View style={[styles.editRow, { borderBottomColor: c.border }]}>
            <ThemedText style={styles.rowLabel}>Priority Reset (New Season)</ThemedText>
          </View>
          <View style={{ paddingVertical: s(8) }}>
            <SegmentedControl
              options={WAIVER_PRIORITY_RESET_OPTIONS}
              selectedIndex={Math.max(0, WAIVER_PRIORITY_RESET_OPTIONS.indexOf(priorityReset))}
              onSelect={(i) => setPriorityReset(WAIVER_PRIORITY_RESET_OPTIONS[i])}
            />
          </View>
          <ThemedText style={{ fontSize: ms(13), color: c.secondaryText, marginBottom: s(12) }}>
            {priorityReset === 'Reverse Standings'
              ? 'Each new season, the worst finisher gets first waiver priority.'
              : priorityReset === 'Keep'
                ? "Carry the previous season's ending waiver order into the new season."
                : 'Shuffle waiver priority randomly at the start of each new season.'}
          </ThemedText>
        </>
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

      {/* Player Lock — NFL has one model (kickoff, for the week), so there's
          nothing to pick; state the rule instead of offering a false choice. */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Player Lock</ThemedText>
        {isNfl && (
          <ThemedText style={[styles.rowValue, { color: c.secondaryText }]}>
            At kickoff (weekly)
          </ThemedText>
        )}
      </View>
      {!isNfl && (
        <View style={{ paddingVertical: s(8) }}>
          <SegmentedControl
            options={PLAYER_LOCK_OPTIONS}
            selectedIndex={PLAYER_LOCK_OPTIONS.indexOf(playerLock as any)}
            onSelect={(i) => setPlayerLock(PLAYER_LOCK_OPTIONS[i])}
          />
        </View>
      )}
      <ThemedText style={{ fontSize: ms(13), color: c.secondaryText, marginBottom: s(12) }}>
        {isNfl
          ? "Each player locks at their game's kickoff and stays locked for that week. Players who haven't played yet can be moved all week."
          : playerLock === 'Daily'
            ? 'Once the first game of the day starts, lineups, adds, and drops lock for the day.'
            : 'Lineup changes, adds, and drops for a player lock the moment their game starts.'}
      </ThemedText>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: s(12), borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: ms(14) },
  rowValue: { fontSize: ms(13) },
});
