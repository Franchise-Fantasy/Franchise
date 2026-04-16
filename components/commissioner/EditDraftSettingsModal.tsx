import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ToggleRow';
import { LotteryOddsEditor } from '@/components/create-league/LotteryOddsEditor';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { DRAFT_TYPE_OPTIONS, INITIAL_DRAFT_ORDER_DISPLAY, INITIAL_DRAFT_ORDER_OPTIONS, INITIAL_DRAFT_ORDER_TO_DB, ROOKIE_DRAFT_ORDER_OPTIONS, TIME_PER_PICK_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/lottery';
import { ms, s } from '@/utils/scale';
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
  useWindowDimensions,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';

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
  draft: { id: string; draft_type: string; time_limit: number; status: string | null } | null;
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
  const { height: screenHeight } = useWindowDimensions();

  const isDynasty = (league?.league_type ?? 'dynasty') === 'dynasty';

  const [draftType, setDraftType] = useState('Snake');
  const [initialOrder, setInitialOrder] = useState('Random');
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
    setInitialOrder(INITIAL_DRAFT_ORDER_DISPLAY[league.initial_draft_order] ?? 'Random');
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

    const leagueUpdate: Record<string, any> = {
      initial_draft_order: INITIAL_DRAFT_ORDER_TO_DB[initialOrder as keyof typeof INITIAL_DRAFT_ORDER_TO_DB] ?? 'random',
    };
    if (isDynasty) {
      leagueUpdate.max_future_seasons = maxYears;
      leagueUpdate.rookie_draft_rounds = rookieRounds;
      leagueUpdate.rookie_draft_order = ORDER_TO_DB[rookieOrder] ?? 'reverse_record';
      leagueUpdate.lottery_draws = lotteryDraws;
      leagueUpdate.lottery_odds = lotteryOdds;
      leagueUpdate.draft_pick_trading_enabled = draftPickTrading;
    }

    const { error: leagueErr } = Object.keys(leagueUpdate).length > 0
      ? await supabase.from('leagues').update(leagueUpdate).eq('id', leagueId)
      : { error: null };

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
  const initialOrderIndex = INITIAL_DRAFT_ORDER_OPTIONS.indexOf(
    initialOrder as (typeof INITIAL_DRAFT_ORDER_OPTIONS)[number]
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View
          style={[styles.sheet, { backgroundColor: c.card }]}
          accessibilityViewIsModal={true}
        >
          {/* Handle */}
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          {/* Title */}
          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Draft Settings</ThemedText>
          </View>

          <ScrollView
            style={[styles.scroll, { maxHeight: screenHeight * 0.55 }]}
            showsVerticalScrollIndicator={false}
          >
            {/* Draft Type */}
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Type</ThemedText>
            </View>
            <View style={{ paddingVertical: s(8) }}>
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
            <View style={{ paddingVertical: s(8) }}>
              <SegmentedControl
                options={TIME_LABELS}
                selectedIndex={timeIndex >= 0 ? timeIndex : 1}
                onSelect={(i) => setTimePick(TIME_PER_PICK_OPTIONS[i])}
              />
            </View>

            {/* Draft Order */}
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Draft Order</ThemedText>
            </View>
            <View style={{ paddingVertical: s(8) }}>
              <SegmentedControl
                options={[...INITIAL_DRAFT_ORDER_OPTIONS]}
                selectedIndex={initialOrderIndex >= 0 ? initialOrderIndex : 0}
                onSelect={(i) => setInitialOrder(INITIAL_DRAFT_ORDER_OPTIONS[i])}
              />
            </View>
            <ThemedText style={[styles.helperText, { color: c.secondaryText, marginBottom: s(8) }]}>
              {initialOrder === 'Random'
                ? 'Teams are randomly assigned a draft position when all teams join.'
                : 'The commissioner will set the draft order before the draft begins.'}
            </ThemedText>

            {isDynasty && (
              <>
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
                <View style={{ paddingVertical: s(8) }}>
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
                        style={[styles.helperText, { color: c.secondaryText, marginBottom: s(8) }]}
                      >
                        All teams make playoffs — no lottery pool.
                      </ThemedText>
                    ) : (
                      <>
                        <ThemedText
                          style={[styles.helperText, { color: c.secondaryText, marginBottom: s(8) }]}
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

                        <View style={{ marginTop: s(12) }}>
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
              </>
            )}
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
  title: { fontSize: ms(17), fontWeight: '600' },
  scroll: { paddingHorizontal: s(16) },
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
