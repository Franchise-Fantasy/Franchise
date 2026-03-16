import { PollBubble } from '@/components/chat/PollBubble';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ChatMessage, ReactionGroup } from '@/types/chat';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  FadeInUp,
  ZoomIn,
  interpolate,
  type SharedValue,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function shouldAnimate(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 2000;
}

const R = 18;
const r = 4;

// iMessage-style reaction badges that overlap the bottom edge of the bubble
function ReactionBadges({
  reactions,
  isOwnMessage,
  onReactionPress,
}: {
  reactions: ReactionGroup[];
  isOwnMessage: boolean;
  onReactionPress: (emoji: string) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (reactions.length === 0) return null;

  return (
    <View
      style={[
        styles.reactionRow,
        isOwnMessage ? styles.reactionRowLeft : styles.reactionRowRight,
      ]}
    >
      {reactions.map((rr, i) => (
        <Animated.View
          key={rr.emoji}
          entering={ZoomIn.delay(i * 40).duration(200).springify()}
        >
          <TouchableOpacity
            onPress={() => onReactionPress(rr.emoji)}
            style={[
              styles.reactionBadge,
              {
                backgroundColor: c.card,
                borderColor: rr.reacted_by_me ? c.accent : c.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${rr.emoji} reaction, ${rr.count}${rr.reacted_by_me ? ', you reacted' : ''}`}
          >
            <ThemedText style={styles.reactionEmoji}>{rr.emoji}</ThemedText>
            {rr.count > 1 && (
              <ThemedText style={[styles.reactionCount, { color: c.secondaryText }]}>
                {rr.count}
              </ThemedText>
            )}
          </TouchableOpacity>
        </Animated.View>
      ))}
    </View>
  );
}

interface Props {
  message: ChatMessage;
  isOwnMessage: boolean;
  showSender: boolean;
  isFirstInGroup: boolean;
  isLastInGroup: boolean;
  reactions: ReactionGroup[];
  onLongPress: () => void;
  onReactionPress: (emoji: string) => void;
  teamId?: string;
  isCommissioner?: boolean;
  swipeReveal: SharedValue<number>;
  showSwipeTime: boolean;
  isSelected?: boolean;
}

export function MessageBubble({
  message,
  isOwnMessage,
  showSender,
  isFirstInGroup,
  isLastInGroup,
  reactions,
  onLongPress,
  onReactionPress,
  teamId,
  isCommissioner = false,
  swipeReveal,
  showSwipeTime,
  isSelected = false,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLongPress();
  };

  // iMessage-style scale-up when selected
  const selectedScale = useSharedValue(1);
  useEffect(() => {
    selectedScale.value = withSpring(isSelected ? 1.05 : 1, {
      damping: 20,
      stiffness: 300,
    });
  }, [isSelected, selectedScale]);

  const selectedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: selectedScale.value }],
    zIndex: isSelected ? 10 : 0,
  }));

  const isSolo = isFirstInGroup && isLastInGroup;

  const bubbleRadii = useMemo(() => {
    if (isSolo) return { borderRadius: R };
    if (isOwnMessage) {
      if (isFirstInGroup) return { borderTopLeftRadius: R, borderTopRightRadius: R, borderBottomRightRadius: r, borderBottomLeftRadius: R };
      if (isLastInGroup) return { borderTopLeftRadius: R, borderTopRightRadius: r, borderBottomRightRadius: R, borderBottomLeftRadius: R };
      return { borderTopLeftRadius: R, borderTopRightRadius: r, borderBottomRightRadius: r, borderBottomLeftRadius: R };
    }
    if (isFirstInGroup) return { borderTopLeftRadius: R, borderTopRightRadius: R, borderBottomRightRadius: R, borderBottomLeftRadius: r };
    if (isLastInGroup) return { borderTopLeftRadius: r, borderTopRightRadius: R, borderBottomRightRadius: R, borderBottomLeftRadius: R };
    return { borderTopLeftRadius: r, borderTopRightRadius: R, borderBottomRightRadius: R, borderBottomLeftRadius: r };
  }, [isOwnMessage, isFirstInGroup, isLastInGroup, isSolo]);

  const animate = !isOwnMessage && shouldAnimate(message.created_at);
  const enterAnim = animate ? FadeInUp.duration(200).springify() : undefined;

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeReveal.value }],
  }));

  const timeRevealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(swipeReveal.value, [0, -60], [0, 1]),
    transform: [{ translateX: interpolate(swipeReveal.value, [0, -60], [10, 0]) }],
  }));

  const timeStr = formatTime(message.created_at);

  // Poll messages
  if (message.type === 'poll' && teamId) {
    return (
      <Animated.View
        entering={enterAnim}
        style={[styles.pollWrapper, isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped]}
      >
        <View style={styles.swipeRow}>
          <Animated.View style={[{ flex: 1 }, slideStyle]}>
            <ReactionBadges reactions={reactions} isOwnMessage={false} onReactionPress={onReactionPress} />
            <PollBubble
              pollId={message.content}
              teamId={teamId}
              isCommissioner={isCommissioner}
            />
          </Animated.View>
          {showSwipeTime && (
            <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
              <ThemedText style={[styles.swipeTimeText, { color: c.secondaryText }]}>
                {timeStr}
              </ThemedText>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      entering={enterAnim}
      style={[
        styles.outerRow,
        isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped,
      ]}
    >
      {showSender && !isOwnMessage && isFirstInGroup && (
        <ThemedText style={[styles.sender, { color: c.secondaryText }]}>
          {message.team_name}
        </ThemedText>
      )}

      <View style={[styles.swipeRow, isOwnMessage ? styles.swipeRowRight : styles.swipeRowLeft]}>
        <Animated.View style={[styles.wrapper, slideStyle, selectedStyle]}>
          <ReactionBadges reactions={reactions} isOwnMessage={isOwnMessage} onReactionPress={onReactionPress} />

          <TouchableOpacity
            onLongPress={handleLongPress}
            delayLongPress={300}
            activeOpacity={0.8}
            style={[
              styles.bubble,
              bubbleRadii,
              isOwnMessage
                ? { backgroundColor: c.accent }
                : { backgroundColor: c.cardAlt },
            ]}
            accessibilityLabel={`${isOwnMessage ? 'You' : message.team_name}: ${message.content}`}
            accessibilityHint="Long press to react, swipe left for time"
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
        </Animated.View>

        {showSwipeTime && (
          <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
            <ThemedText style={[styles.swipeTimeText, { color: c.secondaryText }]}>
              {timeStr}
            </ThemedText>
          </Animated.View>
        )}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  pollWrapper: {
    width: '100%',
    alignSelf: 'center',
  },
  outerRow: {
    width: '100%',
  },
  swipeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  swipeRowLeft: {
    justifyContent: 'flex-start',
  },
  swipeRowRight: {
    justifyContent: 'flex-end',
  },
  wrapper: {
    maxWidth: '80%',
  },
  wrapperGrouped: {
    marginTop: 2,
  },
  wrapperGroupEnd: {
    marginTop: 8,
  },
  sender: {
    fontSize: 11,
    fontWeight: '600',
    marginBottom: 2,
    marginLeft: 10,
  },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  content: {
    fontSize: 15,
    lineHeight: 20,
  },
  // Reaction badges sitting above the bubble
  reactionRow: {
    flexDirection: 'row',
    gap: 2,
    marginBottom: -12,
    zIndex: 1,
  },
  reactionRowLeft: {
    alignSelf: 'flex-start',
    marginLeft: -12,
  },
  reactionRowRight: {
    alignSelf: 'flex-end',
    marginRight: -12,
  },
  reactionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 30,
    height: 30,
    borderRadius: 15,
    paddingHorizontal: 6,
    borderWidth: 1.5,
    gap: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  reactionEmoji: {
    fontSize: 14,
    lineHeight: 18,
  },
  reactionCount: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  swipeTime: {
    position: 'absolute',
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 60,
  },
  swipeTimeText: {
    fontSize: 10,
    fontWeight: '500',
  },
});
