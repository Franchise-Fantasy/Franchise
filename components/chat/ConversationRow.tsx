import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ConversationPreview } from '@/types/chat';
import { ms, s } from '@/utils/scale';

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
  const isTrade = conversation.type === 'trade';
  const name = isLeague
    ? 'League Chat'
    : isTrade
      ? `Trade: ${conversation.other_team_name ?? 'Trade'}`
      : conversation.other_team_name ?? 'DM';
  const hasUnread = conversation.unread_count > 0;

  const preview = conversation.last_message
    ? (conversation.type === 'league' || conversation.type === 'trade') && conversation.last_message_team_name
      ? `${conversation.last_message_team_name}: ${conversation.last_message}`
      : conversation.last_message
    : 'No messages yet';

  // Subtle press animation
  const scale = useSharedValue(1);
  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <Animated.View style={animStyle}>
      <Pressable
        style={[styles.row, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}
        onPress={onPress}
        onPressIn={() => { scale.value = withSpring(0.97, { damping: 15, stiffness: 300 }); }}
        onPressOut={() => { scale.value = withSpring(1, { damping: 15, stiffness: 300 }); }}
        accessibilityRole="button"
        accessibilityLabel={`${name}${hasUnread ? `, ${conversation.unread_count} unread` : ''}`}
      >
        <View style={[styles.iconCircle, { backgroundColor: c.cardAlt }]}>
          <Ionicons
            name={isLeague ? 'chatbubbles' : isTrade ? 'swap-horizontal' : 'person'}
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
              <ThemedText style={[styles.time, { color: hasUnread ? c.accent : c.secondaryText }]}>
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
                <ThemedText style={[styles.badgeText, { color: c.statusText }]}>
                  {conversation.unread_count > 99
                    ? '99+'
                    : conversation.unread_count}
                </ThemedText>
              </View>
            )}
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    paddingHorizontal: s(16),
    gap: s(12),
    borderRadius: 12,
    borderWidth: 1,
    marginHorizontal: s(12),
    marginVertical: s(4),
  },
  iconCircle: {
    width: s(44),
    height: s(44),
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
    gap: s(4),
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  name: {
    fontSize: ms(15),
    fontWeight: '600',
    flex: 1,
    marginRight: s(8),
  },
  time: {
    fontSize: ms(12),
  },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  preview: {
    fontSize: ms(13),
    flex: 1,
  },
  previewBold: {
    fontWeight: '600',
  },
  badge: {
    minWidth: s(20),
    height: s(20),
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(6),
  },
  badgeText: {
    fontSize: ms(11),
    fontWeight: '700',
    lineHeight: ms(20),
    includeFontPadding: false,
  },
});
