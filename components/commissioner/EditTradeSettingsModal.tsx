import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { ToggleRow } from '@/components/ToggleRow';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
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
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, { backgroundColor: c.card }]}
          onPress={() => {}}
          accessibilityViewIsModal={true}
        >
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          {/* Title */}
          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Trade Settings</ThemedText>
          </View>

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
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
              style={[
                styles.btn,
                { backgroundColor: saving ? c.buttonDisabled : c.accent },
              ]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <LogoSpinner size={18} />
              ) : (
                <Text style={[styles.btnText, { color: c.accentText }]}>
                  Save
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
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
  title: { fontSize: ms(17), fontWeight: '600' },
  scroll: { flexShrink: 1, paddingHorizontal: s(16) },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: ms(14) },
  helperText: { fontSize: ms(13), marginTop: s(2) },
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
  btnText: { fontSize: ms(15), fontWeight: '600' },
});
