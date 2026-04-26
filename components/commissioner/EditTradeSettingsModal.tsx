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
import { ToggleRow } from '@/components/ui/ToggleRow';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

const VETO_OPTIONS = ['Commissioner', 'League Vote', 'None'] as const;

const VETO_DISPLAY: Record<string, string> = {
  commissioner: 'Commissioner',
  league_vote: 'League Vote',
  none: 'None',
};

const VETO_TO_DB: Record<string, string> = {
  Commissioner: 'commissioner',
  'League Vote': 'league_vote',
  None: 'none',
};

interface EditTradeSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
  teamCount: number;
}

export function EditTradeSettingsModal({
  visible,
  onClose,
  league,
  leagueId,
  teamCount,
}: EditTradeSettingsModalProps) {
  const c = useColors();
  const queryClient = useQueryClient();

  const [vetoType, setVetoType] = useState('Commissioner');
  const [reviewHours, setReviewHours] = useState(24);
  const [votesToVeto, setVotesToVeto] = useState(4);
  const [pickConditions, setPickConditions] = useState(false);
  const [autoRumors, setAutoRumors] = useState(false);
  const [tradeDeadlineWeek, setTradeDeadlineWeek] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !league) return;

    setVetoType(VETO_DISPLAY[league.trade_veto_type] ?? 'Commissioner');
    setReviewHours(league.trade_review_period_hours ?? 24);
    setVotesToVeto(league.trade_votes_to_veto ?? 4);
    setPickConditions(league.pick_conditions_enabled ?? false);
    setAutoRumors(league.auto_rumors_enabled ?? false);
    setTradeDeadlineWeek(calcDeadlineWeek());
  }, [visible]);

  function calcDeadlineWeek(): number {
    if (!league.trade_deadline || !league.season_start_date) return 0;
    const deadline = new Date(league.trade_deadline + 'T00:00:00');
    const start = new Date(league.season_start_date + 'T00:00:00');
    const startDay = start.getDay();
    const daysToFirstSunday = startDay === 0 ? 0 : 7 - startDay;
    const week1End = new Date(start);
    week1End.setDate(start.getDate() + daysToFirstSunday);
    const diffDays = Math.round(
      (deadline.getTime() - week1End.getTime()) / (1000 * 60 * 60 * 24)
    );
    return Math.max(1, Math.round(diffDays / 7) + 1);
  }

  async function handleSave() {
    setSaving(true);
    const vetoDb = VETO_TO_DB[vetoType] ?? 'commissioner';
    const { error } = await supabase
      .from('leagues')
      .update({
        trade_veto_type: vetoDb,
        trade_review_period_hours: vetoDb === 'none' ? 0 : reviewHours,
        trade_votes_to_veto: votesToVeto,
        pick_conditions_enabled: pickConditions,
        auto_rumors_enabled: autoRumors,
        trade_deadline:
          tradeDeadlineWeek > 0 && league.season_start_date
            ? (() => {
                const start = new Date(
                  league.season_start_date + 'T00:00:00'
                );
                const dayOfWeek = start.getDay();
                const daysToFirstSunday =
                  dayOfWeek === 0 ? 0 : 7 - dayOfWeek;
                const week1End = new Date(start);
                week1End.setDate(start.getDate() + daysToFirstSunday);
                const deadlineDate = new Date(week1End);
                deadlineDate.setDate(
                  week1End.getDate() + (tradeDeadlineWeek - 1) * 7
                );
                return `${deadlineDate.getFullYear()}-${String(deadlineDate.getMonth() + 1).padStart(2, '0')}-${String(deadlineDate.getDate()).padStart(2, '0')}`;
              })()
            : null,
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

  const vetoIndex = VETO_OPTIONS.indexOf(vetoType as (typeof VETO_OPTIONS)[number]);
  const maxDeadlineWeek = league?.regular_season_weeks ?? 20;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Trade Settings"
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
      {/* Veto Type */}
      <View style={[styles.editRow, { borderBottomColor: c.border }]}>
        <ThemedText style={styles.rowLabel}>Veto Type</ThemedText>
      </View>
      <View style={{ paddingVertical: s(8) }}>
        <SegmentedControl
          options={VETO_OPTIONS}
          selectedIndex={vetoIndex >= 0 ? vetoIndex : 0}
          onSelect={(i) => setVetoType(VETO_OPTIONS[i])}
        />
        <ThemedText style={[styles.helperText, { color: c.secondaryText, marginTop: s(6) }]}>
          {vetoType === 'Commissioner'
            ? 'Only the commissioner can veto trades during the review period.'
            : vetoType === 'League Vote'
              ? 'League members can vote to veto. The commissioner can also veto directly.'
              : 'Trades are processed immediately with no review period.'}
        </ThemedText>
      </View>

      {/* Review Period - shown when veto !== 'None' */}
      {vetoType !== 'None' && (
        <NumberStepper
          label="Review Period (hours)"
          value={reviewHours}
          onValueChange={setReviewHours}
          min={1}
          max={72}
        />
      )}

      {/* Votes to Veto - shown when veto === 'League Vote' */}
      {vetoType === 'League Vote' && (
        <NumberStepper
          label="Votes to Veto"
          value={votesToVeto}
          onValueChange={setVotesToVeto}
          min={1}
          max={teamCount - 1}
        />
      )}

      {/* Pick Protections & Swaps */}
      <ToggleRow
        icon="shield-checkmark-outline"
        label="Pick Protections & Swaps"
        value={pickConditions}
        onToggle={setPickConditions}
        c={c}
      />

      {/* League Intel */}
      <ToggleRow
        icon="megaphone-outline"
        label="League Intel"
        description="Automatically announce when multiple teams are bidding or interested in the same player"
        value={autoRumors}
        onToggle={setAutoRumors}
        c={c}
      />

      {/* Trade Deadline */}
      <NumberStepper
        label="Trade Deadline (Week)"
        value={tradeDeadlineWeek}
        onValueChange={setTradeDeadlineWeek}
        min={0}
        max={maxDeadlineWeek}
      />
      <ThemedText style={[styles.helperText, { color: c.secondaryText }]}>
        {tradeDeadlineWeek === 0
          ? 'No trade deadline — trades allowed all season.'
          : `Trades lock after Week ${tradeDeadlineWeek}.`}
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
  rowLabel: { fontSize: ms(14) },
  helperText: { fontSize: ms(13), marginTop: s(2) },
});
