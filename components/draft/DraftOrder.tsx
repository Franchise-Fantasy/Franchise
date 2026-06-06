import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppState, StyleSheet, View } from "react-native";
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

import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { Fonts } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { useToast } from "@/context/ToastProvider";
import { useColors } from "@/hooks/useColors";
import { useDraftTimer } from "@/hooks/useDraftTimer";
import { supabase, uniqueChannelTopic } from "@/lib/supabase";
import { DraftState, Pick } from "@/types/draft";
import { ms, s } from "@/utils/scale";


import { ThemedText } from "../ui/ThemedText";
import { ThemedView } from "../ui/ThemedView";

export interface PresenceTeam {
  teamId: string;
  teamName: string;
  tricode: string;
  logoKey: string | null;
}

// Effective seconds-on-the-clock for a pick, honoring the optional "speed up
// after round N" setting. Mirrors supabase/functions/_shared/draftClock.ts —
// the edge copy lives behind a Deno import path the client can't pull in.
// IMPORTANT: reads `time_limit`, NOT `current_pick_time_limit`. The
// commissioner pick-clock toast below diffs prev/next of this value; resume
// rewrites `current_pick_time_limit` to the restored snapshot, so reading that
// here instead would make every resume falsely toast "pick clock changed".
function effectivePickClock(d: DraftState, pickNumber: number): number {
  if (d.accelerate_after_round == null || d.accelerated_time_limit == null) {
    return d.time_limit;
  }
  const ppr = d.picks_per_round && d.picks_per_round > 0 ? d.picks_per_round : 1;
  const round = Math.ceil(pickNumber / ppr);
  return round > d.accelerate_after_round ? d.accelerated_time_limit : d.time_limit;
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
  const colors = useColors();
  const { showToast } = useToast();
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const queryClient = useQueryClient();
  const [flashingPickId, setFlashingPickId] = useState<string | null>(null);
  const scrollTarget = useSharedValue(0);
  const flashOpacity = useSharedValue(0);
  // A small scale pop on the just-picked card. Keeps the celebration moment
  // tighter than the previous fade-only flash and reads as a stadium light.
  const flashScale = useSharedValue(1);

  // NEW: Fetch the main draft state for the timer
  const { data: draftState } = useQuery({
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

  // Autopick state for every team in the draft. Powers the "AUTOPICK" label
  // shown on each team's pending pick cards so opponents can see who's auto'd
  // out. Realtime-fed from `draft_team_status` (UPDATE listener below).
  const { data: autopickStatuses } = useQuery({
    queryKey: queryKeys.draftAutopickStatuses(draftId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("draft_team_status")
        .select("team_id, autopick_on")
        .eq("draft_id", draftId);
      if (error) throw error;
      return data ?? [];
    },
  });

  const autopickTeamIds = useMemo(() => {
    const set = new Set<string>(
      (autopickStatuses ?? [])
        .filter((s) => s.autopick_on)
        .map((s) => s.team_id),
    );
    // Current user's local toggle is optimistic — let it win over the realtime
    // echo so the user's own card flips instantly instead of waiting ~200ms
    // for the broadcast to round-trip.
    if (autopickPending) set.add(teamId);
    else set.delete(teamId);
    return set;
  }, [autopickStatuses, autopickPending, teamId]);

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
        // Fast-path: any league member present can kick off start-draft once
        // the scheduled time hits. The pg_cron job `auto-start-pending-drafts`
        // is the safety net for the case where nobody is in the room — it
        // fires every minute. Server enforces league membership + draft_date.
        startDraftCalledRef.current = true;
        await supabase.auth.refreshSession();
        await supabase.functions.invoke("start-draft", {
          body: { draft_id: draftId },
        });
        queryClient.invalidateQueries({ queryKey: queryKeys.draftState(draftId) });
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
  }, [draftState?.status, draftState?.draft_date, draftId, queryClient]);

  const isPaused = draftState?.status === "paused";
  // Use the timer hook with the fetched draft state. While paused, freeze it at
  // the snapshotted remaining ms instead of ticking against a stale timestamp.
  const { display: countdown, expired: countdownExpired } = useDraftTimer(
    currentPickTimestamp || draftState?.current_pick_timestamp,
    draftState?.current_pick_time_limit ?? draftState?.time_limit,
    isPaused ? (draftState?.paused_remaining_ms ?? 0) : null,
  );

  // Gold flash overlay — tighter than the prior fade so the celebration
  // reads as a stadium light rather than a toast notification.
  const flashStyle = useAnimatedStyle(() => ({
    opacity: flashOpacity.value,
  }));
  // Scale pop on the just-picked card, also UI-thread driven.
  const flashCardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: flashScale.value }],
  }));

  const flashPick = useCallback((pickId: string) => {
    setFlashingPickId(pickId);
    flashOpacity.value = withSequence(
      withTiming(1, { duration: 220 }),
      withTiming(0, { duration: 900 }, (finished) => {
        if (finished) runOnJS(setFlashingPickId)(null);
      }),
    );
    flashScale.value = withSequence(
      withSpring(1.06, { damping: 8, mass: 0.4, stiffness: 240 }),
      withSpring(1, { damping: 14, mass: 0.6, stiffness: 180 }),
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
            position,
            pro_team
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

  // postgres_changes channel — needs a unique suffix so React remount
  // overlap doesn't collide on `.removeChannel`. Presence is split off
  // onto its own deterministic channel below (presence routing requires
  // every client to share the same channel name).
  useEffect(() => {
    const draftChannel = supabase
      .channel(uniqueChannelTopic(`draft_room_${draftId}`))
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "drafts",
          filter: `id=eq.${draftId}`,
        },
        (payload) => {
          const prev = queryClient.getQueryData<DraftState>(queryKeys.draftState(draftId));
          const next = payload.new as DraftState;
          // Surface a mid-draft pick-clock change so other GMs aren't blindsided
          // by the timer shifting. Fire only when the clock that's LIVE this
          // round actually changed (covers both the base and accelerated clocks,
          // and toggling acceleration), and only on a config-only edit — a pick
          // advance changes current_pick_number, and the natural threshold
          // crossing must not read as a commissioner change. Skip the commish
          // who made it.
          if (
            prev &&
            next.status === "in_progress" &&
            next.current_pick_number === prev.current_pick_number &&
            !isCommissioner
          ) {
            const prevClock = effectivePickClock(prev, prev.current_pick_number);
            const nextClock = effectivePickClock(next, next.current_pick_number);
            if (nextClock !== prevClock) {
              showToast("info", `Commissioner set the pick clock to ${nextClock}s.`);
            }
          }
          queryClient.setQueryData(queryKeys.draftState(draftId), next);
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
              // Don't flash from the realtime event — the flash is fired
              // from the picks-transition useEffect below, which catches
              // both realtime AND optimistic updates and ensures the flash
              // plays before the strip springs to the next pick.
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
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "draft_team_status",
          filter: `draft_id=eq.${draftId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.draftAutopickStatuses(draftId),
          });
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED" || status === "TIMED_OUT" || status === "CHANNEL_ERROR") {
          catchUpDraft();
        }
      });

    return () => {
      supabase.removeChannel(draftChannel);
    };
  }, [draftId, queryClient, teamId, catchUpDraft, showToast, isCommissioner]);

  // Presence channel — DETERMINISTIC name (no Date.now() suffix) because
  // Supabase routes presence by channel name and every client must share
  // the same name to see each other. The postgres_changes uniqueness rule
  // does not apply here. See useReadReceipts for the same pattern.
  useEffect(() => {
    if (!teamId) return;
    const ch = supabase.channel(`draft_presence_${draftId}`, {
      config: { presence: { key: teamId } },
    });

    ch.on("presence", { event: "sync" }, () => {
      const state = ch.presenceState();
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
    });

    ch.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await ch.track({ teamId, teamName, tricode, logoKey });
      }
    });

    return () => {
      supabase.removeChannel(ch);
    };
  }, [draftId, teamId, teamName, tricode, logoKey, onPresenceChange]);

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

  // Watch picks for null→player_id transitions and fire the flash there
  // (rather than from the realtime channel handler). This way the flash
  // plays whenever the user SEES a pick land, regardless of whether the
  // data came from a realtime event, optimistic mutation, or refetch —
  // and it stays in the same animation frame as the strip update so it
  // can run before the scroll spring kicks in.
  const prevPicksRef = useRef<Pick[]>([]);
  useEffect(() => {
    const prev = prevPicksRef.current;
    if (prev.length > 0) {
      for (const pick of picks) {
        const prevPick = prev.find((p) => p.id === pick.id);
        if (prevPick && !prevPick.player_id && pick.player_id) {
          flashPick(pick.id);
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          break;
        }
      }
    }
    prevPicksRef.current = picks;
  }, [picks, flashPick]);

  // Find the index of the first unmade pick
  const currentPickIndex = picks.findIndex((pick) => !pick.player_id);

  // Spring-scroll so the just-picked card is leftmost (current pick visible beside it).
  // After the final pick lands, currentPickIndex is -1 — scroll to the end so
  // the last pick is in view (the completion notice renders below the strip).
  useEffect(() => {
    const showIndex =
      currentPickIndex < 0
        ? Math.max(0, picks.length - 1)
        : Math.max(0, currentPickIndex - 1);
    const targetX = Math.max(0, showIndex * (s(124) + s(4) * 2) - 2);
    // Wait for the gold flash + scale-pop to finish (≈1.12s) before the
    // strip springs to the next pick. Otherwise the strip can shift
    // first and the flash plays on a card the user has already scrolled
    // past — which reads as a delayed afterthought instead of a beat.
    scrollTarget.value = withDelay(
      1200,
      withSpring(targetX, { damping: 120, mass: 4, stiffness: 900 }),
    );
  }, [currentPickIndex, picks.length]);

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
        const isPicked = !!pick.player_id;
        const isFlashing = pick.id === flashingPickId;
        const isTraded = pick.original_team_id !== pick.current_team_id;
        const tricode = pick.current_team?.tricode || "TBD";
        const originalTricode = pick.original_team?.tricode;

        // Surface + foreground colors per state.
        // - on-the-clock: filled with sport primary (NBA turfGreen, WNBA
        //   merlot, NFL navy) w/ ecru type — the broadcast "this team is up"
        //   moment, themed to the league.
        // - picked: card surface, gold rule still visible, faded slightly
        // - default: card surface, gold rule, c.text
        const surfaceColor = isCurrentOnTheClock ? colors.primary : colors.card;
        const borderColor = isCurrentOnTheClock ? colors.gold : colors.border;
        const primaryColor = isCurrentOnTheClock ? colors.onPrimary : colors.text;
        const secondaryColor = isCurrentOnTheClock
          ? "rgba(233, 226, 203, 0.65)"
          : colors.secondaryText;
        const ruleColor = colors.gold;

        return (
          <Animated.View
            key={pick.id}
            accessibilityLabel={`Pick ${pick.round}-${pick.pick_in_round}, ${pick.current_team?.name || 'TBD'}${isPicked ? `, ${pick.player?.name}, ${pick.player?.position}${pick.player?.pro_team ? `, ${pick.player.pro_team}` : ''}` : isCurrentOnTheClock ? ', on the clock' : ''}`}
            style={[
              styles.pickBlock,
              {
                backgroundColor: surfaceColor,
                borderColor,
                borderWidth: isCurrentOnTheClock ? 1.5 : StyleSheet.hairlineWidth,
              },
              isFlashing && flashCardStyle,
            ]}
          >
            {/* Left gold rule — the deck's "01" eyebrow rhythm in miniature.
                On the on-the-clock card it stays gold so the brand hits
                read as one cohesive unit (gold-on-green = "live"). */}
            <View style={[styles.pickAccent, { backgroundColor: ruleColor }]} />

            {isFlashing && (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { backgroundColor: colors.gold, opacity: 0.35 },
                  flashStyle,
                ]}
              />
            )}

            <View style={styles.pickBody}>
              {/* Top row — round.slot label (Alfa Slab) + tricode + via badge.
                  "7.5" reads round-and-pick natively for a snake draft;
                  the old raw pick_number ("50") made it hard to tell what
                  round you were in mid-board. */}
              <View style={styles.pickTop}>
                <ThemedText
                  style={[styles.pickNumber, { color: primaryColor }]}
                >
                  {pick.round}.{pick.pick_in_round}
                </ThemedText>
                <View style={styles.pickTeam}>
                  <ThemedText
                    type="varsity"
                    style={[styles.pickTricode, { color: primaryColor }]}
                    numberOfLines={1}
                  >
                    {tricode}
                  </ThemedText>
                  {isTraded && originalTricode ? (
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.pickVia, { color: secondaryColor }]}
                      numberOfLines={1}
                      accessibilityLabel={`Originally ${pick.original_team?.name}'s pick`}
                    >
                      via {originalTricode}
                    </ThemedText>
                  ) : null}
                </View>
              </View>

              {/* Bottom row — player (when picked), timer (when on the clock),
                  or empty (upcoming). */}
              <View style={styles.pickBottom}>
                {isPicked ? (
                  <>
                    <ThemedText
                      style={[styles.playerName, { color: primaryColor }]}
                      numberOfLines={1}
                    >
                      {pick.player?.name}
                    </ThemedText>
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.playerPosition, { color: ruleColor }]}
                      accessibilityLabel={`${pick.player?.position}${pick.player?.pro_team ? `, ${pick.player.pro_team}` : ''}`}
                    >
                      {pick.player?.position}
                      {pick.player?.pro_team ? ` · ${pick.player.pro_team}` : ''}
                    </ThemedText>
                  </>
                ) : autopickTeamIds.has(pick.current_team_id) ? (
                  <ThemedText
                    type="varsity"
                    style={[styles.autopickText, { color: colors.gold }]}
                  >
                    Autopick
                  </ThemedText>
                ) : isCurrentOnTheClock && !isFlashing ? (
                  timeUntilDraft !== null ? (
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.startsText, { color: secondaryColor }]}
                    >
                      Starts {timeUntilDraft}
                    </ThemedText>
                  ) : isPaused ? (
                    <ThemedText
                      type="varsity"
                      style={[styles.pausedText, { color: colors.gold }]}
                      accessibilityLabel="Draft paused"
                    >
                      Paused
                    </ThemedText>
                  ) : draftState?.status !== "in_progress" ? (
                    // Pending but past draft_date — server-side cron is on its
                    // way to flip status. Render nothing rather than a stale
                    // 00:00 / "Pick is in".
                    null
                  ) : countdownExpired ? (
                    <ThemedText
                      type="varsity"
                      style={[styles.pickIsInText, { color: colors.gold }]}
                      accessibilityLabel="Pick is in"
                    >
                      Pick is in
                    </ThemedText>
                  ) : (
                    <ThemedText style={[styles.timerText, { color: primaryColor }]}>
                      {countdown}
                    </ThemedText>
                  )
                ) : null}
              </View>
            </View>
          </Animated.View>
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
  pickBlock: {
    width: s(124),
    height: s(82),
    margin: s(4),
    borderRadius: 8,
    overflow: "hidden",
    flexDirection: "row",
  },
  // Left gold rule — vertical accent that anchors the card.
  pickAccent: {
    width: 3,
    height: "100%",
  },
  pickBody: {
    flex: 1,
    paddingHorizontal: s(8),
    paddingVertical: s(6),
    justifyContent: "space-between",
  },
  // Top row — Alfa Slab pick number + varsity tricode (right-aligned)
  pickTop: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: s(6),
  },
  pickNumber: {
    fontFamily: Fonts.display,
    fontSize: ms(20),
    lineHeight: ms(22),
    letterSpacing: -0.3,
  },
  pickTeam: {
    alignItems: "flex-end",
    flexShrink: 1,
    minWidth: 0,
    paddingTop: s(2),
  },
  pickTricode: {
    fontSize: ms(11),
    letterSpacing: 1.2,
    textAlign: "right",
  },
  pickVia: {
    fontSize: ms(8),
    letterSpacing: 1.0,
    textAlign: "right",
    marginTop: s(1),
  },
  // Bottom row — player or timer; uses available space below the top row
  pickBottom: {
    alignItems: "flex-start",
    minHeight: s(20),
    justifyContent: "flex-end",
  },
  playerName: {
    fontFamily: Fonts.bodyBold,
    fontSize: ms(12),
    lineHeight: ms(14),
  },
  playerPosition: {
    fontSize: ms(8),
    letterSpacing: 1.2,
    marginTop: s(1),
  },
  // Timer + state labels
  timerText: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    letterSpacing: 0.5,
  },
  autopickText: {
    fontSize: ms(11),
    letterSpacing: 1.2,
  },
  pickIsInText: {
    fontSize: ms(11),
    letterSpacing: 1.2,
  },
  pausedText: {
    fontSize: ms(11),
    letterSpacing: 1.2,
  },
  startsText: {
    fontSize: ms(10),
    letterSpacing: 1.2,
  },
});
