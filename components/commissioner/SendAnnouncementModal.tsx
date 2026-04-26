import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';

import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

const MAX_LENGTH = 500;

interface Props {
  visible: boolean;
  leagueId: string;
  teamId: string;
  onClose: () => void;
}

export function SendAnnouncementModal({ visible, leagueId, teamId, onClose }: Props) {
  const c = useColors();
  const queryClient = useQueryClient();
  const [content, setContent] = useState('');
  const [sending, setSending] = useState(false);

  function handleClose() {
    setContent('');
    onClose();
  }

  async function handleSend() {
    const trimmed = content.trim();
    if (!trimmed) return;

    setSending(true);
    try {
      const { error } = await supabase
        .from('commissioner_announcements')
        .insert({ league_id: leagueId, team_id: teamId, content: trimmed });
      if (error) throw error;

      // Push notification (fire-and-forget)
      sendNotification({
        league_id: leagueId,
        category: 'commissioner',
        title: 'Commissioner Announcement',
        body: trimmed.length > 100 ? trimmed.slice(0, 100) + '...' : trimmed,
        data: { screen: 'league-info' },
      });

      queryClient.invalidateQueries({ queryKey: ['announcements', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['latestAnnouncement', leagueId] });
      handleClose();
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setSending(false);
    }
  }

  const canSend = !!content.trim() && !sending;

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title="Send Announcement"
      keyboardAvoiding
      footer={
        <View style={styles.footer}>
          <BrandButton
            label="Cancel"
            variant="secondary"
            size="large"
            onPress={handleClose}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Cancel"
          />
          <BrandButton
            label="Send"
            variant="primary"
            size="large"
            onPress={handleSend}
            loading={sending}
            disabled={!canSend}
            fullWidth
            style={styles.footerBtn}
            accessibilityLabel="Send announcement"
          />
        </View>
      }
    >
      <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
        This will push-notify all league members and appear as an in-app banner.
      </ThemedText>

      <TextInput
        accessibilityLabel="Announcement message"
        style={[styles.input, { color: c.text, backgroundColor: c.cardAlt, borderColor: c.border }]}
        placeholder="Type your announcement..."
        placeholderTextColor={c.secondaryText}
        value={content}
        onChangeText={(t) => setContent(t.slice(0, MAX_LENGTH))}
        multiline
        maxLength={MAX_LENGTH}
        textAlignVertical="top"
        autoFocus
      />

      <ThemedText style={[styles.counter, { color: c.secondaryText }]}>
        {content.length}/{MAX_LENGTH}
      </ThemedText>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: ms(13), marginBottom: s(12) },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(12),
    fontSize: ms(16),
    minHeight: s(120),
  },
  counter: { fontSize: ms(12), textAlign: 'right', marginTop: s(8) },
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
});
