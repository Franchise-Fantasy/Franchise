import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { Colors } from '@/constants/Colors';
import { DEFAULT_SCORING } from '@/constants/LeagueDefaults';
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

function statLabel(stat: string): string {
  return DEFAULT_SCORING.find((s) => s.stat_name === stat)?.label ?? stat;
}

interface EditScoringModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  scoring: { stat_name: string; point_value: number }[] | undefined;
}

export function EditScoringModal({ visible, onClose, leagueId, scoring }: EditScoringModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [editScoring, setEditScoring] = useState<{ stat_name: string; point_value: number }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && scoring) {
      const merged = DEFAULT_SCORING.map((d) => {
        const existing = scoring.find((s) => s.stat_name === d.stat_name);
        return { stat_name: d.stat_name, point_value: existing?.point_value ?? d.point_value };
      });
      setEditScoring(merged);
    }
  }, [visible]);

  async function handleSave() {
    setSaving(true);
    const rows = editScoring.map((s) => ({
      league_id: leagueId,
      stat_name: s.stat_name,
      point_value: s.point_value,
    }));
    const { error: delErr } = await supabase.from('league_scoring_settings').delete().eq('league_id', leagueId);
    if (delErr) { setSaving(false); Alert.alert('Error', delErr.message); return; }
    const { error: insErr } = await supabase.from('league_scoring_settings').insert(rows);
    if (insErr) { setSaving(false); Alert.alert('Error', insErr.message); return; }
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['leagueScoring', leagueId] });
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}} accessibilityViewIsModal={true}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Edit Scoring</ThemedText>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            {editScoring.map((s, idx) => (
              <NumberStepper
                key={s.stat_name}
                label={statLabel(s.stat_name)}
                value={s.point_value}
                onValueChange={(v) => {
                  const next = [...editScoring];
                  next[idx] = { ...s, point_value: v };
                  setEditScoring(next);
                }}
                min={-10}
                max={10}
                step={0.5}
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
