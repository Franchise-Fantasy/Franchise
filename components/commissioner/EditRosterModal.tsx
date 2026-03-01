import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { DEFAULT_ROSTER_SLOTS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
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

function positionLabel(pos: string): string {
  return DEFAULT_ROSTER_SLOTS.find((s) => s.position === pos)?.label ?? pos;
}

interface EditRosterModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  rosterConfig: { position: string; slot_count: number }[] | undefined;
}

export function EditRosterModal({ visible, onClose, leagueId, rosterConfig }: EditRosterModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [editRoster, setEditRoster] = useState<{ position: string; slot_count: number }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && rosterConfig) {
      const merged = DEFAULT_ROSTER_SLOTS.map((d) => {
        const existing = rosterConfig.find((r) => r.position === d.position);
        return { position: d.position, slot_count: existing?.slot_count ?? 0 };
      });
      setEditRoster(merged);
    }
  }, [visible]);

  async function handleSave() {
    setSaving(true);
    const rows = editRoster
      .filter((r) => r.slot_count > 0)
      .map((r) => ({ league_id: leagueId, position: r.position, slot_count: r.slot_count }));
    const rosterSize = rows.reduce((sum, r) => (r.position === 'IR' ? sum : sum + r.slot_count), 0);

    const { error: delErr } = await supabase.from('league_roster_config').delete().eq('league_id', leagueId);
    if (delErr) { setSaving(false); Alert.alert('Error', delErr.message); return; }
    const { error: insErr } = await supabase.from('league_roster_config').insert(rows);
    if (insErr) { setSaving(false); Alert.alert('Error', insErr.message); return; }
    await supabase.from('leagues').update({ roster_size: rosterSize }).eq('id', leagueId);

    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['leagueRosterConfig', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}} accessibilityViewIsModal={true}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Edit Roster</ThemedText>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'transparent', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 12, paddingBottom: 40, maxHeight: '85%' },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 12 },
  titleRow: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 16, marginBottom: 16 },
  title: { fontSize: 17, fontWeight: '600' },
  scroll: { paddingHorizontal: 16 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 15, fontWeight: '600' },
});
