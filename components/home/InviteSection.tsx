import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { StyleSheet, TouchableOpacity } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';
import { IconSymbol } from '../ui/IconSymbol';

export function InviteSection({ isCommissioner }: { isCommissioner: boolean }) {
  if (!isCommissioner) return null;
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <ThemedView style={styles.section}>
      <TouchableOpacity style={[styles.inviteButton, { backgroundColor: c.cardAlt }]}>
        <IconSymbol name="person.badge.plus" size={20} color={c.icon} />
        <ThemedText>Invite Players</ThemedText>
      </TouchableOpacity>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  inviteButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 8,
  },
});