import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { generateInviteCode } from '@/utils/inviteCode';
import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Share, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';

interface InviteSectionProps {
  isCommissioner: boolean;
  inviteCode: string | null;
  leagueId: string;
  isFull: boolean;
}

export function InviteSection({ isCommissioner, inviteCode, leagueId, isFull }: InviteSectionProps) {
  if (!isCommissioner || isFull || !inviteCode) return null;

  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const inviteLink = `franchisev2://join?code=${inviteCode}`;

  const handleCopy = async () => {
    await Clipboard.setStringAsync(inviteLink);
    Alert.alert('Copied', 'Invite link copied to clipboard.');
  };

  const handleShare = async () => {
    await Share.share({
      message: `Join my league on Franchise! Use invite code: ${inviteCode}\n\nOr tap to join: ${inviteLink}`,
    });
  };

  const handleRegenerate = () => {
    Alert.alert(
      'Regenerate Invite Code',
      'This will invalidate the current code. Anyone with the old code will no longer be able to join.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Regenerate',
          style: 'destructive',
          onPress: async () => {
            const newCode = generateInviteCode();
            const { error } = await supabase
              .from('leagues')
              .update({ invite_code: newCode })
              .eq('id', leagueId);
            if (error) {
              Alert.alert('Error', error.message);
            } else {
              queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
            }
          },
        },
      ],
    );
  };

  return (
    <ThemedView style={styles.section}>
      <ThemedText type="defaultSemiBold" style={styles.label}>Invite Code</ThemedText>
      <View style={[styles.codeCard, { backgroundColor: c.cardAlt }]}>
        <ThemedText style={styles.code}>{inviteCode}</ThemedText>
        <View style={styles.actions}>
          <TouchableOpacity onPress={handleCopy} style={styles.actionBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy invite link">
            <Ionicons name="copy-outline" size={20} color={c.accent} accessible={false} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleShare} style={styles.actionBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Share invite link">
            <Ionicons name="share-outline" size={20} color={c.accent} accessible={false} />
          </TouchableOpacity>
          <TouchableOpacity onPress={handleRegenerate} style={styles.actionBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Regenerate invite code">
            <Ionicons name="refresh-outline" size={20} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
        </View>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: 16 },
  label: { marginBottom: 8 },
  codeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 14,
    borderRadius: 10,
  },
  code: {
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 3,
    fontFamily: 'monospace',
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  actionBtn: {
    padding: 4,
  },
});
