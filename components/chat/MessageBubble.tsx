import { PollBubble } from '@/components/chat/PollBubble';
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
  showTime: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  reactions: ReactionGroup[];
  onLongPress: () => void;
  onReactionPress: (emoji: string) => void;
  teamId?: string;
  isCommissioner?: boolean;
}

export function MessageBubble({
  message,
  isOwnMessage,
  showSender,
  showTime,
  isFirstInGroup,
  isLastInGroup,
  reactions,
  onLongPress,
  onReactionPress,
  teamId,
  isCommissioner = false,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLongPress();
  };

  // Poll messages render as full-width poll cards
  if (message.type === 'poll' && teamId) {
    return (
      <View style={[styles.pollWrapper, isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped]}>
        <PollBubble
          pollId={message.content}
          teamId={teamId}
          isCommissioner={isCommissioner}
        />
        {reactions.length > 0 && (
          <View style={[styles.reactions, styles.reactionsLeft]}>
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
                accessibilityRole="button"
                accessibilityLabel={`${r.emoji} reaction, ${r.count}${r.reacted_by_me ? ', you reacted' : ''}`}
              >
                <ThemedText style={styles.reactionText}>
                  {r.emoji} {r.count}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {showTime && (
          <ThemedText style={[styles.time, { color: c.secondaryText }, styles.timeLeft]}>
            {formatTime(message.created_at)}
          </ThemedText>
        )}
      </View>
    );
  }

  return (
    <View
      style={[
        styles.wrapper,
        isOwnMessage ? styles.wrapperRight : styles.wrapperLeft,
        isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped,
      ]}
    >
      {showSender && !isOwnMessage && isLastInGroup && (
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
        accessibilityLabel={`${isOwnMessage ? 'You' : message.team_name}: ${message.content}`}
        accessibilityHint="Long press to add reaction"
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
              accessibilityRole="button"
              accessibilityLabel={`${r.emoji} reaction, ${r.count}${r.reacted_by_me ? ', you reacted' : ''}`}
            >
              <ThemedText style={styles.reactionText}>
                {r.emoji} {r.count}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {showTime && (
        <ThemedText
          style={[
            styles.time,
            { color: c.secondaryText },
            isOwnMessage ? styles.timeRight : styles.timeLeft,
          ]}
        >
          {formatTime(message.created_at)}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pollWrapper: {
    width: '100%',
    alignSelf: 'center',
  },
  wrapper: {
    maxWidth: '80%',
  },
  wrapperGrouped: {
    marginTop: 1,
  },
  wrapperGroupEnd: {
    marginTop: 8,
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
