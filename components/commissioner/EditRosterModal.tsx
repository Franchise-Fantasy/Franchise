import { ThemedText } from '@/components/ui/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { DEFAULT_ROSTER_SLOTS, NBA_POSITIONS, NbaPosition } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
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
  useWindowDimensions,
  View,
} from 'react-native';

function positionLabel(pos: string): string {
  return DEFAULT_ROSTER_SLOTS.find((s) => s.position === pos)?.label ?? pos;
}

interface EditRosterModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  rosterConfig: { position: string; slot_count: number }[] | undefined;
  positionLimits: Record<string, number> | null | undefined;
}

export function EditRosterModal({ visible, onClose, leagueId, rosterConfig, positionLimits }: EditRosterModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { height: screenHeight } = useWindowDimensions();

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
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: c.card }]} accessibilityViewIsModal={true}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Edit Roster</ThemedText>
          </View>

          <ScrollView style={[styles.scroll, { maxHeight: screenHeight * 0.55 }]} showsVerticalScrollIndicator={false}>
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
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Cancel" style={[styles.btn, { backgroundColor: c.cardAlt }]} onPress={onClose}>
              <ThemedText style={styles.btnText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Save"
              accessibilityState={{ disabled: saving }}
              style={[styles.btn, { backgroundColor: saving ? c.buttonDisabled : c.accent }]}
              onPress={handleSave}
              disabled={saving}
            >
              {saving ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Text style={[styles.btnText, { color: c.accentText }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: s(12), paddingBottom: s(40), maxHeight: '85%' },
  handle: { width: s(40), height: s(4), borderRadius: 2, alignSelf: 'center', marginBottom: s(12) },
  titleRow: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: s(16), marginBottom: s(16) },
  title: { fontSize: ms(17), fontWeight: '600' },
  scroll: { paddingHorizontal: s(16) },
  footer: { flexDirection: 'row', gap: s(12), paddingHorizontal: s(16), paddingTop: s(16) },
  btn: { flex: 1, paddingVertical: s(14), borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: ms(15), fontWeight: '600' },
  posLimitSection: { borderTopWidth: 1, marginTop: s(16), paddingTop: s(12) },
  posLimitTitle: { marginBottom: s(4) },
  posLimitNote: { fontSize: ms(13), marginBottom: s(8) },
});
