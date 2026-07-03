import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  StyleSheet,
  View,
} from 'react-native';

import { AnimatedSection } from '@/components/ui/AnimatedSection';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { DateField } from '@/components/ui/DateField';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { defaultTradeDeadlineWeek } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { formatIsoDate, parseLocalDate } from '@/utils/dates';
import { regularSeasonWeekEndDates, weekNumberForDate } from '@/utils/league/seasonWeeks';
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
  // ISO `yyyy-mm-dd`, or null for no deadline — this is the actual persisted
  // value; the "Deadline Week" stepper below is a quick-set shortcut that
  // derives it, not a separate source of truth.
  const [tradeDeadlineDate, setTradeDeadlineDate] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !league) return;

    setVetoType(VETO_DISPLAY[league.trade_veto_type] ?? 'Commissioner');
    setReviewHours(league.trade_review_period_hours ?? 24);
    setVotesToVeto(league.trade_votes_to_veto ?? 4);
    setPickConditions(league.pick_conditions_enabled ?? false);
    setAutoRumors(league.auto_rumors_enabled ?? false);
    setTradeDeadlineDate(league.trade_deadline ?? null);
  }, [visible]);

  const hasStartDate = !!league?.season_start_date;

  // Regular-season week end dates (merge-window aware) — powers the
  // "Deadline Week" quick-set shortcut and bounds the date picker to the
  // actual last day of the regular season. Empty when the league has no
  // start date yet (nothing to measure weeks from).
  const weeks = useMemo(() => {
    if (!hasStartDate) return [];
    return regularSeasonWeekEndDates(
      league.sport ?? 'nba',
      league.season,
      parseLocalDate(league.season_start_date),
      league.regular_season_weeks ?? 20,
      league.combine_cup_week ?? false,
    );
  }, [
    hasStartDate,
    league?.sport,
    league?.season,
    league?.season_start_date,
    league?.regular_season_weeks,
    league?.combine_cup_week,
  ]);
  const maxDeadlineWeek = weeks.length || (league?.regular_season_weeks ?? 20);
  const deadlineWeek = tradeDeadlineDate ? weekNumberForDate(weeks, tradeDeadlineDate) : 1;

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
        trade_deadline: hasStartDate ? tradeDeadlineDate : null,
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

      {/* Trade Deadline — toggle gates the date/week fields so "no deadline"
          is a clear binary choice instead of the confusing "0 = no limit"
          stepper convention. The date is the actual persisted value; the
          week stepper is a quick-set shortcut that derives it. */}
      <ToggleRow
        icon="calendar-outline"
        label="Trade Deadline"
        description={
          !hasStartDate
            ? 'Set a season start date before adding a trade deadline.'
            : tradeDeadlineDate
              ? `Trades lock after ${formatIsoDate(tradeDeadlineDate)}.`
              : 'Trades allowed all season.'
        }
        value={!!tradeDeadlineDate}
        disabled={!hasStartDate}
        onToggle={(v) => {
          if (!v) {
            setTradeDeadlineDate(null);
            return;
          }
          const week = defaultTradeDeadlineWeek(maxDeadlineWeek);
          setTradeDeadlineDate(weeks[week - 1]?.endDate ?? null);
        }}
        c={c}
      />
      <AnimatedSection visible={!!tradeDeadlineDate}>
        <NumberStepper
          label="Deadline Week"
          value={deadlineWeek}
          onValueChange={(v) => setTradeDeadlineDate(weeks[v - 1]?.endDate ?? null)}
          min={1}
          max={maxDeadlineWeek}
          helperText="Quick-set by week — fine-tune the exact date below."
        />
        <DateField
          label="Deadline Date"
          value={tradeDeadlineDate}
          onChange={setTradeDeadlineDate}
          minimumDate={hasStartDate ? parseLocalDate(league.season_start_date) : undefined}
          maximumDate={weeks.length ? parseLocalDate(weeks[weeks.length - 1].endDate) : undefined}
          last
        />
      </AnimatedSection>
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
