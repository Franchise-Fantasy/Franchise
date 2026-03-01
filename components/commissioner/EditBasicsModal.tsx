import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
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
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface EditBasicsModalProps {
  visible: boolean;
  onClose: () => void;
  league: any;
  leagueId: string;
}

export function EditBasicsModal({ visible, onClose, league, leagueId }: EditBasicsModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [buyIn, setBuyIn] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible && league) {
      setName(league.name ?? '');
      setIsPrivate(league.private ?? false);
      setBuyIn(league.buy_in_amount ?? 0);
    }
  }, [visible]);

  async function handleSave() {
    if (!name.trim()) {
      Alert.alert('Error', 'League name cannot be empty.');
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from('leagues')
      .update({ name: name.trim(), private: isPrivate, buy_in_amount: buyIn || null })
      .eq('id', leagueId);
    setSaving(false);
    if (error) {
      Alert.alert('Error', error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    onClose();
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}} accessibilityViewIsModal={true}>
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>League Basics</ThemedText>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Name</ThemedText>
              <TextInput
                accessibilityLabel="League name"
                style={[styles.textInput, { color: c.text, backgroundColor: c.input, borderColor: c.border }]}
                value={name}
                onChangeText={setName}
                placeholder="League name"
                placeholderTextColor={c.secondaryText}
              />
            </View>

            <View style={[styles.editRow, { borderBottomColor: c.border }]}>
              <ThemedText style={styles.rowLabel}>Visibility</ThemedText>
              <View style={{ width: 160 }}>
                <SegmentedControl
                  options={['Public', 'Private']}
                  selectedIndex={isPrivate ? 1 : 0}
                  onSelect={(i) => setIsPrivate(i === 1)}
                />
              </View>
            </View>

            <NumberStepper
              label="Buy-In ($)"
              value={buyIn}
              onValueChange={setBuyIn}
              min={0}
              max={1000}
              step={5}
            />
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
  editRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLabel: { fontSize: 14 },
  textInput: { flex: 1, marginLeft: 12, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  footer: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingTop: 16 },
  btn: { flex: 1, paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: 15, fontWeight: '600' },
});
