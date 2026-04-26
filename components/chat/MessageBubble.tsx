import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { useEffect, useMemo } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Animated, {
  FadeInUp,
  ZoomIn,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

import { PollBubble } from "@/components/chat/PollBubble";
import { RumorBubble } from "@/components/chat/RumorBubble";
import { SurveyBubble } from "@/components/chat/SurveyBubble";
import { TradeBubble } from "@/components/chat/TradeBubble";
import { TradeUpdateBubble } from "@/components/chat/TradeUpdateBubble";
import { TeamLogo } from "@/components/team/TeamLogo";
import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts } from "@/constants/Colors";
import { useColors } from "@/hooks/useColors";
import type { TradeUpdateContent, TradeUpdateEvent , ChatMessage, ReactionGroup } from "@/types/chat";
import { ms, s } from "@/utils/scale";


function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
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
  const c = useColors();

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
          entering={ZoomIn.delay(i * 40)
            .duration(200)
            .springify()}
        >
          <TouchableOpacity
            onPress={() => onReactionPress(rr.emoji)}
            style={[
              styles.reactionBadge,
              {
                backgroundColor: c.card,
                borderColor: rr.reacted_by_me ? c.gold : c.border,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={`${rr.emoji} reaction, ${rr.count}${rr.reacted_by_me ? ", you reacted" : ""}`}
          >
            <ThemedText style={styles.reactionEmoji}>{rr.emoji}</ThemedText>
            {rr.count > 1 && (
              <ThemedText
                style={[styles.reactionCount, { color: c.secondaryText }]}
              >
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
  teamLogoKey?: string | null;
  isCommissioner?: boolean;
  swipeReveal: SharedValue<number>;
  showSwipeTime: boolean;
  isSelected?: boolean;
  isPinned?: boolean;
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
  teamLogoKey,
  isCommissioner = false,
  swipeReveal,
  showSwipeTime,
  isSelected = false,
  isPinned = false,
}: Props) {
  const c = useColors();
  const handleLongPress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onLongPress();
  };

  // Subtle scale-up when selected — withTiming for a clean lift, no spring overshoot.
  const selectedScale = useSharedValue(1);
  useEffect(() => {
    selectedScale.value = withTiming(isSelected ? 1.03 : 1, { duration: 140 });
  }, [isSelected, selectedScale]);

  const selectedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: selectedScale.value }],
    zIndex: isSelected ? 10 : 0,
  }));

  const isSolo = isFirstInGroup && isLastInGroup;

  const bubbleRadii = useMemo(() => {
    if (isSolo) return { borderRadius: R };
    if (isOwnMessage) {
      if (isFirstInGroup)
        return {
          borderTopLeftRadius: R,
          borderTopRightRadius: R,
          borderBottomRightRadius: r,
          borderBottomLeftRadius: R,
        };
      if (isLastInGroup)
        return {
          borderTopLeftRadius: R,
          borderTopRightRadius: r,
          borderBottomRightRadius: R,
          borderBottomLeftRadius: R,
        };
      return {
        borderTopLeftRadius: R,
        borderTopRightRadius: r,
        borderBottomRightRadius: r,
        borderBottomLeftRadius: R,
      };
    }
    if (isFirstInGroup)
      return {
        borderTopLeftRadius: R,
        borderTopRightRadius: R,
        borderBottomRightRadius: R,
        borderBottomLeftRadius: r,
      };
    if (isLastInGroup)
      return {
        borderTopLeftRadius: r,
        borderTopRightRadius: R,
        borderBottomRightRadius: R,
        borderBottomLeftRadius: R,
      };
    return {
      borderTopLeftRadius: r,
      borderTopRightRadius: R,
      borderBottomRightRadius: R,
      borderBottomLeftRadius: r,
    };
  }, [isOwnMessage, isFirstInGroup, isLastInGroup, isSolo]);

  const animate = !isOwnMessage && shouldAnimate(message.created_at);
  const enterAnim = animate ? FadeInUp.duration(200).springify() : undefined;

  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: swipeReveal.value }],
  }));

  const avatarFadeStyle = useAnimatedStyle(() => ({
    opacity: interpolate(swipeReveal.value, [0, -30], [1, 0]),
  }));

  const timeRevealStyle = useAnimatedStyle(() => ({
    opacity: interpolate(swipeReveal.value, [0, -60], [0, 1]),
    transform: [
      { translateX: interpolate(swipeReveal.value, [0, -60], [10, 0]) },
    ],
  }));

  const timeStr = formatTime(message.created_at);

  // Poll messages
  if (message.type === "poll" && teamId) {
    return (
      <Animated.View
        entering={enterAnim}
        style={[
          styles.pollWrapper,
          isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped,
        ]}
      >
        {isPinned && (
          <View style={styles.pinSideFullWidth} accessibilityLabel="Pinned message">
            <Ionicons name="pin" size={ms(12)} color={c.gold} />
          </View>
        )}
        <View style={styles.swipeRow}>
          <Animated.View style={[{ flex: 1 }, slideStyle]}>
            <TouchableOpacity
              onLongPress={handleLongPress}
              delayLongPress={300}
              activeOpacity={0.8}
            >
              <ReactionBadges
                reactions={reactions}
                isOwnMessage={false}
                onReactionPress={onReactionPress}
              />
              <PollBubble
                pollId={message.content}
                teamId={teamId}
                isCommissioner={isCommissioner}
              />
            </TouchableOpacity>
          </Animated.View>
          {showSwipeTime && (
            <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
              <ThemedText
                style={[styles.swipeTimeText, { color: c.secondaryText }]}
              >
                {timeStr}
              </ThemedText>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    );
  }

  // Trade announcement messages
  if (message.type === "trade") {
    return (
      <Animated.View
        entering={enterAnim}
        style={[
          styles.pollWrapper,
          isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped,
        ]}
      >
        <View style={styles.swipeRow}>
          <Animated.View style={[{ flex: 1 }, slideStyle]}>
            <TouchableOpacity
              onLongPress={handleLongPress}
              delayLongPress={300}
              activeOpacity={0.8}
            >
              <ReactionBadges
                reactions={reactions}
                isOwnMessage={false}
                onReactionPress={onReactionPress}
              />
              <TradeBubble tradeSummary={message.trade_summary} />
            </TouchableOpacity>
          </Animated.View>
          {showSwipeTime && (
            <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
              <ThemedText
                style={[styles.swipeTimeText, { color: c.secondaryText }]}
              >
                {timeStr}
              </ThemedText>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    );
  }

  // Survey messages
  if (message.type === "survey" && teamId) {
    return (
      <Animated.View
        entering={enterAnim}
        style={[
          styles.pollWrapper,
          isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped,
        ]}
      >
        {isPinned && (
          <View style={styles.pinSideFullWidth} accessibilityLabel="Pinned message">
            <Ionicons name="pin" size={ms(12)} color={c.gold} />
          </View>
        )}
        <View style={styles.swipeRow}>
          <Animated.View style={[{ flex: 1 }, slideStyle]}>
            <TouchableOpacity
              onLongPress={handleLongPress}
              delayLongPress={300}
              activeOpacity={0.8}
            >
              <ReactionBadges
                reactions={reactions}
                isOwnMessage={false}
                onReactionPress={onReactionPress}
              />
              <SurveyBubble
                surveyId={message.content}
                teamId={teamId}
                isCommissioner={isCommissioner}
                embedded={{
                  title: message.survey_title,
                  description: message.survey_description,
                  questionCount: message.survey_question_count,
                  closesAt: message.survey_closes_at,
                  resultsVisibility: message.survey_results_visibility,
                }}
              />
            </TouchableOpacity>
          </Animated.View>
          {showSwipeTime && (
            <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
              <ThemedText
                style={[styles.swipeTimeText, { color: c.secondaryText }]}
              >
                {timeStr}
              </ThemedText>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    );
  }

  // Image and GIF messages
  if (message.type === "image" || message.type === "gif") {
    const label = message.type === "image"
      ? `Photo ${isOwnMessage ? "you sent" : `from ${message.team_name}`}`
      : `GIF ${isOwnMessage ? "you sent" : `from ${message.team_name}`}`;

    return (
      <Animated.View
        entering={enterAnim}
        style={[
          styles.outerRow,
          isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped,
        ]}
      >
        {showSender && !isOwnMessage && isFirstInGroup && (
          <Animated.View style={slideStyle}>
            <ThemedText style={[styles.sender, { color: c.secondaryText }]}>
              {message.team_name}
            </ThemedText>
          </Animated.View>
        )}

        <View
          style={[
            styles.swipeRow,
            isOwnMessage ? styles.swipeRowRight : styles.swipeRowLeft,
          ]}
        >
          {!isOwnMessage && isLastInGroup ? (
            <Animated.View
              style={[
                { width: 28, marginRight: 6, marginBottom: 2, alignSelf: "flex-end" },
                avatarFadeStyle,
              ]}
            >
              <TeamLogo
                logoKey={teamLogoKey}
                teamName={message.team_name ?? ""}
                size="small"
              />
            </Animated.View>
          ) : !isOwnMessage ? (
            <View style={{ width: 28, marginRight: 6 }} />
          ) : null}
          <Animated.View style={[styles.wrapper, slideStyle, selectedStyle]}>
            <ReactionBadges
              reactions={reactions}
              isOwnMessage={isOwnMessage}
              onReactionPress={onReactionPress}
            />

            <TouchableOpacity
              onLongPress={handleLongPress}
              delayLongPress={300}
              activeOpacity={0.8}
              style={[
                styles.mediaBubble,
                bubbleRadii,
                isOwnMessage
                  ? { backgroundColor: c.gold }
                  : { backgroundColor: c.cardAlt },
              ]}
              accessibilityLabel={label}
              accessibilityHint="Long press to react"
            >
              <Image
                source={{ uri: message.content }}
                style={styles.mediaImage}
                contentFit="cover"
                cachePolicy="memory-disk"
                autoplay
              />
            </TouchableOpacity>
          </Animated.View>

          {showSwipeTime && (
            <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
              <ThemedText
                style={[styles.swipeTimeText, { color: c.secondaryText }]}
              >
                {timeStr}
              </ThemedText>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    );
  }

  // Rumor messages
  if (message.type === "rumor") {
    let rumorText = message.content;
    try {
      const parsed = JSON.parse(message.content);
      rumorText = parsed.template.replace("{player}", parsed.player_name);
    } catch {
      // content may already be the interpolated string
    }
    return (
      <Animated.View
        entering={enterAnim}
        style={[
          styles.pollWrapper,
          isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped,
        ]}
      >
        <View style={styles.swipeRow}>
          <Animated.View style={[{ flex: 1 }, slideStyle]}>
            <TouchableOpacity
              onLongPress={handleLongPress}
              delayLongPress={300}
              activeOpacity={0.8}
            >
              <ReactionBadges
                reactions={reactions}
                isOwnMessage={false}
                onReactionPress={onReactionPress}
              />
              <RumorBubble rumorText={rumorText} />
            </TouchableOpacity>
          </Animated.View>
          {showSwipeTime && (
            <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
              <ThemedText
                style={[styles.swipeTimeText, { color: c.secondaryText }]}
              >
                {timeStr}
              </ThemedText>
            </Animated.View>
          )}
        </View>
      </Animated.View>
    );
  }

  // Trade update system messages
  if (message.type === "trade_update") {
    let event: TradeUpdateEvent = "proposed";
    let updateTeamName: string | null = null;
    try {
      const parsed: TradeUpdateContent = JSON.parse(message.content);
      event = parsed.event;
      updateTeamName = parsed.team_name;
    } catch {
      // fall back to defaults
    }
    return (
      <Animated.View
        entering={enterAnim}
        style={[
          styles.pollWrapper,
          isFirstInGroup ? styles.wrapperGroupEnd : styles.wrapperGrouped,
        ]}
      >
        <View style={styles.swipeRow}>
          <Animated.View style={[{ flex: 1 }, slideStyle]}>
            <TradeUpdateBubble event={event} teamName={updateTeamName} />
          </Animated.View>
          {showSwipeTime && (
            <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
              <ThemedText
                style={[styles.swipeTimeText, { color: c.secondaryText }]}
              >
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
        <Animated.View style={slideStyle}>
          <ThemedText style={[styles.sender, { color: c.secondaryText }]}>
            {message.team_name}
          </ThemedText>
        </Animated.View>
      )}

      <View
        style={[
          styles.swipeRow,
          isOwnMessage ? styles.swipeRowRight : styles.swipeRowLeft,
        ]}
      >
        {/* Pin icon on the far side of the bubble */}
        {isPinned && isOwnMessage && (
          <View style={styles.pinSide} accessibilityLabel="Pinned message">
            <Ionicons name="pin" size={ms(12)} color={c.gold} />
          </View>
        )}

        {/* iMessage-style avatar: bottom-left of last message in group */}
        {!isOwnMessage && isLastInGroup ? (
          <Animated.View
            style={[
              { width: 28, marginRight: 6, marginBottom: 2, alignSelf: "flex-end" },
              avatarFadeStyle,
            ]}
          >
            <TeamLogo
              logoKey={teamLogoKey}
              teamName={message.team_name ?? ""}
              size="small"
            />
          </Animated.View>
        ) : !isOwnMessage ? (
          <View style={{ width: 28, marginRight: 6 }} />
        ) : null}
        <Animated.View style={[styles.wrapper, slideStyle, selectedStyle]}>
          <ReactionBadges
            reactions={reactions}
            isOwnMessage={isOwnMessage}
            onReactionPress={onReactionPress}
          />

          <TouchableOpacity
            onLongPress={handleLongPress}
            delayLongPress={300}
            activeOpacity={0.8}
            style={[
              styles.bubble,
              bubbleRadii,
              isOwnMessage
                ? { backgroundColor: c.gold }
                : { backgroundColor: c.cardAlt },
            ]}
            accessibilityLabel={`${isOwnMessage ? "You" : message.team_name}: ${message.content}`}
            accessibilityHint="Long press to react, swipe left for time"
          >
            <ThemedText
              style={[
                styles.content,
                { color: isOwnMessage ? "#FFFFFF" : c.text },
              ]}
            >
              {message.content}
            </ThemedText>
          </TouchableOpacity>
        </Animated.View>

        {/* Pin icon on the far side of the bubble */}
        {isPinned && !isOwnMessage && (
          <View style={styles.pinSide} accessibilityLabel="Pinned message">
            <Ionicons name="pin" size={ms(12)} color={c.gold} />
          </View>
        )}

        {showSwipeTime && (
          <Animated.View style={[styles.swipeTime, timeRevealStyle]}>
            <ThemedText
              style={[styles.swipeTimeText, { color: c.secondaryText }]}
            >
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
    width: "100%",
    alignSelf: "center",
  },
  outerRow: {
    width: "100%",
  },
  swipeRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  swipeRowLeft: {
    justifyContent: "flex-start",
  },
  swipeRowRight: {
    justifyContent: "flex-end",
  },
  wrapper: {
    maxWidth: "80%",
  },
  wrapperGrouped: {
    marginTop: s(2),
  },
  wrapperGroupEnd: {
    marginTop: s(8),
  },
  pinSide: {
    alignSelf: "center",
    marginHorizontal: s(4),
    opacity: 0.7,
  },
  pinSideFullWidth: {
    position: "absolute",
    top: s(8),
    right: s(4),
    zIndex: 1,
    opacity: 0.7,
  },
  sender: {
    fontFamily: Fonts.display,
    fontSize: ms(12),
    lineHeight: ms(15),
    letterSpacing: -0.2,
    marginBottom: s(3),
    marginLeft: s(40),
  },
  bubble: {
    paddingHorizontal: s(14),
    paddingVertical: s(8),
  },
  content: {
    fontSize: ms(15),
    lineHeight: ms(20),
  },
  mediaBubble: {
    overflow: "hidden",
  },
  mediaImage: {
    width: s(220),
    height: s(220),
  },
  // Reaction badges sitting above the bubble
  reactionRow: {
    flexDirection: "row",
    gap: s(2),
    marginBottom: s(-12),
    zIndex: 1,
  },
  reactionRowLeft: {
    alignSelf: "flex-start",
    marginLeft: s(-12),
  },
  reactionRowRight: {
    alignSelf: "flex-end",
    marginRight: s(-12),
  },
  reactionBadge: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    minWidth: s(30),
    height: s(30),
    borderRadius: 15,
    paddingHorizontal: s(6),
    borderWidth: 1.5,
    gap: s(2),
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 2,
  },
  reactionEmoji: {
    fontSize: ms(14),
    lineHeight: ms(18),
  },
  reactionCount: {
    fontSize: ms(11),
    fontWeight: "600",
    lineHeight: ms(14),
  },
  swipeTime: {
    position: "absolute",
    right: 0,
    alignItems: "center",
    justifyContent: "center",
    width: s(60),
  },
  swipeTimeText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9),
    letterSpacing: 0.8,
  },
});
