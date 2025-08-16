import { StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';
import { IconSymbol } from '../ui/IconSymbol';

export function InviteSection({ isCommissioner }: { isCommissioner: boolean }) {
  if (!isCommissioner) return null;

  return (
    <ThemedView style={styles.section}>
      <TouchableOpacity style={styles.inviteButton}>
        <IconSymbol name="person.badge.plus" size={20} color="#666" />
        <ThemedText>Invite Players</ThemedText>
      </TouchableOpacity>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
  },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    backgroundColor: '#F5F7FA',
    borderRadius: 8,
  },
});