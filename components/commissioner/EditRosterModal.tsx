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
import { ThemedText } from '@/components/ui/ThemedText';
import { DEFAULT_ROSTER_SLOTS, NBA_POSITIONS, NbaPosition } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

function positionLabel(pos: string): string {
  return DEFAULT_ROSTER_SLOTS.find((slot) => slot.position === pos)?.label ?? pos;
}

interface EditRosterModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  rosterConfig: { position: string; slot_count: number }[] | undefined;
  positionLimits: Record<string, number> | null | undefined;
}

export function EditRosterModal({ visible, onClose, leagueId, rosterConfig, positionLimits }: EditRosterModalProps) {
  const c = useColors();
  const queryClient = useQueryClient();

  const [editRoster, setEditRoster] = useState<{ position: string; slot_count: number }[]>([]);
  const [editPosLimits, setEditPosLimits] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && rosterConfig) {
      const merged = DEFAULT_ROSTER_SLOTS.map((d) => {
        const existing = rosterConfig.find((r) => r.position === d.position);
        return { position: d.position, slot_count: existing?.slot_count ?? 0 };
      });
      setEditRoster(merged);
      setEditPosLimits(positionLimits && typeof positionLimits === 'object' ? { ...positionLimits } : {});
    }
  }, [visible]);

  async function handleSave() {
    setSaving(true);
    const rows = editRoster
      .filter((r) => r.slot_count > 0)
      .map((r) => ({ league_id: leagueId, position: r.position, slot_count: r.slot_count }));
    const rosterSize = rows.reduce((sum, r) => (r.position === 'IR' || r.position === 'TAXI') ? sum : sum + r.slot_count, 0);

    const { error: delErr } = await supabase.from('league_roster_config').delete().eq('league_id', leagueId);
    if (delErr) { setSaving(false); Alert.alert('Error', delErr.message); return; }
    const { error: insErr } = await supabase.from('league_roster_config').insert(rows);
    if (insErr) { setSaving(false); Alert.alert('Error', insErr.message); return; }
    const posLimitsPayload = Object.keys(editPosLimits).length > 0 ? editPosLimits : null;
    await supabase.from('leagues').update({ roster_size: rosterSize, position_limits: posLimitsPayload }).eq('id', leagueId);

    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['leagueRosterConfig', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    onClose();
  }

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Edit Roster"
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
      {editRoster.map((slot, idx) => (
        <NumberStepper
          key={slot.position}
          label={positionLabel(slot.position)}
          value={slot.slot_count}
          onValueChange={(v) => {
            const next = [...editRoster];
            next[idx] = { ...slot, slot_count: v };
            setEditRoster(next);
          }}
          min={0}
          max={slot.position === 'IR' ? 5 : 10}
        />
      ))}

      <View style={[styles.posLimitSection, { borderTopColor: c.border }]}>
        <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.posLimitTitle}>Position Limits</ThemedText>
        <ThemedText style={[styles.posLimitNote, { color: c.secondaryText }]}>
          0 = no limit. Limits the total number of players at each position.
        </ThemedText>
        {NBA_POSITIONS.map((pos) => (
          <NumberStepper
            key={`pos-limit-${pos}`}
            label={pos}
            value={editPosLimits[pos] ?? 0}
            onValueChange={(v) => {
              const next = { ...editPosLimits };
              if (v === 0) {
                delete next[pos as NbaPosition];
              } else {
                next[pos as NbaPosition] = v;
              }
              setEditPosLimits(next);
            }}
            min={0}
            max={15}
          />
        ))}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
  posLimitSection: { borderTopWidth: 1, marginTop: s(16), paddingTop: s(12) },
  posLimitTitle: { marginBottom: s(4) },
  posLimitNote: { fontSize: ms(13), marginBottom: s(8) },
});
