import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import {
  Alert,
  StyleSheet,
  View,
} from 'react-native';

import { LotteryOddsEditor } from '@/components/create-league/LotteryOddsEditor';
import { PickClockControl } from '@/components/draft/PickClockControl';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { DRAFT_TYPE_OPTIONS, getMaxRookieDraftRounds, INITIAL_DRAFT_ORDER_DISPLAY, INITIAL_DRAFT_ORDER_OPTIONS, INITIAL_DRAFT_ORDER_TO_DB, ROOKIE_DRAFT_ORDER_OPTIONS, TIME_PER_PICK_MIN, TIME_PER_PICK_STEP } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { isSlowClock } from '@/utils/draft/pickClock';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/league/lottery';
import { ms, s } from '@/utils/scale';

const ORDER_DISPLAY: Record<string, string> = {
  reverse_record: 'Reverse Record',
  lottery: 'Lottery',
};

const ORDER_TO_DB: Record<string, string> = {
  'Reverse Record': 'reverse_record',
  Lottery: 'lottery',
};

interface EditDraftSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
  draft: {
    id: string;
    draft_type: string;
    time_limit: number;
    accelerate_after_round: number | null;
    accelerated_time_limit: number | null;
    status: string | null;
  } | null;
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
  const c = useColors();
  const queryClient = useQueryClient();

  const isDynasty = (league?.league_type ?? 'dynasty') === 'dynasty';
  // Imported leagues skip the startup draft (rosters come from the import), so
  // the startup-pick-trading setting is meaningless — hide it and don't persist it.
  const isImported = !!league?.imported_from;

  const [draftType, setDraftType] = useState('Snake');
  const [initialOrder, setInitialOrder] = useState('Random');
  const [timePick, setTimePick] = useState(90);
  const [accelEnabled, setAccelEnabled] = useState(false);
  const [accelAfterRound, setAccelAfterRound] = useState(5);
  const [accelTime, setAccelTime] = useState(30);
  const [maxYears, setMaxYears] = useState(3);
  const [rookiePickTime, setRookiePickTime] = useState(120);
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
    const enabled = draft?.accelerate_after_round != null && draft?.accelerated_time_limit != null;
    setAccelEnabled(enabled);
    setAccelAfterRound(draft?.accelerate_after_round ?? 5);
    setAccelTime(draft?.accelerated_time_limit ?? 30);
    setMaxYears(league.max_future_seasons ?? 3);
    setRookiePickTime(league.rookie_pick_time_limit ?? 120);
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

  // Startup draft rounds = active roster slots. roster_size already excludes
  // IR/Taxi (create-league derives it that way), so it's the round count.
  const totalRounds = league?.roster_size ?? 0;
  const canAccelerate = totalRounds > 1;
  const accelRoundMax = Math.max(1, totalRounds - 1);

  async function handleSave() {
    if (!draft) return;
    setSaving(true);

    const leagueUpdate: Record<string, any> = {
      initial_draft_order: INITIAL_DRAFT_ORDER_TO_DB[initialOrder as keyof typeof INITIAL_DRAFT_ORDER_TO_DB] ?? 'random',
    };
    if (isDynasty) {
      leagueUpdate.max_future_seasons = maxYears;
      leagueUpdate.rookie_pick_time_limit = rookiePickTime;
      leagueUpdate.rookie_draft_rounds = rookieRounds;
      leagueUpdate.rookie_draft_order = ORDER_TO_DB[rookieOrder] ?? 'reverse_record';
      leagueUpdate.lottery_draws = lotteryDraws;
      leagueUpdate.lottery_odds = lotteryOdds;
      if (!isImported) leagueUpdate.draft_pick_trading_enabled = draftPickTrading;
    }

    const { error: leagueErr } = Object.keys(leagueUpdate).length > 0
      ? await supabase.from('leagues').update(leagueUpdate).eq('id', leagueId)
      : { error: null };

    // Acceleration persists only when enabled AND the threshold sits inside
    // the draft (otherwise it could never fire) — store NULL/NULL when off so
    // the edge clock helper falls straight through to the base time_limit.
    // Slow (async) drafts never accelerate; the controls are hidden but stale
    // state from before the pace switch could still be enabled.
    const accelActive =
      accelEnabled && canAccelerate && accelAfterRound < totalRounds && !isSlowClock(timePick);

    const { error: draftErr } = await supabase
      .from('drafts')
      .update({
        draft_type: draftType.toLowerCase(),
        time_limit: timePick,
        accelerate_after_round: accelActive ? accelAfterRound : null,
        accelerated_time_limit: accelActive ? Math.min(accelTime, timePick) : null,
      })
      .eq('id', draft.id);

    // Keep an already-created (but not started) rookie draft row in sync —
    // create-rookie-draft snapshots the league's rookie clock at creation
    // time, so a later settings change would otherwise be silently ignored.
    const { error: rookieErr } = isDynasty
      ? await supabase
          .from('drafts')
          .update({ time_limit: rookiePickTime })
          .eq('league_id', leagueId)
          .eq('type', 'rookie')
          .in('status', ['unscheduled', 'pending'])
      : { error: null };

    setSaving(false);

    const err = leagueErr ?? draftErr ?? rookieErr;
    if (err) {
      Alert.alert('Error', err.message);
      return;
    }

    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['leagueDraft', leagueId] });
    onClose();
  }

  const draftTypeIndex = DRAFT_TYPE_OPTIONS.indexOf(
    draftType as (typeof DRAFT_TYPE_OPTIONS)[number]
  );
  const orderIndex = ROOKIE_DRAFT_ORDER_OPTIONS.indexOf(
    rookieOrder as (typeof ROOKIE_DRAFT_ORDER_OPTIONS)[number]
  );
  const initialOrderIndex = INITIAL_DRAFT_ORDER_OPTIONS.indexOf(
    initialOrder as (typeof INITIAL_DRAFT_ORDER_OPTIONS)[number]
  );

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Draft Settings"
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
      <PickClockControl value={timePick} onValueChange={setTimePick} />

      {/* Speed up later rounds — never offered for slow (async) drafts */}
      {canAccelerate && !isSlowClock(timePick) && (
        <>
          <ToggleRow
            icon="flash-outline"
            label="Speed Up Later Rounds"
            description={
              accelEnabled
                ? `Rounds after ${Math.min(accelAfterRound, accelRoundMax)} drop to ${Math.min(accelTime, timePick)}s per pick.`
                : 'Tighten the pick clock for the back half of the draft.'
            }
            value={accelEnabled}
            onToggle={setAccelEnabled}
            c={c}
          />
          {accelEnabled && (
            <>
              <NumberStepper
                label="Speed Up After Round"
                value={Math.min(accelAfterRound, accelRoundMax)}
                onValueChange={setAccelAfterRound}
                min={1}
                max={accelRoundMax}
              />
              <NumberStepper
                label="Faster Pick Time"
                value={Math.min(accelTime, timePick)}
                onValueChange={setAccelTime}
                min={TIME_PER_PICK_MIN}
                max={timePick}
                step={TIME_PER_PICK_STEP}
                suffix="s"
              />
            </>
          )}
        </>
      )}

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
            max={getMaxRookieDraftRounds(league?.sport ?? 'nba', teamCount)}
          />

          {/* Rookie Pick Clock — applied when the rookie draft is created;
              also syncs an already-created draft that hasn't started. */}
          <PickClockControl
            label="Rookie Pick Clock"
            value={rookiePickTime}
            onValueChange={setRookiePickTime}
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

          {/* Draft Pick Trading — hidden for imports (no startup draft). */}
          {!isImported && (
            <ToggleRow
              icon="swap-horizontal-outline"
              label="Initial Draft Pick Trading"
              description={
                draftPickTrading
                  ? 'Allow trading of startup draft picks before and during the draft. In-draft trades execute immediately on acceptance — no review period, no vetoes.'
                  : 'Allow trading of startup draft picks before and during the draft'
              }
              value={draftPickTrading}
              onToggle={setDraftPickTrading}
              c={c}
            />
          )}
        </>
      )}
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
