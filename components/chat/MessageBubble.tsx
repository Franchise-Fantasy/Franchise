import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ChatMessage, ReactionGroup } from '@/types/chat';
import * as Haptics from 'expo-haptics';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

interface Props {
  message: ChatMessage;
  isOwnMessage: boolean;
  showSender: boolean;
  reactions: ReactionGroup[];
  onLongPress: () => void;
  onReactionPress: (emoji: string) => void;
}

export function MessageBubble({
  message,
  isOwnMessage,
  showSender,
  reactions,
  onLongPress,
  onReactionPress,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLongPress();
  };

  return (
    <View
      style={[
        styles.wrapper,
        isOwnMessage ? styles.wrapperRight : styles.wrapperLeft,
      ]}
    >
      {showSender && !isOwnMessage && (
        <ThemedText style={[styles.sender, { color: c.secondaryText }]}>
          {message.team_name}
        </ThemedText>
      )}

      <TouchableOpacity
        onLongPress={handleLongPress}
        delayLongPress={300}
        activeOpacity={0.8}
        style={[
          styles.bubble,
          isOwnMessage
            ? [styles.bubbleOwn, { backgroundColor: c.accent }]
            : [styles.bubbleOther, { backgroundColor: c.cardAlt }],
        ]}
      >
        <ThemedText
          style={[
            styles.content,
            { color: isOwnMessage ? '#FFFFFF' : c.text },
          ]}
        >
          {message.content}
        </ThemedText>
      </TouchableOpacity>

      {reactions.length > 0 && (
        <View
          style={[
            styles.reactions,
            isOwnMessage ? styles.reactionsRight : styles.reactionsLeft,
          ]}
        >
          {reactions.map((r) => (
            <TouchableOpacity
              key={r.emoji}
              onPress={() => onReactionPress(r.emoji)}
              style={[
                styles.reactionPill,
                {
                  backgroundColor: r.reacted_by_me ? c.activeCard : c.cardAlt,
                  borderColor: r.reacted_by_me ? c.activeBorder : c.border,
                },
              ]}
            >
              <ThemedText style={styles.reactionText}>
                {r.emoji} {r.count}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      )}

      <ThemedText
        style={[
          styles.time,
          { color: c.secondaryText },
          isOwnMessage ? styles.timeRight : styles.timeLeft,
        ]}
      >
        {formatTime(message.created_at)}
      </ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    marginVertical: 2,
    maxWidth: '80%',
  },
  wrapperLeft: {
    alignSelf: 'flex-start',
  },
  wrapperRight: {
    alignSelf: 'flex-end',
  },
  sender: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
    marginLeft: 10,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    alignSelf: 'flex-start',
  },
  bubbleOwn: {
    borderBottomRightRadius: 4,
    alignSelf: 'flex-end',
  },
  bubbleOther: {
    borderBottomLeftRadius: 4,
    alignSelf: 'flex-start',
  },
  content: {
    fontSize: 15,
    lineHeight: 20,
  },
  reactions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
  },
  reactionsLeft: {
    marginLeft: 6,
  },
  reactionsRight: {
    justifyContent: 'flex-end',
    marginRight: 6,
  },
  reactionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderWidth: 1,
  },
  reactionText: {
    fontSize: 13,
  },
  time: {
    fontSize: 11,
    marginTop: 2,
  },
  timeLeft: {
    marginLeft: 10,
  },
  timeRight: {
    textAlign: 'right',
    marginRight: 10,
  },
});
