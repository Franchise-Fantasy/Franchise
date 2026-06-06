import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Animated, {
  Easing,
  LinearTransition,
  SlideInRight,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { TeamLogo } from "@/components/team/TeamLogo";
import { Fonts } from "@/constants/Colors";
import type { ReadReceipt } from "@/hooks/chat/useReadReceipts";
import { useColors } from "@/hooks/useColors";
import { ms, s } from "@/utils/scale";

interface PresenceAvatarsProps {
  /** Online teams (excluding self) */
  onlineTeams: ReadReceipt[];
  /** Map of team_id → logo_key */
  teamLogoMap: Record<string, string | null> | undefined;
  myTeamId: string;
  myTeamName: string;
  myLogoKey: string | null | undefined;
  myTricode: string | null;
  onPress: () => void;
}

type AvatarEntry = {
  team_id: string;
  team_name: string;
  tricode: string;
  logo_key: string | null | undefined;
  exiting?: boolean;
};

const AVATAR_SIZE = 32;
const OVERLAP = -16;
const MAX_VISIBLE = 4;
const HEADER_HEIGHT = s(50); // matches PageHeader + the draft-room header bar
// Entrance slide-in distance. Kept within the header's right inset (~20px) so
// the header's overflow:hidden clip doesn't truncate the glide — a larger
// offset would start the avatar off the right edge and make it "wipe" in.
const ENTRANCE_OFFSET = 16;
// Exit: slide straight down while fading out, slow enough to read as a
// deliberate departure. The ring is vertically centered in the bar, so to tuck
// fully BEHIND the bottom hairline (the header clips its content) it must drop
// half the bar height + half its own height (incl. the 1.5px ring border) + a
// small buffer. Derived from the scaled bar height so clearance holds on wide
// screens. The slot is reclaimed (avatar unmounts) only after this finishes.
const EXIT_MS = 450;
const EXIT_DROP_Y = HEADER_HEIGHT / 2 + AVATAR_SIZE / 2 + 1.5 + 4;
const SHIFT_MS = 250;

/**
 * Stacked team logo avatars that slide in from the right edge.
 * Shows online users in the league chat header.
 */
export function PresenceAvatars({
  onlineTeams,
  teamLogoMap,
  myTeamId,
  myTeamName,
  myLogoKey,
  myTricode,
  onPress,
}: PresenceAvatarsProps) {
  const c = useColors();

  // Stable join-order: first arrival leftmost, newest on the right.
  // We defer adding self until presence has synced so that teams already
  // in the room appear to the left of us.
  const orderRef = useRef<string[]>([]);
  const selfAddedRef = useRef(false);
  const [selfReady, setSelfReady] = useState(false);

  // Wait for presence to deliver its first sync before locking self's position.
  // If nobody else is online, a short timer ensures self still appears quickly.
  useEffect(() => {
    if (selfAddedRef.current) return;
    if (onlineTeams.length > 0) {
      // Presence synced with others already here — add them first, then self
      selfAddedRef.current = true;
      setSelfReady(true);
      return;
    }
    const t = setTimeout(() => {
      if (!selfAddedRef.current) {
        selfAddedRef.current = true;
        setSelfReady(true);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [onlineTeams.length]);

  // Stabilize the live-ID set so departure detection doesn't re-run every render
  const liveIdKey = onlineTeams.map((t) => t.team_id).sort().join(",");
  const currentLiveIds = useMemo(
    () => new Set(onlineTeams.map((t) => t.team_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [liveIdKey],
  );

  // Append newly joined teams (preserves existing positions)
  for (const t of onlineTeams) {
    if (!orderRef.current.includes(t.team_id)) {
      orderRef.current.push(t.team_id);
    }
  }
  // Add self after others have been inserted
  if (selfReady && !orderRef.current.includes(myTeamId)) {
    orderRef.current.push(myTeamId);
  }

  // A departing avatar MUST stay mounted through its whole exit animation. If we
  // dropped it from the render the instant presence reports it gone, React would
  // unmount it, then a follow-up state update would remount a fresh copy that
  // replays the slide-IN entrance — the "pop to the right, then drift back"
  // glitch. So `orderRef` keeps the id until a timer removes it, and `exiting` is
  // derived live from presence (below) with no one-frame gap that can unmount it.
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  // Detect departures (and re-arrivals) and drive the removal timers.
  const prevLiveRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // Came back before the timer fired (presence flicker) — cancel the removal.
    for (const id of currentLiveIds) {
      const pending = exitTimers.current.get(id);
      if (pending) {
        clearTimeout(pending);
        exitTimers.current.delete(id);
      }
    }

    const departed: string[] = [];
    for (const id of prevLiveRef.current) {
      if (!currentLiveIds.has(id) && id !== myTeamId) departed.push(id);
    }
    prevLiveRef.current = new Set(currentLiveIds);

    // Reclaim each departed slot only after its exit animation has finished.
    for (const id of departed) {
      if (exitTimers.current.has(id)) clearTimeout(exitTimers.current.get(id)!);
      exitTimers.current.set(
        id,
        setTimeout(() => {
          orderRef.current = orderRef.current.filter((oid) => oid !== id);
          exitTimers.current.delete(id);
          forceRender(); // mutating the ref alone won't re-render
        }, EXIT_MS + 50), // small buffer past the animation
      );
    }
  }, [currentLiveIds, myTeamId]);

  // Clean up timers on unmount
  useEffect(() => {
    const timers = exitTimers.current;
    return () => { for (const t of timers.values()) clearTimeout(t); };
  }, []);

  // Everything still tracked, in join order. Departed avatars linger here until
  // their timer fires, so they animate out in place and never remount.
  const displayOrder = orderRef.current;

  const onlineMap = new Map(onlineTeams.map((t) => [t.team_id, t]));
  const avatars: AvatarEntry[] = displayOrder.slice(0, MAX_VISIBLE).map((id) => {
    if (id === myTeamId) {
      return {
        team_id: myTeamId,
        team_name: myTeamName,
        tricode: myTricode ?? "",
        logo_key: myLogoKey,
      };
    }
    const t = onlineMap.get(id);
    return {
      team_id: id,
      team_name: t?.team_name ?? "",
      tricode: t?.tricode ?? "",
      logo_key: teamLogoMap?.[id] ?? null,
      exiting: !currentLiveIds.has(id),
    };
  });

  const totalOnline = onlineTeams.length + 1;
  const hasOverflow = totalOnline > MAX_VISIBLE;

  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.container}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${totalOnline} teams online. Tap to see who's here`}
    >
      {avatars.map((avatar, index) => (
        <AvatarSlot
          key={avatar.team_id}
          logoKey={avatar.logo_key}
          teamName={avatar.team_name}
          tricode={avatar.tricode}
          index={index}
          exiting={avatar.exiting}
          successColor={c.success}
        />
      ))}
      {hasOverflow && (
        <Animated.View
          entering={SlideInRight.delay(avatars.length * 60).duration(200)}
          layout={LinearTransition.duration(SHIFT_MS)}
          style={[
            styles.overflowBadge,
            {
              marginLeft: OVERLAP,
              backgroundColor: c.cardAlt,
            },
          ]}
        >
          <Animated.Text style={[styles.overflowText, { color: c.text }]}>
            +{totalOnline - MAX_VISIBLE}
          </Animated.Text>
        </Animated.View>
      )}
    </TouchableOpacity>
  );
}

/** Individual avatar that slides in from the right with a staggered delay */
function AvatarSlot({
  logoKey,
  teamName,
  tricode,
  index,
  exiting,
  successColor,
}: {
  logoKey: string | null | undefined;
  teamName: string;
  tricode: string;
  index: number;
  exiting?: boolean;
  successColor: string;
}) {
  const mountIndex = useRef(index);
  const translateX = useSharedValue(ENTRANCE_OFFSET);
  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);

  // Slide-in only on initial mount — ignore later index changes so
  // remaining avatars don't replay the entrance animation when others leave.
  useEffect(() => {
    translateX.value = withDelay(
      mountIndex.current * 60,
      withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }),
    );
  }, [translateX]);

  // When marked as exiting: slide straight down while fading out, over the full
  // EXIT_MS so it never blips. The avatar isn't removed until this completes. If
  // presence flickers and the team returns first, snap back to resting position.
  useEffect(() => {
    if (exiting) {
      translateY.value = withTiming(EXIT_DROP_Y, {
        duration: EXIT_MS,
        easing: Easing.in(Easing.quad),
      });
      opacity.value = withTiming(0, { duration: EXIT_MS });
    } else {
      translateY.value = withTiming(0, { duration: 200 });
      opacity.value = withTiming(1, { duration: 200 });
    }
  }, [exiting, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      layout={LinearTransition.duration(SHIFT_MS)}
      // Uniform overlap on EVERY slot (the container's paddingLeft cancels the
      // first one's negative margin). Keeping marginLeft constant means removing
      // the leftmost avatar is a pure reflow — no marginLeft change to fight the
      // layout transition — so the remaining avatars slide over smoothly instead
      // of the new first avatar jumping.
      style={{ marginLeft: OVERLAP }}
    >
      <Animated.View style={[styles.avatarWrapper, animatedStyle]}>
        <View style={[styles.onlineRing, { borderColor: successColor }]}>
          <TeamLogo
            logoKey={logoKey}
            teamName={teamName}
            tricode={tricode}
            size="small"
          />
        </View>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    overflow: "visible",
    marginRight: s(4),
    // Cancels the first avatar's uniform negative marginLeft so the cluster
    // sits in the same place while every slot keeps an identical margin.
    paddingLeft: -OVERLAP,
  },
  avatarWrapper: {
    borderRadius: AVATAR_SIZE / 2,
    zIndex: 10, // later items stack behind earlier ones via marginLeft overlap
  },
  onlineRing: {
    borderWidth: 1.5,
    borderRadius: AVATAR_SIZE / 2,
    overflow: "hidden",
  },
  overflowBadge: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  overflowText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(10),
    letterSpacing: 0.6,
  },
});
