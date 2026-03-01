import { ThemedText } from '@/components/ThemedText';
import { ToggleRow } from '@/components/ToggleRow';
import { LotteryOddsEditor } from '@/components/create-league/LotteryOddsEditor';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { DRAFT_TYPE_OPTIONS, ROOKIE_DRAFT_ORDER_OPTIONS, TIME_PER_PICK_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/lottery';
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

const ORDER_DISPLAY: Record<string, string> = {
  reverse_record: 'Reverse Record',
  lottery: 'Lottery',
};

const ORDER_TO_DB: Record<string, string> = {
  'Reverse Record': 'reverse_record',
  Lottery: 'lottery',
};

const TIME_LABELS = TIME_PER_PICK_OPTIONS.map((t) => `${t}s`);

interface EditDraftSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
  draft: { id: string; draft_type: string; time_limit: number; status: string } | null;
  teamCount: number;
}

export function EditDraftSettingsModal({
  visible,
  onClose,
  league,
  leagueId,
  draft,
  teamCount,
}: EditDraftSettingsModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [draftType, setDraftType] = useState('Snake');
  const [timePick, setTimePick] = useState(90);
  const [maxYears, setMaxYears] = useState(3);
  const [rookieRounds, setRookieRounds] = useState(2);
  const [rookieOrder, setRookieOrder] = useState('Reverse Record');
  const [lotteryDraws, setLotteryDraws] = useState(4);
  const [lotteryOdds, setLotteryOdds] = useState<number[] | null>(null);
  const [draftPickTrading, setDraftPickTrading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible || !league) return;

    setDraftType(
      draft
        ? draft.draft_type.charAt(0).toUpperCase() + draft.draft_type.slice(1)
        : 'Snake'
    );
    setTimePick(draft?.time_limit ?? 90);
    setMaxYears(league.max_future_seasons ?? 3);
    setRookieRounds(league.rookie_draft_rounds ?? 2);
    setRookieOrder(ORDER_DISPLAY[league.rookie_draft_order] ?? 'Reverse Record');
    setLotteryDraws(league.lottery_draws ?? 4);
    setLotteryOdds(league.lottery_odds ?? null);
    setDraftPickTrading(league.draft_pick_trading_enabled ?? false);
  }, [visible]);

  const pt = league?.playoff_teams ?? Math.min(
    2 ** (league?.playoff_weeks ?? 3),
    teamCount
  );
  const lotteryPool = calcLotteryPoolSize(teamCount, pt);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);

    const { error: leagueErr } = await supabase
      .from('leagues')
      .update({
        max_future_seasons: maxYears,
        rookie_draft_rounds: rookieRounds,
        rookie_draft_order: ORDER_TO_DB[rookieOrder] ?? 'reverse_record',
        lottery_draws: lotteryDraws,
        lottery_odds: lotteryOdds,
        draft_pick_trading_enabled: draftPickTrading,
      })
      .eq('id', leagueId);

    const { error: draftErr } = await supabase
      .from('drafts')
      .update({
        draft_type: draftType.toLowerCase(),
        time_limit: timePick,
      })
      .eq('id', draft.id);

    setSaving(false);

    if (leagueErr || draftErr) {
      Alert.alert('Error', (leagueErr ?? draftErr)!.message);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['leagueDraft', leagueId] });
    onClose();
  }

  const draftTypeIndex = DRAFT_TYPE_OPTIONS.indexOf(
    draftType as (typeof DRAFT_TYPE_OPTIONS)[number]
  );
  const timeIndex = TIME_PER_PICK_OPTIONS.indexOf(
    timePick as (typeof TIME_PER_PICK_OPTIONS)[number]
  );
  const orderIndex = ROOKIE_DRAFT_ORDER_OPTIONS.indexOf(
    rookieOrder as (typeof ROOKIE_DRAFT_ORDER_OPTIONS)[number]
  );

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
            <ThemedText accessibilityRole="header" style={styles.title}>Draft Settings</ThemedText>
          </View>

          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
          >
            {/* Draft Type */}
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Type</ThemedText>
            </View>
            <View style={{ paddingVertical: 8 }}>
              <SegmentedControl
                options={DRAFT_TYPE_OPTIONS}
                selectedIndex={draftTypeIndex >= 0 ? draftTypeIndex : 0}
                onSelect={(i) => setDraftType(DRAFT_TYPE_OPTIONS[i])}
              />
            </View>

            {/* Time Per Pick */}
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Time Per Pick</ThemedText>
            </View>
            <View style={{ paddingVertical: 8 }}>
              <SegmentedControl
                options={TIME_LABELS}
                selectedIndex={timeIndex >= 0 ? timeIndex : 1}
                onSelect={(i) => setTimePick(TIME_PER_PICK_OPTIONS[i])}
              />
            </View>

            {/* Future Draft Years */}
            <NumberStepper
              label="Future Draft Years"
              value={maxYears}
              onValueChange={setMaxYears}
              min={1}
              max={10}
            />

            {/* Rookie Draft Rounds */}
            <NumberStepper
              label="Rookie Draft Rounds"
              value={rookieRounds}
              onValueChange={setRookieRounds}
              min={1}
              max={5}
            />

            {/* Rookie Draft Order */}
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Rookie Draft Order</ThemedText>
            </View>
            <View style={{ paddingVertical: 8 }}>
              <SegmentedControl
                options={ROOKIE_DRAFT_ORDER_OPTIONS}
                selectedIndex={orderIndex >= 0 ? orderIndex : 0}
                onSelect={(i) => setRookieOrder(ROOKIE_DRAFT_ORDER_OPTIONS[i])}
              />
            </View>

            {/* Lottery settings (conditional) */}
            {rookieOrder === 'Lottery' && (
              <>
                {lotteryPool <= 0 ? (
                  <ThemedText
                    style={[styles.helperText, { color: c.secondaryText, marginBottom: 8 }]}
                  >
                    All teams make playoffs — no lottery pool.
                  </ThemedText>
                ) : (
                  <>
                    <ThemedText
                      style={[styles.helperText, { color: c.secondaryText, marginBottom: 8 }]}
                    >
                      {lotteryPool} non-playoff team(s) in the lottery
                    </ThemedText>

                    <NumberStepper
                      label="Lottery Draws"
                      value={lotteryDraws}
                      onValueChange={setLotteryDraws}
                      min={1}
                      max={lotteryPool}
                    />

                    <View style={{ marginTop: 12 }}>
                      <LotteryOddsEditor
                        odds={lotteryOdds ?? generateDefaultOdds(lotteryPool)}
                        onChange={setLotteryOdds}
                        lotteryTeams={lotteryPool}
                      />
                    </View>
                  </>
                )}
              </>
            )}

            {/* Draft Pick Trading */}
            <ToggleRow
              icon="swap-horizontal-outline"
              label="Initial Draft Pick Trading"
              description="Allow trading of startup draft picks before and during the draft"
              value={draftPickTrading}
              onToggle={setDraftPickTrading}
              c={c}
            />
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
                <ActivityIndicator color="#fff" size="small" />
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
    paddingTop: 12,
    paddingBottom: 40,
    maxHeight: '85%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  titleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  title: { fontSize: 17, fontWeight: '600' },
  scroll: { paddingHorizontal: 16 },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowLabel: { fontSize: 14 },
  helperText: { fontSize: 13, marginTop: 2 },
  footer: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  btn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnText: { fontSize: 15, fontWeight: '600' },
});
