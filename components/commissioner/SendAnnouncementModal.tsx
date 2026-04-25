import { Ionicons } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
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
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
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

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.content, { backgroundColor: c.card }]} accessibilityViewIsModal={true}>
          <View style={styles.header}>
            <ThemedText accessibilityRole="header" type="subtitle">Send Announcement</ThemedText>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={handleClose}>
              <Ionicons name="close" size={24} color={c.text} />
            </TouchableOpacity>
          </View>

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

          <View style={styles.footer}>
            <ThemedText style={[styles.counter, { color: c.secondaryText }]}>
              {content.length}/{MAX_LENGTH}
            </ThemedText>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Send announcement"
              accessibilityState={{ disabled: !content.trim() || sending }}
              style={[
                styles.sendBtn,
                { backgroundColor: content.trim() && !sending ? c.warning : c.border },
              ]}
              onPress={handleSend}
              disabled={!content.trim() || sending}
            >
              {sending ? (
                <LogoSpinner size={18} />
              ) : (
                <Text style={{ color: c.statusText, fontWeight: '600' }}>Send</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  content: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: s(20),
    paddingBottom: s(32),
    minHeight: '40%',
    maxHeight: '80%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(12),
  },
  hint: { fontSize: ms(13), marginBottom: s(12) },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(12),
    fontSize: ms(16),
    minHeight: s(120),
    flex: 1,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: s(12),
  },
  counter: { fontSize: ms(12) },
  sendBtn: {
    paddingHorizontal: s(20),
    paddingVertical: s(10),
    borderRadius: 8,
    alignItems: 'center',
    minWidth: s(80),
  },
});
