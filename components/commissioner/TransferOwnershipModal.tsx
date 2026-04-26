import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { useConfirm } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

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
  const c = useColors();
  const confirm = useConfirm();
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

    confirm({
      title: 'Transfer Ownership',
      message: `Transfer "${teams.find((t) => t.id === selectedTeamId)?.name}" to ${trimmedEmail}?\n\nThe new owner will have full control of this team.`,
      action: {
        label: 'Transfer',
        destructive: true,
        onPress: async () => {
          setSaving(true);
          try {
            const { data, error } = await supabase.rpc('transfer_team_ownership', {
              p_league_id: leagueId,
              p_team_id: selectedTeamId,
              p_new_owner_email: trimmedEmail,
            });

            if (error) throw error;
            const result = data as { error?: string } | null;
            if (result?.error) {
              Alert.alert('Error', result.error);
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
    });
  };

  const canTransfer = !!selectedTeamId && !!email.trim() && !saving;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Transfer Team Ownership"
      keyboardAvoiding
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
            label="Transfer"
            variant="primary"
            size="large"
            onPress={handleTransfer}
            loading={saving}
            disabled={!canTransfer}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Transfer ownership"
          />
        </View>
      }
    >
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
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
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
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
});
