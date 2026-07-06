import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { PickClockControl } from '@/components/draft/PickClockControl';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { TIME_PER_PICK_MIN, TIME_PER_PICK_STEP } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { isSlowClock } from '@/utils/draft/pickClock';
import { ms, s } from '@/utils/scale';

interface CommishDraftControlsSheetProps {
  visible: boolean;
  onClose: () => void;
  draftId: string;
  /** Current league-wide base time-per-pick (seconds). */
  timeLimit: number;
  /** Total draft rounds — bounds the "speed up after round" control. */
  rounds: number;
  /** Round after which the faster clock kicks in; null = no acceleration. */
  accelerateAfterRound: number | null;
  /** Seconds-per-pick once acceleration kicks in; null when disabled. */
  acceleratedTimeLimit: number | null;
  /** Draft status — drives the Pause / Resume control. */
  status: string;
}

/**
 * Commissioner-only draft-room controls. Today: change the per-pick clock
 * mid-draft — both the base time-per-pick AND the round-acceleration the
 * commish set pre-draft ("speed up later rounds"). Changes apply to the NEXT
 * pick onward — the player currently on the clock keeps the limit their pick
 * started under (the per-pick snapshot in drafts.current_pick_time_limit
 * guarantees that). Home for future commish draft controls (e.g. pause).
 */
export function CommishDraftControlsSheet({
  visible,
  onClose,
  draftId,
  timeLimit,
  rounds,
  accelerateAfterRound,
  acceleratedTimeLimit,
  status,
}: CommishDraftControlsSheetProps) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [pickTime, setPickTime] = useState(timeLimit);
  const [accelAfterRound, setAccelAfterRound] = useState<number | null>(accelerateAfterRound);
  const [acceleratedTime, setAcceleratedTime] = useState(acceleratedTimeLimit ?? 30);
  const [saving, setSaving] = useState(false);
  const [pauseLoading, setPauseLoading] = useState(false);

  const isPaused = status === 'paused';
  // Pause/Resume is only meaningful for a running or paused draft.
  const canPauseResume = status === 'in_progress' || status === 'paused';

  async function handlePauseResume() {
    setPauseLoading(true);
    const fn = isPaused ? 'resume-draft' : 'pause-draft';
    const { error } = await supabase.functions.invoke(fn, { body: { draft_id: draftId } });
    setPauseLoading(false);
    if (error) {
      Alert.alert('Error', `Could not ${isPaused ? 'resume' : 'pause'} the draft. Please try again.`);
      return;
    }
    // Realtime propagates to everyone; invalidate so the commissioner's own
    // room flips instantly without waiting for the broadcast round-trip.
    queryClient.invalidateQueries({ queryKey: queryKeys.draftState(draftId) });
    onClose();
  }

  // Re-sync to the live values whenever the sheet opens.
  useEffect(() => {
    if (visible) {
      setPickTime(timeLimit);
      setAccelAfterRound(accelerateAfterRound);
      setAcceleratedTime(acceleratedTimeLimit ?? 30);
    }
  }, [visible, timeLimit, accelerateAfterRound, acceleratedTimeLimit]);

  const accelEnabled = accelAfterRound != null;
  const slowDraft = isSlowClock(pickTime);
  // Acceleration only persists when both halves are set AND the threshold sits
  // inside the draft — same rule create-league applies on insert. Faster clock
  // can never exceed the base clock. Slow (async) drafts never accelerate.
  const effAccelAfter =
    accelEnabled && accelAfterRound! < rounds && !slowDraft ? accelAfterRound! : null;
  const effAccelTime = effAccelAfter != null ? Math.min(acceleratedTime, pickTime) : null;

  const changed =
    pickTime !== timeLimit ||
    effAccelAfter !== accelerateAfterRound ||
    effAccelTime !== acceleratedTimeLimit;

  async function handleSave() {
    if (!changed) {
      onClose();
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('drafts')
      .update({
        time_limit: pickTime,
        accelerate_after_round: effAccelAfter,
        accelerated_time_limit: effAccelTime,
      })
      .eq('id', draftId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: queryKeys.draftState(draftId) });
    onClose();
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Commissioner Controls"
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
            disabled={!changed}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Save commissioner controls"
          />
        </View>
      }
    >
      {canPauseResume && (
        <View style={[styles.pauseSection, { borderBottomColor: c.border }]}>
          <BrandButton
            label={isPaused ? 'Resume Draft' : 'Pause Draft'}
            variant={isPaused ? 'primary' : 'secondary'}
            size="large"
            onPress={handlePauseResume}
            loading={pauseLoading}
            fullWidth
            accessibilityLabel={isPaused ? 'Resume the draft' : 'Pause the draft'}
          />
          <ThemedText style={[styles.note, { color: c.secondaryText }]}>
            {isPaused
              ? 'Resumes the clock from where it stopped.'
              : 'Freezes the clock for everyone. The pick on the clock keeps its remaining time.'}
          </ThemedText>
        </View>
      )}

      <PickClockControl value={pickTime} onValueChange={setPickTime} />

      {rounds > 1 && !slowDraft && (
        <>
          <ToggleRow
            icon="flash-outline"
            label="Speed Up Later Rounds"
            description={
              accelEnabled
                ? `Rounds after ${Math.min(accelAfterRound ?? 1, rounds - 1)} drop to ${Math.min(acceleratedTime, pickTime)}s per pick.`
                : 'Tighten the pick clock for the back half of the draft.'
            }
            value={accelEnabled}
            onToggle={(on) =>
              setAccelAfterRound(on ? Math.min(accelAfterRound ?? 5, rounds - 1) : null)
            }
            c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
          />

          {accelEnabled && (
            <>
              <NumberStepper
                label="Speed Up After Round"
                value={Math.min(accelAfterRound ?? 1, rounds - 1)}
                onValueChange={setAccelAfterRound}
                min={1}
                max={rounds - 1}
                helperText={`Rounds 1–${Math.min(accelAfterRound ?? 1, rounds - 1)} use ${pickTime}s; later rounds use the faster clock below.`}
              />
              <NumberStepper
                label="Faster Pick Time"
                value={Math.min(acceleratedTime, pickTime)}
                onValueChange={setAcceleratedTime}
                min={TIME_PER_PICK_MIN}
                max={pickTime}
                step={TIME_PER_PICK_STEP}
                suffix="s"
              />
            </>
          )}
        </>
      )}

      <ThemedText style={[styles.note, { color: c.secondaryText }]}>
        Applies starting with the next pick — whoever is on the clock keeps their
        current timer.
      </ThemedText>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
  note: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginTop: s(8),
  },
  pauseSection: {
    paddingBottom: s(16),
    marginBottom: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
