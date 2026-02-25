import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ConversationPreview } from '@/types/chat';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Now';
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

interface Props {
  conversation: ConversationPreview;
  onPress: () => void;
}

export function ConversationRow({ conversation, onPress }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const isLeague = conversation.type === 'league';
  const name = isLeague ? 'League Chat' : conversation.other_team_name ?? 'DM';
  const hasUnread = conversation.unread_count > 0;

  const preview = conversation.last_message
    ? conversation.type === 'league' && conversation.last_message_team_name
      ? `${conversation.last_message_team_name}: ${conversation.last_message}`
      : conversation.last_message
    : 'No messages yet';

  return (
    <TouchableOpacity
      style={[styles.row, { backgroundColor: c.card, borderColor: c.border }]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconCircle, { backgroundColor: c.cardAlt }]}>
        <Ionicons
          name={isLeague ? 'chatbubbles' : 'person'}
          size={20}
          color={c.accent}
        />
      </View>

      <View style={styles.content}>
        <View style={styles.topRow}>
          <ThemedText style={styles.name} numberOfLines={1}>
            {name}
          </ThemedText>
          {conversation.last_message_at && (
            <ThemedText style={[styles.time, { color: c.secondaryText }]}>
              {formatTime(conversation.last_message_at)}
            </ThemedText>
          )}
        </View>
        <View style={styles.bottomRow}>
          <ThemedText
            style={[
              styles.preview,
              { color: hasUnread ? c.text : c.secondaryText },
              hasUnread && styles.previewBold,
            ]}
            numberOfLines={1}
          >
            {preview}
          </ThemedText>
          {hasUnread && (
            <View style={[styles.badge, { backgroundColor: c.accent }]}>
              <ThemedText style={styles.badgeText}>
                {conversation.unread_count > 99
                  ? '99+'
                  : conversation.unread_count}
              </ThemedText>
            </View>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    gap: 12,
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: 4,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    marginRight: 8,
  },
  time: {
    fontSize: 12,
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  preview: {
    fontSize: 13,
    flex: 1,
  },
  previewBold: {
    fontWeight: '600',
  },
  badge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '700',
    lineHeight: 20,
    includeFontPadding: false,
  },
});
