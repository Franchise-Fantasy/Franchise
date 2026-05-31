import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { ThemedText } from '@/components/ui/ThemedText';
import { TIME_PER_PICK_MAX, TIME_PER_PICK_MIN, TIME_PER_PICK_STEP } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

interface CommishDraftControlsSheetProps {
  visible: boolean;
  onClose: () => void;
  draftId: string;
  /** Current league-wide time-per-pick (seconds). */
  timeLimit: number;
}

/**
 * Commissioner-only draft-room controls. Today: change time-per-pick mid-draft.
 * The new value applies to the NEXT pick onward — the player currently on the
 * clock keeps the limit their pick started under (the per-pick snapshot in
 * drafts.current_pick_time_limit guarantees that). Home for future commish
 * draft controls (e.g. pause) so they stay in one place.
 */
export function CommishDraftControlsSheet({
  visible,
  onClose,
  draftId,
  timeLimit,
}: CommishDraftControlsSheetProps) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [pickTime, setPickTime] = useState(timeLimit);
  const [saving, setSaving] = useState(false);

  // Re-sync to the live value whenever the sheet opens.
  useEffect(() => {
    if (visible) setPickTime(timeLimit);
  }, [visible, timeLimit]);

  const changed = pickTime !== timeLimit;

  async function handleSave() {
    if (!changed) {
      onClose();
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('drafts')
      .update({ time_limit: pickTime })
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
      <NumberStepper
        label="Time Per Pick"
        value={pickTime}
        onValueChange={setPickTime}
        min={TIME_PER_PICK_MIN}
        max={TIME_PER_PICK_MAX}
        step={TIME_PER_PICK_STEP}
        suffix="s"
      />
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
});
