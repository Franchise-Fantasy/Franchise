import { Colors } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useDraftTimer } from "@/hooks/useDraftTimer";
import { supabase } from "@/lib/supabase";
import { DraftState, Pick } from "@/types/draft";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ms, s } from "@/utils/scale";
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { ThemedText } from "../ui/ThemedText";
import { ThemedView } from "../ui/ThemedView";

export interface PresenceTeam {
  teamId: string;
  teamName: string;
  tricode: string;
  logoKey: string | null;
}

interface DraftOrderProps {
  draftId: string;
  teamId: string;
  teamName: string;
  tricode: string;
  logoKey: string | null;
  isCommissioner: boolean;
  autopickPending?: boolean;
  onCurrentPickChange: (
    pick: { id: string; current_team_id: string } | null,
  ) => void;
  onPresenceChange?: (teams: PresenceTeam[]) => void;
}

export function DraftOrder({
  draftId,
  teamId,
  teamName,
  tricode,
  logoKey,
  isCommissioner,
  autopickPending,
  onCurrentPickChange,
  onPresenceChange,
}: DraftOrderProps) {
  const colorScheme = useColorScheme() ?? "light";
  const colors = Colors[colorScheme];
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const queryClient = useQueryClient();
  const [flashingPickId, setFlashingPickId] = useState<string | null>(null);
  const scrollTarget = useSharedValue(0);
  const flashOpacity = useSharedValue(0);

  // NEW: Fetch the main draft state for the timer
  const { data: draftState, isLoading: isLoadingDraftState } = useQuery({
    queryKey: queryKeys.draftState(draftId),
    queryFn: async (): Promise<DraftState> => {
      const { data, error } = await supabase
        .from("drafts")
        .select("*")
        .eq("id", draftId)
        .single();
      if (error) throw error;
      return data as unknown as DraftState;
    },
  });

  const [currentPickTimestamp, setCurrentPickTimestamp] = useState<
    string | undefined
  >(draftState?.current_pick_timestamp);
  const [timeUntilDraft, setTimeUntilDraft] = useState<string | null>(null);
  const startDraftCalledRef = useRef(false);

  // update this whenever draftState changes
  useEffect(() => {
    if (draftState?.current_pick_timestamp) {
      setCurrentPickTimestamp(draftState.current_pick_timestamp);
    }
  }, [draftState?.current_pick_timestamp, draftState?.current_pick_number]);

  // Countdown to draft start; triggers in_progress transition when it hits zero
  useEffect(() => {
    if (draftState?.status !== "pending" || !draftState?.draft_date) {
      setTimeUntilDraft(null);
      return;
    }

    const tick = async () => {
      const remaining = new Date(draftState.draft_date!).getTime() - Date.now();
      if (remaining <= 0) {
        setTimeUntilDraft(null);
        if (startDraftCalledRef.current) return;
        // Only the commissioner triggers the start-draft edge function;
        // other users will see the status change via the real-time subscription
        if (isCommissioner) {
          startDraftCalledRef.current = true;
          // Refresh session to ensure JWT hasn't expired while waiting
          await supabase.auth.refreshSession();
          await supabase.functions.invoke("start-draft", {
            body: { draft_id: draftId },
          });
          queryClient.invalidateQueries({ queryKey: queryKeys.draftState(draftId) });
        }
      } else {
        const totalSeconds = Math.floor(remaining / 1000);
        const mins = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
        const secs = String(totalSeconds % 60).padStart(2, "0");
        setTimeUntilDraft(`${mins}:${secs}`);
      }
    };

    tick();
    const interval = setInterval(tick, 1000);
    return () => {
      clearInterval(interval);
      startDraftCalledRef.current = false;
    };
  }, [draftState?.status, draftState?.draft_date, draftId, isCommissioner]);

  // NEW: Use the timer hook with the fetched draft state
  const countdown = useDraftTimer(currentPickTimestamp || draftState?.current_pick_timestamp, draftState?.time_limit);

  // Flash overlay style driven by Reanimated on the UI thread
  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));

  const flashPick = useCallback((pickId: string) => {
    setFlashingPickId(pickId);
    flashOpacity.value = withSequence(
      withTiming(1, { duration: 500 }),
      withTiming(0, { duration: 1500 }, (finished) => {
        if (finished) runOnJS(setFlashingPickId)(null);
      }),
    );
  }, []);

  // Spring-driven scroll: drives the scroll position frame-by-frame on the UI thread
  useAnimatedReaction(
    () => scrollTarget.value,
    (val) => {
      scrollTo(scrollRef, val, 0, false);
    },
  );

  const {
    data: picks = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.draftOrder(draftId, draftState?.picks_per_round),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("draft_picks")
        .select(
          `
          id,
          pick_number,
          round,
          current_team_id,
          original_team_id,
          player_id,
          slot_number,
          current_team:current_team_id (
            name,
            tricode
          ),
          original_team:original_team_id (
            name,
            tricode
          ),
          player:player_id (
            name,
            position
          )
        `,
        )
        .eq("draft_id", draftId)
        .order("pick_number");

      if (error) throw error;

      const picksPerRound = draftState?.picks_per_round;
      // Map arrays to objects for current_team and player
      return (data ?? []).map((pick: any) => ({
        ...pick,
        // Compute the pick's position within its round (1-based)
        pick_in_round: picksPerRound
          ? ((pick.pick_number - 1) % picksPerRound) + 1
          : pick.slot_number,
        current_team: Array.isArray(pick.current_team)
          ? pick.current_team[0]
          : pick.current_team,
        original_team: Array.isArray(pick.original_team)
          ? pick.original_team[0]
          : pick.original_team,
        player: Array.isArray(pick.player) ? pick.player[0] : pick.player,
      })) as Pick[];
    },
  });

  // Refetch all draft data — used on reconnect / foreground resume
  const catchUpDraft = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: queryKeys.draftState(draftId) });
    queryClient.invalidateQueries({ queryKey: ["draftOrder", draftId] });
    queryClient.invalidateQueries({ queryKey: ["draftQueue"] });
  }, [draftId, queryClient]);

  // Refetch when the app returns to the foreground (WebSocket may have died)
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") catchUpDraft();
    });
    return () => sub.remove();
  }, [catchUpDraft]);

  // Update subscription to trigger flash
  useEffect(() => {
    // Single channel for draft state + picks + presence (saves one connection)
    const draftChannel = supabase
      .channel(`draft_room_${draftId}-${Date.now()}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "drafts",
          filter: `id=eq.${draftId}`,
        },
        (payload) => {
          queryClient.setQueryData(queryKeys.draftState(draftId), payload.new);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_picks",
          filter: `draft_id=eq.${draftId}`,
        },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            if (payload.new.player_id) {
              flashPick(payload.new.id);
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              queryClient.invalidateQueries({
                queryKey: ["draftOrder", draftId],
              });
              queryClient.invalidateQueries({
                queryKey: ["draftQueue"],
              });
              if (payload.new.current_team_id === teamId) {
                queryClient.invalidateQueries({
                  queryKey: ["teamRoster"],
                });
              }
            } else if (payload.old?.current_team_id !== payload.new.current_team_id) {
              queryClient.invalidateQueries({
                queryKey: ["draftOrder", draftId],
              });
            }
          }
        },
      )
      .on("presence", { event: "sync" }, () => {
        const state = draftChannel.presenceState();
        const teams: PresenceTeam[] = [];
        const seen = new Set<string>();
        for (const key of Object.keys(state)) {
          for (const p of state[key]) {
            const tid = (p as any).teamId as string;
            if (tid && !seen.has(tid)) {
              seen.add(tid);
              teams.push({
                teamId: tid,
                teamName: (p as any).teamName,
                tricode: (p as any).tricode ?? '',
                logoKey: (p as any).logoKey ?? null,
              });
            }
          }
        }
        onPresenceChange?.(teams);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED" && teamId) {
          await draftChannel.track({ teamId, teamName, tricode, logoKey });
        }
        if (status === "SUBSCRIBED" || status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          catchUpDraft();
        }
      });

    return () => {
      supabase.removeChannel(draftChannel);
    };
  }, [draftId, queryClient, teamId, teamName, tricode, logoKey, onPresenceChange, catchUpDraft]);

  // Heartbeat: ping draft_team_status so the server knows this team exists.
  // Autopick is purely user-controlled via the AUTO toggle.
  useEffect(() => {
    if (!teamId || !draftId) return;
    const ping = () =>
      supabase.rpc("ping_draft_presence", {
        p_draft_id: draftId,
        p_team_id: teamId,
        p_reset_autopick: false,
      });
    ping();
    const interval = setInterval(ping, 30_000);
    return () => clearInterval(interval);
  }, [draftId, teamId]);

  // Find the index of the first unmade pick
  const currentPickIndex = picks.findIndex((pick) => !pick.player_id);
  const currentPick = picks[currentPickIndex];
  const isMyTurn = currentPick?.current_team_id === teamId;

  // Spring-scroll so the just-picked card is leftmost (current pick visible beside it)
  useEffect(() => {
    if (currentPickIndex < 0) return;
    const showIndex = Math.max(0, currentPickIndex - 1);
    const targetX = Math.max(0, showIndex * (s(120) + s(4) * 2) - 2);
    // Delay scroll so the flash animation is visible before the strip moves
    scrollTarget.value = withDelay(
      800,
      withSpring(targetX, { damping: 120, mass: 4, stiffness: 900 }),
    );
  }, [currentPickIndex]);

  // Notify parent of current pick — only expose when the draft is actually running
  useEffect(() => {
    if (draftState?.status !== "in_progress") {
      onCurrentPickChange(null);
      return;
    }
    const currentPick = picks.find((pick) => !pick.player_id);
    onCurrentPickChange(
      currentPick
        ? {
            id: currentPick.id,
            current_team_id: currentPick.current_team_id,
          }
        : null,
    );
  }, [picks, onCurrentPickChange, draftState?.status]);

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <LogoSpinner />
      </ThemedView>
    );
  }

  if (error) {
    return (
      <ThemedView style={styles.container}>
        <ThemedText>Error loading draft order</ThemedText>
      </ThemedView>
    );
  }

  return (
    <Animated.ScrollView
      ref={scrollRef}
      horizontal
      style={[
        styles.container,
        { borderColor: colors.border, backgroundColor: colors.cardAlt },
      ]}
      showsHorizontalScrollIndicator={false}
      scrollEventThrottle={16}
    >
      {picks.map((pick, index) => {
        const isCurrentOnTheClock = index === currentPickIndex;
        return (
          <View
            key={pick.id}
            accessibilityLabel={`Pick ${pick.round}-${pick.pick_in_round}, ${pick.current_team?.name || 'TBD'}${pick.player_id ? `, ${pick.player?.name}, ${pick.player?.position}` : isCurrentOnTheClock ? ', on the clock' : ''}`}
            style={[
              styles.pickBlock,
              { backgroundColor: colors.card, borderColor: colors.border },
              pick.player_id && {
                backgroundColor: colors.activeCard,
                borderColor: colors.activeBorder,
              },
              isCurrentOnTheClock && [styles.currentPick, { borderColor: colors.warning }],
            ]}
          >
            {pick.id === flashingPickId && (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: "rgba(74, 222, 128, 0.4)" },
                  flashStyle,
                ]}
              />
            )}
            <View style={styles.pickHeader}>
              <ThemedText
                style={[styles.pickNumber, { color: colors.secondaryText }]}
              >
                {pick.round}-{pick.pick_in_round}
              </ThemedText>
              <ThemedText
                style={[styles.teamName, { color: colors.secondaryText }]}
                numberOfLines={1}
              >
                {pick.current_team?.tricode || "TBD"}
                {pick.original_team_id !== pick.current_team_id && (
                  <ThemedText
                    style={[styles.viaBadge, { color: colors.accent }]}
                    accessibilityLabel={`Originally ${pick.original_team?.name}'s pick`}
                  >
                    {" "}via {pick.original_team?.tricode}
                  </ThemedText>
                )}
              </ThemedText>
            </View>
            <View style={styles.pickContent}>
              {pick.player_id ? (
                <ThemedText
                  style={[styles.playerName, { color: colors.activeText }]}
                >
                  {pick.player?.name}
                  {"\n"}
                  <ThemedText
                    style={[
                      styles.playerPosition,
                      { color: colors.secondaryText },
                    ]}
                  >
                    {pick.player?.position}
                  </ThemedText>
                </ThemedText>
              ) : autopickPending && !pick.player_id && pick.current_team_id === teamId ? (
                <ThemedText style={[styles.timerText, { color: colors.success, fontSize: ms(11) }]}>
                  Autopick
                </ThemedText>
              ) : isCurrentOnTheClock && pick.id !== flashingPickId ? (
                timeUntilDraft !== null ? (
                  <ThemedText style={[styles.timerText, { fontSize: ms(11) }]}>
                    Starts {timeUntilDraft}
                  </ThemedText>
                ) : (
                  <ThemedText style={styles.timerText}>{countdown}</ThemedText>
                )
              ) : null}
            </View>
          </View>
        );
      })}
    </Animated.ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    maxHeight: s(100),
    borderBottomWidth: 1,
  },
  timerText: {
    fontSize: ms(15),
    fontWeight: "bold",
    textAlign: "center",
  },
  pickBlock: {
    width: s(120),
    height: s(80),
    padding: s(6),
    margin: s(4),
    borderRadius: 6,
    borderWidth: 1,
    overflow: "hidden",
  },
  pickHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: s(4),
  },
  pickContent: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  pickNumber: {
    fontSize: ms(11),
    fontWeight: "bold",
  },
  teamName: {
    fontSize: ms(11),
    textAlign: "right",
  },
  viaBadge: {
    fontSize: ms(8),
    fontWeight: "700",
    fontStyle: "italic",
  },
  playerName: {
    fontSize: ms(12),
    textAlign: "center",
  },
  playerPosition: {
    fontSize: ms(10),
  },
  currentPick: {
    borderWidth: 2,
  },
});
