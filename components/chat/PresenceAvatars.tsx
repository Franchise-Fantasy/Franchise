import { TeamLogo } from "@/components/team/TeamLogo";
import { Colors } from "@/constants/Colors";
import type { ReadReceipt } from "@/hooks/chat/useReadReceipts";
import { useColorScheme } from "@/hooks/useColorScheme";
import React, { useEffect, useRef, useState } from "react";
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
const EXIT_MS = 350;
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
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

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

  const currentLiveIds = new Set(onlineTeams.map((t) => t.team_id));

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

  // Track teams that just left — keep them in the list briefly so
  // the fade-out plays BEFORE the remaining avatars shift.
  const [exitingIds, setExitingIds] = useState<Set<string>>(new Set());
  const exitTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Detect departures: teams in orderRef that are no longer live and not self
  const prevLiveRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const departed: string[] = [];
    for (const id of prevLiveRef.current) {
      if (!currentLiveIds.has(id) && id !== myTeamId) {
        departed.push(id);
      }
    }
    prevLiveRef.current = new Set(currentLiveIds);

    if (departed.length === 0) return;

    setExitingIds((prev) => {
      const next = new Set(prev);
      for (const id of departed) next.add(id);
      return next;
    });

    // After the exit animation finishes, actually remove them
    for (const id of departed) {
      if (exitTimers.current.has(id)) clearTimeout(exitTimers.current.get(id)!);
      exitTimers.current.set(
        id,
        setTimeout(() => {
          orderRef.current = orderRef.current.filter((oid) => oid !== id);
          setExitingIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          exitTimers.current.delete(id);
        }, EXIT_MS + 50), // small buffer past animation
      );
    }
  }, [currentLiveIds, myTeamId]);

  // Clean up timers on unmount
  useEffect(() => {
    const timers = exitTimers.current;
    return () => { for (const t of timers.values()) clearTimeout(t); };
  }, []);

  // Remove anyone who left AND finished exiting
  const displayOrder = orderRef.current.filter(
    (id) => id === myTeamId || currentLiveIds.has(id) || exitingIds.has(id),
  );

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
      logo_key: t ? (teamLogoMap?.[id] ?? null) : (teamLogoMap?.[id] ?? null),
      exiting: exitingIds.has(id),
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
  const translateX = useSharedValue(60);
  const opacity = useSharedValue(1);
  const translateY = useSharedValue(0);

  useEffect(() => {
    translateX.value = withDelay(
      index * 60,
      withTiming(0, { duration: 200, easing: Easing.out(Easing.quad) }),
    );
  }, [index, translateX]);

  // When marked as exiting, play fade + drop in place
  useEffect(() => {
    if (exiting) {
      opacity.value = withTiming(0, { duration: EXIT_MS });
      translateY.value = withTiming(12, { duration: EXIT_MS });
    }
  }, [exiting, opacity, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      layout={LinearTransition.duration(SHIFT_MS)}
      style={{ marginLeft: index === 0 ? 0 : OVERLAP }}
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
    marginRight: 4,
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
    fontSize: 11,
    fontWeight: "700",
  },
});
