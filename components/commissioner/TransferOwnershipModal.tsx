import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface Team {
  id: string;
  name: string;
  user_id: string | null;
}

interface TransferOwnershipModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  teams: Team[];
}

export function TransferOwnershipModal({ visible, onClose, leagueId, teams }: TransferOwnershipModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [saving, setSaving] = useState(false);

  const handleTransfer = async () => {
    if (!selectedTeamId || !email.trim()) {
      Alert.alert('Error', 'Select a team and enter the new owner\'s email.');
      return;
    }

    const trimmedEmail = email.trim().toLowerCase();

    Alert.alert(
      'Transfer Ownership',
      `Transfer "${teams.find((t) => t.id === selectedTeamId)?.name}" to ${trimmedEmail}?\n\nThe new owner will have full control of this team.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Transfer',
          style: 'destructive',
          onPress: async () => {
            setSaving(true);
            try {
              const { data, error } = await supabase.rpc('transfer_team_ownership', {
                p_league_id: leagueId,
                p_team_id: selectedTeamId,
                p_new_owner_email: trimmedEmail,
              });

              if (error) throw error;
              if (data?.error) {
                Alert.alert('Error', data.error);
                setSaving(false);
                return;
              }

              queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
              Alert.alert('Success', 'Team ownership has been transferred.');
              setSelectedTeamId(null);
              setEmail('');
              onClose();
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to transfer ownership.');
            } finally {
              setSaving(false);
            }
          },
        },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { backgroundColor: c.card }]} onPress={() => {}} accessibilityViewIsModal>
          <View style={[styles.handle, { backgroundColor: c.border }]} />

          <View style={styles.titleRow}>
            <ThemedText accessibilityRole="header" style={styles.title}>Transfer Team Ownership</ThemedText>
          </View>

          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} nestedScrollEnabled>
            <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
              Select a team, then enter the email of the new owner.
            </ThemedText>

            {/* Team list */}
            {teams.map((team) => {
              const isSelected = selectedTeamId === team.id;
              return (
                <TouchableOpacity
                  key={team.id}
                  style={[
                    styles.teamRow,
                    { borderColor: isSelected ? c.accent : c.border, backgroundColor: isSelected ? c.activeCard : c.cardAlt },
                  ]}
                  onPress={() => setSelectedTeamId(team.id)}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: isSelected }}
                  accessibilityLabel={`Select ${team.name}`}
                >
                  <ThemedText style={{ flex: 1 }}>{team.name}</ThemedText>
                  {isSelected && <Ionicons name="checkmark-circle" size={20} color={c.accent} />}
                  {!team.user_id && (
                    <ThemedText style={[styles.unclaimed, { color: c.warning }]}>Unclaimed</ThemedText>
                  )}
                </TouchableOpacity>
              );
            })}

            {/* Email input */}
            {selectedTeamId && (
              <View style={styles.emailSection}>
                <ThemedText style={[styles.label, { color: c.secondaryText }]}>New Owner Email</ThemedText>
                <TextInput
                  accessibilityLabel="New owner email address"
                  style={[styles.textInput, { color: c.text, backgroundColor: c.input, borderColor: c.border }]}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="user@example.com"
                  placeholderTextColor={c.secondaryText}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                />
              </View>
            )}
          </ScrollView>

          <View style={styles.footer}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Cancel"
              style={[styles.btn, { backgroundColor: c.cardAlt }]}
              onPress={onClose}
            >
              <ThemedText style={styles.btnText}>Cancel</ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Transfer ownership"
              accessibilityState={{ disabled: saving || !selectedTeamId || !email.trim() }}
              style={[styles.btn, { backgroundColor: saving || !selectedTeamId || !email.trim() ? c.buttonDisabled : c.warning }]}
              onPress={handleTransfer}
              disabled={saving || !selectedTeamId || !email.trim()}
            >
              {saving ? (
                <LogoSpinner size={18} />
              ) : (
                <ThemedText style={[styles.btnText, { color: '#fff' }]}>Transfer</ThemedText>
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
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: s(12), paddingBottom: s(40), maxHeight: '85%' },
  handle: { width: s(40), height: s(4), borderRadius: 2, alignSelf: 'center', marginBottom: s(12) },
  titleRow: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: s(16), marginBottom: s(8) },
  title: { fontSize: ms(17), fontWeight: '600' },
  scroll: { flexShrink: 1, paddingHorizontal: s(16) },
  hint: { fontSize: ms(13), marginBottom: s(12), textAlign: 'center' },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: s(12),
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: s(8),
  },
  unclaimed: { fontSize: ms(11), fontWeight: '600', marginLeft: s(8) },
  emailSection: { marginTop: s(8) },
  label: { fontSize: ms(12), fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: s(6) },
  textInput: { borderWidth: 1, borderRadius: 8, paddingHorizontal: s(12), paddingVertical: s(10), fontSize: ms(14) },
  footer: { flexDirection: 'row', gap: s(12), paddingHorizontal: s(16), paddingTop: s(16) },
  btn: { flex: 1, paddingVertical: s(14), borderRadius: 10, alignItems: 'center' },
  btnText: { fontSize: ms(15), fontWeight: '600' },
});
