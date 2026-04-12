import { capture } from "@/lib/posthog";
import { ThemedText } from "@/components/ui/ThemedText";
import { PlayerGameLog, PlayerGameLogHeader } from "@/components/player/PlayerGameLog";
import { NewsCard } from "@/components/player/NewsCard";
import { PlayerHistory } from "@/components/player/PlayerHistory";
import { PlayerInsightsCard } from "@/components/player/PlayerInsights";
import { PreviousSeasons } from "@/components/player/PreviousSeasons";
import { SeasonAverages } from "@/components/player/SeasonAverages";
import { HorizontalPager } from "@/components/ui/HorizontalPager";
import { Colors } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { CURRENT_NBA_SEASON } from "@/constants/LeagueDefaults";
import { useToast } from "@/context/ToastProvider";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { usePlayerGameLog } from "@/hooks/usePlayerGameLog";
import { usePlayerNews } from "@/hooks/usePlayerNews";
import { usePlayerRankings } from "@/hooks/usePlayerRankings";
import { usePlayerHistoricalStats } from "@/hooks/usePlayerHistoricalStats";
import { useWatchlist } from "@/hooks/useWatchlist";
import { sendNotification } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { toDateStr } from "@/utils/dates";
import { isEligibleForSlot } from "@/utils/rosterSlots";
import { calculateAvgFantasyPoints } from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { addFreeAgent } from "@/utils/addFreeAgent";
import { assertNoIllegalIR } from "@/utils/illegalIR";
import { GameTimeMap, hasAnyGameStarted, isGameStarted, useTodayGameTimes } from "@/utils/gameStarted";
import { isActiveSlot } from "@/utils/resolveSlot";
import { ms, s } from '@/utils/scale';
import { getInjuryBadge } from "@/utils/injuryBadge";
import {
  formatGameInfo,
  liveToGameLog,
  useLivePlayerStats,
} from "@/utils/nbaLive";
import { isOnline } from "@/utils/network";
import { getPlayerHeadshotUrl, getTeamLogoUrl } from "@/utils/playerHeadshot";
import { calculateAge } from "@/utils/rosterAge";
import { isTaxiEligible } from "@/utils/taxiEligibility";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { center } from "@shopify/react-native-skia";
import { LogoSpinner } from "@/components/ui/LogoSpinner";

interface PlayerDetailModalProps {
  player: PlayerSeasonStats | null;
  leagueId: string;
  teamId?: string;
  onClose: () => void;
  onRosterChange?: () => void;
  startInDropPicker?: boolean;
  /** When true, opens directly into the drop picker for IR activation */
  startInActivateFromIR?: boolean;
  /** When provided, the drop picker calls this instead of doing an instant add-and-drop */
  onDropForClaim?: (dropPlayer: PlayerSeasonStats) => void;
  /** When provided, the Add/Claim button calls this instead of doing an instant add */
  onClaimPlayer?: () => void;
  /** Pre-fetched owner team name from parent — avoids flash while ownership query loads */
  ownerTeamName?: string;
  /** Lock mode passed from FreeAgentList for add-drop game-time checks */
  playerLockType?: "daily" | "individual";
  /** Today's game times passed from FreeAgentList */
  gameTimeMap?: GameTimeMap;
}

export function PlayerDetailModal({
  player,
  leagueId,
  teamId,
  onClose,
  onRosterChange,
  startInDropPicker,
  startInActivateFromIR,
  onDropForClaim,
  onClaimPlayer,
  ownerTeamName,
  playerLockType,
  gameTimeMap: parentGameTimeMap,
}: PlayerDetailModalProps) {
  const router = useRouter();
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { isWatchlisted, toggleWatchlist } = useWatchlist();

  const [isProcessing, setIsProcessing] = useState(false);
  const [showDropPicker, setShowDropPicker] = useState(false);
  const [activateFromIR, setActivateFromIR] = useState(false);
  const [insightsWindow, setInsightsWindow] = useState(10);

  const [tradeBlockPromptVisible, setTradeBlockPromptVisible] = useState(false);
  const [tradeBlockNoteInput, setTradeBlockNoteInput] = useState("");

  const [gameLogExpanded, setGameLogExpanded] = useState(false);

  // Local in-modal toast — the global ToastProvider renders beneath the Modal
  // on native, so confirmations triggered inside the modal (e.g. watchlist
  // toggle) get hidden. This inline pill sits inside the sheet itself.
  const [inlineToast, setInlineToast] = useState<string | null>(null);
  const inlineToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showInlineToast = (message: string) => {
    if (inlineToastTimer.current) clearTimeout(inlineToastTimer.current);
    setInlineToast(message);
    inlineToastTimer.current = setTimeout(() => setInlineToast(null), 1800);
  };
  useEffect(() => () => {
    if (inlineToastTimer.current) clearTimeout(inlineToastTimer.current);
  }, []);

  useEffect(() => {
    if (player && startInDropPicker) setShowDropPicker(true);
    if (player && startInActivateFromIR) {
      setActivateFromIR(true);
      setShowDropPicker(true);
    }
    setGameLogExpanded(false);
    if (player) {
      capture('player_detail_viewed', { player_name: player.name, position: player.position });
    }
  }, [player, startInDropPicker, startInActivateFromIR]);
  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { data: gameLog, isLoading: isLoadingGameLog } = usePlayerGameLog(
    player?.player_id ?? "",
  );
  const { data: historicalStats } = usePlayerHistoricalStats(
    player?.player_id ?? null,
  );
  const { data: playerNews, isLoading: isLoadingNews } = usePlayerNews(player?.player_id);

  // Fetch scoring type for insights branching
  const { data: leagueScoringType } = useQuery({
    queryKey: queryKeys.leagueScoringType(leagueId),
    queryFn: async () => {
      const { data } = await supabase
        .from("leagues")
        .select("scoring_type")
        .eq("id", leagueId)
        .single();
      return data?.scoring_type as string | null;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });
  const isCategories = leagueScoringType === "h2h_categories";
  const rankings = usePlayerRankings(player?.player_id, player?.position, scoringWeights);

  // Check if this player is on the user's team and get their current slot
  const { data: ownershipInfo } = useQuery({
    queryKey: queryKeys.playerOwnership(leagueId, teamId!, player?.player_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("league_players")
        .select("id, roster_slot, on_trade_block, trade_block_note")
        .eq("league_id", leagueId)
        .eq("team_id", teamId!)
        .eq("player_id", player!.player_id)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0)
        return { isOnMyTeam: false, rosterSlot: null, onTradeBlock: false };
      return {
        isOnMyTeam: true,
        rosterSlot: data[0].roster_slot as string | null,
        onTradeBlock: data[0].on_trade_block as boolean,
        tradeBlockNote: (data[0].trade_block_note as string | null) ?? "",
      };
    },
    enabled: !!player && !!teamId && !!leagueId,
  });

  const isOnMyTeam = ownershipInfo?.isOnMyTeam ?? false;
  const playerRosterSlot = ownershipInfo?.rosterSlot ?? null;
  const isOnTradeBlock = ownershipInfo?.onTradeBlock ?? false;

  // Check if player is owned by another team — use prop from parent if available, otherwise query
  const { data: queriedOwnerInfo, isLoading: ownershipLoading } = useQuery({
    queryKey: queryKeys.playerLeagueOwnership(leagueId, player?.player_id),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("league_players")
        .select("team_id")
        .eq("league_id", leagueId)
        .eq("player_id", player!.player_id)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return null;

      const ownerTeamId = data[0].team_id as string;
      const { data: team } = await supabase
        .from("teams")
        .select("name")
        .eq("id", ownerTeamId)
        .single();

      return { teamId: ownerTeamId, teamName: (team?.name as string) ?? "Unknown" };
    },
    enabled: !!player && !!leagueId && !isOnMyTeam,
  });

  // Use prop if available, otherwise fall back to query result
  const resolvedOwnerName = ownerTeamName ?? queriedOwnerInfo?.teamName ?? null;
  const isOwnedByOther = !isOnMyTeam && !!resolvedOwnerName;
  const ownerTeamId = isOnMyTeam ? teamId : queriedOwnerInfo?.teamId ?? null;
  const isFreeAgent =
    ownerTeamName !== undefined
      ? !isOnMyTeam && !resolvedOwnerName
      : !isOnMyTeam && !ownershipLoading && !queriedOwnerInfo;

  // Get roster counts, max size, IR capacity, and waiver settings
  const { data: rosterInfo } = useQuery({
    queryKey: queryKeys.rosterInfo(leagueId, teamId!),
    queryFn: async () => {
      const [
        allPlayersRes,
        irPlayersRes,
        taxiPlayersRes,
        leagueRes,
        irConfigRes,
        taxiConfigRes,
      ] = await Promise.all([
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!)
          .eq("roster_slot", "IR"),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!)
          .eq("roster_slot", "TAXI"),
        supabase
          .from("leagues")
          .select(
            "roster_size, waiver_type, waiver_period_days, taxi_slots, taxi_max_experience, season, offseason_step",
          )
          .eq("id", leagueId)
          .single(),
        supabase
          .from("league_roster_config")
          .select("slot_count")
          .eq("league_id", leagueId)
          .eq("position", "IR")
          .maybeSingle(),
        supabase
          .from("league_roster_config")
          .select("slot_count")
          .eq("league_id", leagueId)
          .eq("position", "TAXI")
          .maybeSingle(),
      ]);

      if (allPlayersRes.error) throw allPlayersRes.error;
      if (irPlayersRes.error) throw irPlayersRes.error;
      if (leagueRes.error) throw leagueRes.error;

      const irCount = irPlayersRes.count ?? 0;
      const taxiCount = taxiPlayersRes.count ?? 0;
      const activeCount = (allPlayersRes.count ?? 0) - irCount - taxiCount;
      return {
        activeCount,
        irCount,
        irSlotCount: irConfigRes.data?.slot_count ?? 0,
        taxiCount,
        taxiSlotCount: taxiConfigRes.data?.slot_count ?? 0,
        taxiMaxExperience: leagueRes.data?.taxi_max_experience as number | null,
        season: leagueRes.data?.season as string,
        maxSize: leagueRes.data?.roster_size ?? 13,
        waiverType: (leagueRes.data?.waiver_type ?? "none") as
          | "standard"
          | "faab"
          | "none",
        waiverPeriodDays: leagueRes.data?.waiver_period_days ?? 2,
        offseasonStep: leagueRes.data?.offseason_step as string | null,
      };
    },
    enabled: !!teamId && !!leagueId,
  });

  // Fetch roster players for the drop picker (exclude IR — dropping them doesn't free active spots)
  const { data: rosterPlayers } = useQuery<PlayerSeasonStats[]>({
    queryKey: queryKeys.teamRoster(teamId!),
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from("league_players")
        .select("player_id, roster_slot")
        .eq("team_id", teamId!)
        .eq("league_id", leagueId);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const activePlayerIds = leaguePlayers
        .filter((lp) => lp.roster_slot !== "IR")
        .map((lp) => lp.player_id);

      if (activePlayerIds.length === 0) return [];

      const { data, error } = await supabase
        .from("player_season_stats")
        .select("*")
        .in("player_id", activePlayerIds);

      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    enabled: !!teamId && !!leagueId && showDropPicker,
  });

  // Check for active draft
  const { data: hasActiveDraft } = useQuery({
    queryKey: queryKeys.hasActiveDraft(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("drafts")
        .select("id")
        .eq("league_id", leagueId)
        .neq("status", "complete")
        .limit(1);

      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 30_000,
  });

  // Check if weekly acquisition limit is reached
  // Returns the count of adds this week (same shape as FreeAgentList's query
  // which shares the cache key ['weeklyAdds', leagueId, teamId])
  const { data: weeklyAddsCount } = useQuery({
    queryKey: queryKeys.weeklyAdds(leagueId, teamId!),
    queryFn: async () => {
      const now = new Date();
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayOffset);
      const weekStart = monday.toISOString().split("T")[0];

      const { count, error } = await supabase
        .from("league_transactions")
        .select("id, league_transaction_items!inner(team_to_id)", {
          count: "exact",
          head: true,
        })
        .eq("league_id", leagueId)
        .eq("team_id", teamId!)
        .eq("type", "waiver")
        .not("league_transaction_items.team_to_id", "is", null)
        .gte("created_at", weekStart + "T00:00:00");
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!leagueId && !!teamId && !isOnMyTeam,
  });

  const { data: weeklyAcqLimit } = useQuery({
    queryKey: queryKeys.weeklyAcqLimit(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leagues")
        .select("weekly_acquisition_limit")
        .eq("id", leagueId)
        .single();
      if (error) throw error;
      return data?.weekly_acquisition_limit as number | null;
    },
    enabled: !!leagueId && !isOnMyTeam,
  });

  const addsExhausted =
    weeklyAcqLimit != null && (weeklyAddsCount ?? 0) >= weeklyAcqLimit;

  // How many games has this player's team played so far this season?
  const { data: teamGamesPlayed } = useQuery({
    queryKey: queryKeys.teamGamesPlayed(player?.nba_team ?? ''),
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { count, error } = await supabase
        .from("nba_schedule")
        .select("id", { count: "exact", head: true })
        .eq("season", CURRENT_NBA_SEASON)
        .or(`home_team.eq.${player!.nba_team},away_team.eq.${player!.nba_team}`)
        .not("game_id", "like", "001%")
        .lte("game_date", today);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!player,
  });

  // Game lock detection
  const gameTimeMap = useTodayGameTimes(!!player);
  const playerGameStarted = player
    ? isGameStarted(player.nba_team, gameTimeMap)
    : false;

  // Live stats for today's game
  const playerIdArr = player ? [player.player_id] : [];
  const liveMap = useLivePlayerStats(playerIdArr, !!player);
  const liveStats = player ? (liveMap.get(player.player_id) ?? null) : null;

  // Next 3 upcoming games
  const { data: upcomingGames } = useQuery({
    queryKey: queryKeys.upcomingGames(player?.nba_team ?? ''),
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("nba_schedule")
        .select("game_date, home_team, away_team, game_time_utc")
        .eq("season", CURRENT_NBA_SEASON)
        .or(`home_team.eq.${player!.nba_team},away_team.eq.${player!.nba_team}`)
        .not("game_id", "like", "001%")
        .gte("game_date", today)
        .order("game_date", { ascending: true })
        .limit(4);
      if (error) throw error;
      return (data ?? []).map((g) => {
        const isHome = g.home_team === player!.nba_team;
        return {
          game_date: g.game_date as string,
          opponent: isHome ? g.away_team : g.home_team,
          prefix: isHome ? "vs" : "@",
          game_time_utc: g.game_time_utc as string | null,
        };
      });
    },
    enabled: !!player?.nba_team,
    staleTime: 1000 * 60 * 60,
  });

  const handleClose = () => {
    setShowDropPicker(false);
    setActivateFromIR(false);
    onClose();
  };

  const scrollRef = useRef<ScrollView>(null);
  // Refs for the game-log header/body horizontal scroll views so we can
  // keep them in sync while the sticky header is pinned.
  const gameLogHeaderScrollRef = useRef<ScrollView>(null);
  const gameLogBodyScrollRef = useRef<ScrollView>(null);
  const handleGameLogBodyScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    gameLogHeaderScrollRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false });
  };

  // Swipe-to-dismiss gesture
  const translateY = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef<() => void>(handleClose);
  dismissRef.current = showDropPicker
    ? (startInDropPicker || startInActivateFromIR)
      ? handleClose
      : () => { setShowDropPicker(false); setActivateFromIR(false); }
    : handleClose;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(translateY, {
            toValue: 500,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            dismissRef.current();
            translateY.setValue(0);
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    }),
  ).current;

  // Reset translate when switching between sub-modals
  useEffect(() => {
    translateY.setValue(0);
  }, [showDropPicker]);

  // Check if this free agent player is on waivers
  const { data: playerOnWaivers } = useQuery({
    queryKey: queryKeys.playerOnWaivers(leagueId, player?.player_id),
    queryFn: async () => {
      const { data } = await supabase
        .from("league_waivers")
        .select("id")
        .eq("league_id", leagueId)
        .eq("player_id", player!.player_id)
        .gt("on_waivers_until", new Date().toISOString())
        .limit(1);
      return (data?.length ?? 0) > 0;
    },
    enabled:
      !!player &&
      !!leagueId &&
      !isOnMyTeam &&
      rosterInfo?.waiverType === "standard",
  });

  if (!player) return null;

  const waiverType = rosterInfo?.waiverType ?? "none";
  const needsWaiverClaim =
    waiverType === "faab" ||
    (waiverType === "standard" && (playerOnWaivers ?? false));

  const rosterIsFull = rosterInfo
    ? rosterInfo.activeCount >= rosterInfo.maxSize
    : false;

  const canMoveToIR = rosterInfo
    ? (player.status === "OUT" || player.status === "SUSP") &&
      rosterInfo.irSlotCount > 0 &&
      rosterInfo.irCount < rosterInfo.irSlotCount
    : false;

  const avgFpts = scoringWeights
    ? calculateAvgFantasyPoints(player, scoringWeights)
    : null;

  const invalidateRosterQueries = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.allPlayers(leagueId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.leagueOwnership(leagueId) });
    queryClient.invalidateQueries({ queryKey: queryKeys.teamRoster(teamId!) });
    queryClient.invalidateQueries({
      queryKey: queryKeys.rosterInfo(leagueId, teamId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.freeAgentRosterInfo(leagueId, teamId!),
    });
    queryClient.invalidateQueries({
      queryKey: ["playerOwnership", leagueId, teamId],
    });
    // Invalidate matchup views so dropped/added players are reflected immediately
    queryClient.invalidateQueries({ queryKey: ["weekMatchup"] });
    queryClient.invalidateQueries({ queryKey: ["matchupById"] });
    queryClient.invalidateQueries({
      queryKey: queryKeys.leagueRosterStats(leagueId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.weeklyAdds(leagueId, teamId!),
    });
    onRosterChange?.();
  };

  // Submit a waiver claim natively (used when no external callback is provided)
  const submitWaiverClaim = async (dropPlayerId?: string) => {
    if (!teamId || !player) return;
    const { data: wp } = await supabase
      .from("waiver_priority")
      .select("priority")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .single();

    const { error } = await supabase.from("waiver_claims").insert({
      league_id: leagueId,
      team_id: teamId,
      player_id: player.player_id,
      drop_player_id: dropPlayerId ?? null,
      bid_amount: 0,
      priority: wp?.priority ?? 99,
    });
    if (error) throw error;

    queryClient.invalidateQueries({
      queryKey: queryKeys.pendingClaims(leagueId, teamId!),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.faabRemaining(leagueId, teamId!),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.waiverOrder(leagueId) });
    capture('waiver_claim_submitted', { player_name: player.name });

    Alert.alert(
      "Claim Submitted",
      `Waiver claim for ${player.name} submitted.`,
    );
  };

  const handleAddPlayer = async () => {
    if (!teamId || !player) return;
    if (!(await isOnline())) {
      showToast("error", "No internet connection");
      return;
    }

    // IR lockout preflight — block before opening the drop picker or starting
    // any other flow, so users aren't led into a modal they'll be rejected from.
    try {
      await assertNoIllegalIR(leagueId, teamId);
    } catch (err: any) {
      Alert.alert("Roster locked", err.message ?? "Roster is locked.");
      return;
    }

    // If this player requires a waiver claim, delegate to the claim callback
    // or handle natively if no callback provided
    if (needsWaiverClaim) {
      if (rosterIsFull) {
        setShowDropPicker(true);
        return;
      }
      if (onClaimPlayer) {
        onClaimPlayer();
        return;
      }
      // No callback — handle the claim natively
      setIsProcessing(true);
      try {
        await submitWaiverClaim();
        onClose();
      } catch (err: any) {
        Alert.alert("Error", err.message ?? "Failed to submit claim");
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (rosterIsFull) {
      setShowDropPicker(true);
      return;
    }

    setIsProcessing(true);
    try {
      // Re-check roster limit before adding
      const [allRes, irRes, taxiRes, leagueRes] = await Promise.all([
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!)
          .eq("roster_slot", "IR"),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId!)
          .eq("roster_slot", "TAXI"),
        supabase
          .from("leagues")
          .select("roster_size")
          .eq("id", leagueId)
          .single(),
      ]);
      const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0) - (taxiRes.count ?? 0);
      const maxSize = leagueRes.data?.roster_size ?? 13;
      if (activeCount >= maxSize) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.rosterInfo(leagueId, teamId!),
        });
        setShowDropPicker(true);
        setIsProcessing(false);
        return;
      }

      const { deferred } = await addFreeAgent({
        leagueId,
        teamId: teamId!,
        player: {
          player_id: player.player_id,
          name: player.name,
          position: player.position,
          nba_team: player.nba_team ?? "",
        },
        playerLockType: playerLockType ?? null,
        gameTimeMap: parentGameTimeMap ?? gameTimeMap,
      });

      capture('player_added', { player_name: player.name, position: player.position });

      if (deferred) {
        Alert.alert(
          "Player Added",
          `${player.name} will appear on your roster tomorrow.`,
        );
      }

      invalidateRosterQueries();
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to add player");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDropPlayer = async (playerToDrop?: PlayerSeasonStats) => {
    const dropping = playerToDrop ?? player;
    if (!teamId || !dropping) return;
    if (!(await isOnline())) {
      showToast("error", "No internet connection");
      return;
    }

    setIsProcessing(true);
    try {
      await assertNoIllegalIR(leagueId, teamId);
      // For add-and-drop, check if the dropped player is a starter whose game
      // has started — if so, queue the drop for tomorrow instead of dropping now.
      if (playerToDrop && player && parentGameTimeMap && playerLockType) {
        const { data: droppingLp } = await supabase
          .from("league_players")
          .select("roster_slot")
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", dropping.player_id)
          .single();
        const droppingSlot = droppingLp?.roster_slot ?? "BE";
        const droppingIsStarter = isActiveSlot(droppingSlot);
        const droppingGameStarted =
          playerLockType === "daily"
            ? hasAnyGameStarted(parentGameTimeMap)
            : isGameStarted(dropping.nba_team, parentGameTimeMap);

        if (droppingIsStarter && droppingGameStarted) {
          // Queue the drop for tomorrow — starter is mid-game
          const tomorrow = new Date();
          tomorrow.setDate(tomorrow.getDate() + 1);
          const executeAfter = toDateStr(tomorrow);

          const { error } = await supabase.from("pending_transactions").insert({
            league_id: leagueId,
            team_id: teamId,
            player_id: dropping.player_id,
            target_player_id: dropping.player_id,
            action_type: "drop",
            execute_after: executeAfter,
            status: "pending",
            metadata: { name: dropping.name },
          });
          if (error) throw error;

          // Add the new player immediately (lock-aware acquired_at)
          const { deferred } = await addFreeAgent({
            leagueId,
            teamId: teamId!,
            player: {
              player_id: player.player_id,
              name: player.name,
              position: player.position,
              nba_team: player.nba_team ?? "",
            },
            playerLockType,
            gameTimeMap: parentGameTimeMap,
              });

          const addMsg = deferred
            ? `${player.name} will appear on your roster tomorrow.`
            : `${player.name} has been added.`;
          Alert.alert(
            "Add/Drop",
            `${addMsg} ${dropping.name} will be dropped tomorrow (currently in lineup).`,
          );
          setIsProcessing(false);
          invalidateRosterQueries();
          onClose();
          return;
        }
      }

      // For add-and-drop, check weekly acquisition limit before proceeding
      if (playerToDrop && player) {
        const { data: limitData } = await supabase
          .from("leagues")
          .select("weekly_acquisition_limit")
          .eq("id", leagueId)
          .single();
        const wkLimit = limitData?.weekly_acquisition_limit as number | null;
        if (wkLimit != null) {
          const now = new Date();
          const day = now.getUTCDay();
          const mondayOffset = day === 0 ? -6 : 1 - day;
          const monday = new Date(
            Date.UTC(
              now.getUTCFullYear(),
              now.getUTCMonth(),
              now.getUTCDate() + mondayOffset,
            ),
          );
          const weekStart = monday.toISOString().split("T")[0];

          const { count: addsThisWeek } = await supabase
            .from("league_transactions")
            .select("id, league_transaction_items!inner(team_to_id)", {
              count: "exact",
              head: true,
            })
            .eq("league_id", leagueId)
            .eq("team_id", teamId)
            .eq("type", "waiver")
            .not("league_transaction_items.team_to_id", "is", null)
            .gte("created_at", weekStart + "T00:00:00");

          if ((addsThisWeek ?? 0) >= wkLimit) {
            invalidateRosterQueries();
            Alert.alert(
              "Add Limit Reached",
              `You've used all ${wkLimit} adds for this week.`,
            );
            setIsProcessing(false);
            return;
          }
        }
      }
      // Snapshot the player's current slot before deleting so they still
      // appear on prior days of the week. A 'DROPPED' sentinel on today
      // ensures they disappear from today onward.
      const today = toDateStr(new Date());
      const { data: lpRow } = await supabase
        .from("league_players")
        .select("roster_slot")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", dropping.player_id)
        .single();
      const slot = lpRow?.roster_slot ?? "BE";

      const { data: week } = await supabase
        .from("league_schedule")
        .select("start_date")
        .eq("league_id", leagueId)
        .lte("start_date", today)
        .gte("end_date", today)
        .single();

      if (week) {
        await supabase.from("daily_lineups").upsert(
          {
            league_id: leagueId,
            team_id: teamId,
            player_id: dropping.player_id,
            lineup_date: week.start_date,
            roster_slot: slot,
          },
          {
            onConflict: "team_id,player_id,lineup_date",
            ignoreDuplicates: true,
          },
        );
        await supabase.from("daily_lineups").upsert(
          {
            league_id: leagueId,
            team_id: teamId,
            player_id: dropping.player_id,
            lineup_date: today,
            roster_slot: "DROPPED",
          },
          { onConflict: "team_id,player_id,lineup_date" },
        );
        // Remove any future lineup entries so the dropped player doesn't appear on future dates
        await supabase
          .from("daily_lineups")
          .delete()
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", dropping.player_id)
          .gt("lineup_date", today);
      }

      const { error: delError } = await supabase
        .from("league_players")
        .delete()
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", dropping.player_id);
      if (delError) throw delError;

      // Put dropped player on waivers if league has waivers enabled
      const wt = rosterInfo?.waiverType ?? "none";
      const wpDays = rosterInfo?.waiverPeriodDays ?? 2;
      if (wt !== "none" && wpDays > 0) {
        // Round up to the next 6 AM UTC boundary after the waiver period expires
        // so the displayed time matches the actual cron processing time
        const raw = new Date();
        raw.setDate(raw.getDate() + wpDays);
        const until = new Date(
          Date.UTC(
            raw.getUTCFullYear(),
            raw.getUTCMonth(),
            raw.getUTCDate(),
            6,
            0,
            0,
            0,
          ),
        );
        // If the raw time is already past 6 AM UTC on that day, push to next day
        if (raw.getTime() > until.getTime()) {
          until.setUTCDate(until.getUTCDate() + 1);
        }
        await supabase.from("league_waivers").insert({
          league_id: leagueId,
          player_id: dropping.player_id,
          on_waivers_until: until.toISOString(),
          dropped_by_team_id: teamId,
        });
      }

      // If dropping from the picker (add-and-drop), add the new player
      if (playerToDrop && player) {
        const { deferred } = await addFreeAgent({
          leagueId,
          teamId: teamId!,
          player: {
            player_id: player.player_id,
            name: player.name,
            position: player.position,
            nba_team: player.nba_team ?? "",
          },
          playerLockType: playerLockType ?? null,
          gameTimeMap: parentGameTimeMap ?? gameTimeMap,
          });

        // Log the drop side of the transaction
        const { data: dropTxn, error: dropTxnError } = await supabase
          .from("league_transactions")
          .insert({
            league_id: leagueId,
            type: "waiver",
            notes: `Dropped ${dropping.name}`,
            team_id: teamId,
          })
          .select("id")
          .single();
        if (dropTxnError) throw dropTxnError;

        await supabase.from("league_transaction_items").insert({
          transaction_id: dropTxn.id,
          player_id: dropping.player_id,
          team_from_id: teamId,
        });

        // Fire-and-forget notification
        (async () => {
          const { data: team } = await supabase
            .from("teams")
            .select("name")
            .eq("id", teamId)
            .single();
          sendNotification({
            league_id: leagueId,
            category: "roster_moves",
            title: "Roster Move",
            body: `${team?.name ?? "A team"} added ${player.name} (dropped ${dropping.name})`,
            data: { screen: "activity" },
          });
        })();

        if (deferred) {
          Alert.alert("Player Added", `${player.name} will appear on your roster tomorrow.`);
        }

        capture('player_add_drop', { added: player.name, dropped: dropping.name });

        invalidateRosterQueries();
        queryClient.invalidateQueries({
          queryKey: queryKeys.leagueWaivers(leagueId),
        });
        setShowDropPicker(false);
        onClose();
      } else {
        // Pure drop (no add)
        const { data: txn, error: txnError } = await supabase
          .from("league_transactions")
          .insert({
            league_id: leagueId,
            type: "waiver",
            notes: `Dropped ${dropping.name}`,
            team_id: teamId,
          })
          .select("id")
          .single();
        if (txnError) throw txnError;

        await supabase.from("league_transaction_items").insert({
          transaction_id: txn.id,
          player_id: dropping.player_id,
          team_from_id: teamId,
        });

        // Fire-and-forget notification to league
        (async () => {
          const { data: team } = await supabase
            .from("teams")
            .select("name")
            .eq("id", teamId)
            .single();
          sendNotification({
            league_id: leagueId,
            category: "roster_moves",
            title: "Roster Move",
            body: `${team?.name ?? "A team"} dropped ${dropping.name}`,
            data: { screen: "activity" },
          });
        })();

        capture('player_dropped', { player_name: dropping.name });

        invalidateRosterQueries();
        queryClient.invalidateQueries({
          queryKey: queryKeys.leagueWaivers(leagueId),
        });
        onClose();
      }
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to drop player");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMoveToIR = async () => {
    if (!teamId || !player) return;
    setIsProcessing(true);
    try {
      const today = toDateStr(new Date());

      // Check if the player's game is in progress — defer to tomorrow if so
      const isLocked =
        (playerLockType === "daily" && hasAnyGameStarted(parentGameTimeMap ?? gameTimeMap)) ||
        (playerLockType === "individual" && playerGameStarted);

      if (isLocked) {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = toDateStr(tomorrow);

        // Pin today's slot so the player stays in their current position today
        await supabase.from("daily_lineups").upsert(
          {
            league_id: leagueId,
            team_id: teamId,
            player_id: player.player_id,
            lineup_date: today,
            roster_slot: playerRosterSlot ?? "BE",
          },
          { onConflict: "team_id,player_id,lineup_date" },
        );
        // Write IR for tomorrow onward
        await supabase.from("daily_lineups").upsert(
          {
            league_id: leagueId,
            team_id: teamId,
            player_id: player.player_id,
            lineup_date: tomorrowStr,
            roster_slot: "IR",
          },
          { onConflict: "team_id,player_id,lineup_date" },
        );
        // Flip any future daily_lineups beyond tomorrow to IR
        await supabase
          .from("daily_lineups")
          .update({ roster_slot: "IR" })
          .eq("team_id", teamId)
          .eq("league_id", leagueId)
          .eq("player_id", player.player_id)
          .neq("roster_slot", "IR")
          .gt("lineup_date", tomorrowStr);

        // Update league_players canonical slot (going-forward state)
        const { error } = await supabase
          .from("league_players")
          .update({ roster_slot: "IR" })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", player.player_id);
        if (error) throw error;

        invalidateRosterQueries();
        Alert.alert(
          "Move Queued",
          `${player.name}'s game is in progress. The move to IR takes effect tomorrow.`,
        );
        onClose();
        return;
      }

      // No game lock — move immediately
      await supabase.from("daily_lineups").upsert(
        {
          league_id: leagueId,
          team_id: teamId,
          player_id: player.player_id,
          lineup_date: today,
          roster_slot: "IR",
        },
        { onConflict: "team_id,player_id,lineup_date" },
      );
      // Flip any future daily_lineups to IR
      await supabase
        .from("daily_lineups")
        .update({ roster_slot: "IR" })
        .eq("team_id", teamId)
        .eq("league_id", leagueId)
        .eq("player_id", player.player_id)
        .neq("roster_slot", "IR")
        .gt("lineup_date", today);

      const { error } = await supabase
        .from("league_players")
        .update({ roster_slot: "IR" })
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", player.player_id);
      if (error) throw error;
      invalidateRosterQueries();
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to move player to IR");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleActivateFromIR = async () => {
    if (!teamId || !player) return;

    // Fast path: use cached rosterInfo if available
    if (rosterInfo && rosterInfo.activeCount >= rosterInfo.maxSize) {
      setActivateFromIR(true);
      setShowDropPicker(true);
      return;
    }

    setIsProcessing(true);
    try {
      // Re-verify roster limit from the database before activating
      const [allRes, irRes, taxiRes, leagueRes] = await Promise.all([
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("roster_slot", "IR"),
        supabase
          .from("league_players")
          .select("id", { count: "exact", head: true })
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("roster_slot", "TAXI"),
        supabase
          .from("leagues")
          .select("roster_size")
          .eq("id", leagueId)
          .single(),
      ]);
      const freshActiveCount =
        (allRes.count ?? 0) - (irRes.count ?? 0) - (taxiRes.count ?? 0);
      const maxSize = leagueRes.data?.roster_size ?? 13;

      if (freshActiveCount >= maxSize) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.rosterInfo(leagueId, teamId!),
        });
        setIsProcessing(false);
        setActivateFromIR(true);
        setShowDropPicker(true);
        return;
      }

      const today = toDateStr(new Date());

      // Write daily_lineups so roster/matchup pages reflect the activation immediately
      await supabase.from("daily_lineups").upsert(
        {
          league_id: leagueId,
          team_id: teamId,
          player_id: player.player_id,
          lineup_date: today,
          roster_slot: "BE",
        },
        { onConflict: "team_id,player_id,lineup_date" },
      );
      // Flip any future daily_lineups from IR → BE
      await supabase
        .from("daily_lineups")
        .update({ roster_slot: "BE" })
        .eq("team_id", teamId)
        .eq("league_id", leagueId)
        .eq("player_id", player.player_id)
        .eq("roster_slot", "IR")
        .gt("lineup_date", today);

      const { error } = await supabase
        .from("league_players")
        .update({ roster_slot: "BE" })
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", player.player_id);
      if (error) throw error;
      invalidateRosterQueries();
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to activate player");
    } finally {
      setIsProcessing(false);
    }
  };

  /** Drop a player and activate the current player from IR in a single flow. */
  const handleDropAndActivateFromIR = async (playerToDrop: PlayerSeasonStats) => {
    if (!teamId || !player) return;
    if (!(await isOnline())) {
      showToast("error", "No internet connection");
      return;
    }
    setIsProcessing(true);
    try {
      // ── Snapshot & drop the selected player ──
      const today = toDateStr(new Date());
      const { data: lpRow } = await supabase
        .from("league_players")
        .select("roster_slot")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", playerToDrop.player_id)
        .single();
      const slot = lpRow?.roster_slot ?? "BE";

      const { data: week } = await supabase
        .from("league_schedule")
        .select("start_date")
        .eq("league_id", leagueId)
        .lte("start_date", today)
        .gte("end_date", today)
        .single();

      if (week) {
        await supabase.from("daily_lineups").upsert(
          {
            league_id: leagueId,
            team_id: teamId,
            player_id: playerToDrop.player_id,
            lineup_date: week.start_date,
            roster_slot: slot,
          },
          { onConflict: "team_id,player_id,lineup_date", ignoreDuplicates: true },
        );
        await supabase.from("daily_lineups").upsert(
          {
            league_id: leagueId,
            team_id: teamId,
            player_id: playerToDrop.player_id,
            lineup_date: today,
            roster_slot: "DROPPED",
          },
          { onConflict: "team_id,player_id,lineup_date" },
        );
        await supabase
          .from("daily_lineups")
          .delete()
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", playerToDrop.player_id)
          .gt("lineup_date", today);
      }

      const { error: delError } = await supabase
        .from("league_players")
        .delete()
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", playerToDrop.player_id);
      if (delError) throw delError;

      // Place on waivers
      const wt = rosterInfo?.waiverType ?? "none";
      const wpDays = rosterInfo?.waiverPeriodDays ?? 2;
      if (wt !== "none" && wpDays > 0) {
        const raw = new Date();
        raw.setDate(raw.getDate() + wpDays);
        const until = new Date(
          Date.UTC(raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 6, 0, 0, 0),
        );
        if (raw.getTime() > until.getTime()) {
          until.setUTCDate(until.getUTCDate() + 1);
        }
        await supabase.from("league_waivers").insert({
          league_id: leagueId,
          player_id: playerToDrop.player_id,
          on_waivers_until: until.toISOString(),
          dropped_by_team_id: teamId,
        });
      }

      // ── Activate from IR into the dropped player's slot (if eligible) ──
      const destSlot =
        isEligibleForSlot(player.position, slot) ? slot : "BE";

      // Write daily_lineup for today so the roster view picks it up immediately
      await supabase.from("daily_lineups").upsert(
        {
          league_id: leagueId,
          team_id: teamId,
          player_id: player.player_id,
          lineup_date: today,
          roster_slot: destSlot,
        },
        { onConflict: "team_id,player_id,lineup_date" },
      );
      // Flip any future daily_lineups from IR → destSlot
      await supabase
        .from("daily_lineups")
        .update({ roster_slot: destSlot })
        .eq("team_id", teamId)
        .eq("league_id", leagueId)
        .eq("player_id", player.player_id)
        .eq("roster_slot", "IR")
        .gt("lineup_date", today);

      const { error: activateError } = await supabase
        .from("league_players")
        .update({ roster_slot: destSlot })
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", player.player_id);
      if (activateError) throw activateError;

      // ── Transaction log ──
      const { data: txn, error: txnError } = await supabase
        .from("league_transactions")
        .insert({
          league_id: leagueId,
          type: "waiver",
          notes: `Activated ${player.name} from IR (dropped ${playerToDrop.name})`,
          team_id: teamId,
        })
        .select("id")
        .single();
      if (txnError) throw txnError;

      await supabase.from("league_transaction_items").insert([
        {
          transaction_id: txn.id,
          player_id: playerToDrop.player_id,
          team_from_id: teamId,
        },
      ]);

      // Fire-and-forget notification
      (async () => {
        const { data: team } = await supabase
          .from("teams")
          .select("name")
          .eq("id", teamId)
          .single();
        sendNotification({
          league_id: leagueId,
          category: "roster_moves",
          title: "Roster Move",
          body: `${team?.name ?? "A team"} activated ${player.name} from IR (dropped ${playerToDrop.name})`,
          data: { screen: "activity" },
        });
      })();

      capture('ir_activate_drop', { activated: player.name, dropped: playerToDrop.name });

      invalidateRosterQueries();
      queryClient.invalidateQueries({ queryKey: queryKeys.leagueWaivers(leagueId) });
      setActivateFromIR(false);
      setShowDropPicker(false);
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to activate player");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMoveToTaxi = async () => {
    if (!teamId || !player) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from("league_players")
        .update({ roster_slot: "TAXI" })
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", player.player_id);
      if (error) throw error;
      invalidateRosterQueries();
      onClose();
    } catch (err: any) {
      Alert.alert(
        "Error",
        err.message ?? "Failed to move player to taxi squad",
      );
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePromoteFromTaxi = () => {
    if (!teamId || !player) return;
    Alert.alert(
      "Promote from Taxi",
      `Move ${player.name} to bench? This is permanent — they cannot return to the taxi squad.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Promote",
          onPress: async () => {
            setIsProcessing(true);
            try {
              const { error } = await supabase
                .from("league_players")
                .update({ roster_slot: "BE" })
                .eq("league_id", leagueId)
                .eq("team_id", teamId)
                .eq("player_id", player.player_id);
              if (error) throw error;
              invalidateRosterQueries();
              onClose();
            } catch (err: any) {
              Alert.alert("Error", err.message ?? "Failed to promote player");
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ],
    );
  };

  const handleToggleTradeBlock = () => {
    if (!teamId || !player) return;
    if (!isOnTradeBlock) {
      // Adding — show prompt for asking price / note
      setTradeBlockNoteInput(ownershipInfo?.tradeBlockNote ?? "");
      setTradeBlockPromptVisible(true);
    } else {
      // Removing
      Alert.alert(
        "Remove from Trade Block",
        `Remove ${player.name} from the trade block?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            onPress: () => submitTradeBlockUpdate(false, null),
          },
        ],
      );
    }
  };

  const submitTradeBlockUpdate = async (
    newValue: boolean,
    note: string | null,
  ) => {
    if (!teamId || !player) return;
    setIsProcessing(true);
    try {
      const updatePayload: Record<string, any> = {
        on_trade_block: newValue,
        trade_block_note: note,
      };
      if (!newValue) updatePayload.trade_block_interest = [];
      const { error } = await supabase
        .from("league_players")
        .update(updatePayload)
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("player_id", player.player_id);
      if (error) throw error;
      queryClient.setQueryData(
        queryKeys.playerOwnership(leagueId, teamId!, player.player_id),
        (old: any) =>
          old
            ? { ...old, onTradeBlock: newValue, tradeBlockNote: note ?? "" }
            : old,
      );
      queryClient.invalidateQueries({ queryKey: queryKeys.tradeBlock(leagueId) });
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to update trade block");
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQueueDrop = async () => {
    if (!teamId || !player || !leagueId) return;
    setIsProcessing(true);
    try {
      await assertNoIllegalIR(leagueId, teamId);
      const { data: existing } = await supabase
        .from("pending_transactions")
        .select("id")
        .eq("team_id", teamId)
        .eq("player_id", player.player_id)
        .eq("status", "pending")
        .limit(1);

      if (existing && existing.length > 0) {
        Alert.alert(
          "Already Queued",
          `${player.name} is already queued to be dropped.`,
        );
        return;
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const executeAfter = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;

      const { error } = await supabase.from("pending_transactions").insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: player.player_id,
        action_type: "drop",
        execute_after: executeAfter,
        status: "pending",
      });
      if (error) throw error;

      Alert.alert("Drop Queued", `${player.name} will be dropped tomorrow.`);
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to queue drop");
    } finally {
      setIsProcessing(false);
    }
  };

  const isOffseason = rosterInfo?.offseasonStep != null;
  const canTransact =
    !!teamId && !hasActiveDraft && !isProcessing && !isOffseason;
  const canAdd = canTransact && !addsExhausted;

  const renderDropPickerItem = ({
    item,
    index,
  }: {
    item: PlayerSeasonStats;
    index: number;
  }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : null;
    const dropPickerData = (rosterPlayers ?? []).filter(
      (p) => playerLockType === "daily" || !isGameStarted(p.nba_team, gameTimeMap),
    );

    return (
      <TouchableOpacity
        style={[
          styles.dropPickerRow,
          { borderBottomColor: c.border },
          index === dropPickerData.length - 1 && { borderBottomWidth: 0 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`Drop ${item.name}, ${formatPosition(item.position)}, ${item.nba_team}${fpts !== null ? `, ${fpts} fantasy points` : ""}`}
        onPress={() => {
          if (activateFromIR) {
            Alert.alert(
              "Confirm Transaction",
              `Drop ${item.name} to activate ${player.name} from IR?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Confirm",
                  style: "destructive",
                  onPress: () => handleDropAndActivateFromIR(item),
                },
              ],
            );
          } else if (onDropForClaim) {
            Alert.alert(
              "Select Drop for Claim",
              `Drop ${item.name} when your claim for ${player.name} processes?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Confirm",
                  onPress: () => {
                    onDropForClaim(item);
                    handleClose();
                  },
                },
              ],
            );
          } else if (needsWaiverClaim) {
            // No external callback but player needs a claim — submit natively
            Alert.alert(
              "Select Drop for Claim",
              `Drop ${item.name} when your claim for ${player.name} processes?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Submit Claim",
                  onPress: async () => {
                    setIsProcessing(true);
                    try {
                      await submitWaiverClaim(item.player_id);
                      handleClose();
                    } catch (err: any) {
                      Alert.alert(
                        "Error",
                        err.message ?? "Failed to submit claim",
                      );
                    } finally {
                      setIsProcessing(false);
                    }
                  },
                },
              ],
            );
          } else {
            Alert.alert(
              "Confirm Transaction",
              `Drop ${item.name} to add ${player.name}?`,
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Confirm",
                  style: "destructive",
                  onPress: () => handleDropPlayer(item),
                },
              ],
            );
          }
        }}
        disabled={isProcessing}
      >
        <View style={styles.dropPickerInfo}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>
            {item.name}
          </ThemedText>
          <ThemedText
            style={[styles.dropPickerSub, { color: c.secondaryText }]}
          >
            {formatPosition(item.position)} · {item.nba_team}
          </ThemedText>
        </View>
        {fpts !== null && (
          <ThemedText style={[styles.dropPickerFpts, { color: c.accent }]}>
            {fpts} FPTS
          </ThemedText>
        )}
      </TouchableOpacity>
    );
  };

  // Drop picker sub-modal
  if (showDropPicker) {
    return (
      <Modal visible animationType="slide" transparent>
        <View style={styles.overlay}>
          <Animated.View
            style={[
              styles.sheet,
              { backgroundColor: c.background, transform: [{ translateY }] },
            ]}
            accessibilityViewIsModal={true}
          >
            <View {...panResponder.panHandlers}>
              <View style={[styles.header, { borderBottomColor: c.border }]}>
                <View style={styles.headerInfo}>
                  <ThemedText
                    type="title"
                    style={styles.playerName}
                    accessibilityRole="header"
                  >
                    Drop a Player
                  </ThemedText>
                  <ThemedText
                    style={[styles.subtitle, { color: c.secondaryText }]}
                  >
                    {activateFromIR
                      ? `Your active roster is full. Select a player to drop in order to activate ${player.name} from IR.`
                      : `Your roster is full. Select a player to drop in order to add ${player.name}.`}
                  </ThemedText>
                </View>
                <TouchableOpacity
                  onPress={() =>
                    (startInDropPicker || startInActivateFromIR) ? handleClose() : (() => { setShowDropPicker(false); setActivateFromIR(false); })()
                  }
                  style={styles.closeButton}
                  accessibilityRole="button"
                  accessibilityLabel="Close"
                >
                  <ThemedText style={styles.closeText}>✕</ThemedText>
                </TouchableOpacity>
              </View>
            </View>

            {isProcessing ? (
              <View style={styles.loading}><LogoSpinner /></View>
            ) : (
              <FlatList
                data={(rosterPlayers ?? []).filter(
                  (p) => playerLockType === "daily" || !isGameStarted(p.nba_team, gameTimeMap),
                )}
                renderItem={renderDropPickerItem}
                keyExtractor={(item) => item.player_id}
                contentContainerStyle={styles.dropPickerList}
                maxToRenderPerBatch={10}
                windowSize={5}
                ListEmptyComponent={
                  <View style={{ padding: s(20), alignItems: "center" }}>
                    <ThemedText
                      style={{ color: c.secondaryText, textAlign: "center" }}
                    >
                      All your roster players have games in progress. Try again
                      later.
                    </ThemedText>
                  </View>
                }
              />
            )}
          </Animated.View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={!!player} animationType="slide" transparent>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: c.background, transform: [{ translateY }] },
          ]}
          accessibilityViewIsModal={true}
        >
          {/* Header - swipe area */}
          <View {...panResponder.panHandlers}>
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              {/* Portrait with injury chip */}
              <View style={styles.headerHeadshotWrap}>
                {(() => {
                  const headshotUrl = getPlayerHeadshotUrl(
                    player.external_id_nba,
                    "1040x760",
                  );
                  return (
                    <View
                      style={[
                        styles.headerHeadshotCircle,
                        { borderColor: c.gold, backgroundColor: c.cardAlt },
                      ]}
                      accessibilityLabel={`${player.name} headshot`}
                    >
                      {headshotUrl ? (
                        <Image
                          source={{ uri: headshotUrl }}
                          style={styles.headerHeadshotImg}
                          resizeMode="cover"
                        />
                      ) : null}
                    </View>
                  );
                })()}
                {(() => {
                  const badge = getInjuryBadge(player.status);
                  return badge ? (
                    <View
                      style={[
                        styles.injuryChip,
                        { backgroundColor: badge.color },
                      ]}
                      accessibilityLabel={`Injury status: ${badge.label}`}
                    >
                      <ThemedText style={[styles.injuryChipText, { color: c.statusText }]}>
                        {badge.label}
                      </ThemedText>
                    </View>
                  ) : null;
                })()}
                {playerNews?.some(a => a.has_minutes_restriction) && (
                  <View
                    style={[styles.injuryChip, { backgroundColor: c.warning }]}
                    accessibilityLabel="Minutes restriction"
                  >
                    <ThemedText style={[styles.injuryChipText, { color: c.statusText }]}>
                      MIN RESTRICT
                    </ThemedText>
                  </View>
                )}
              </View>
              <View style={styles.headerInfo}>
                {/* Line 1: Name + trade + watchlist */}
                <View style={styles.nameRow}>
                  <ThemedText
                    type="title"
                    style={styles.playerName}
                    numberOfLines={1}
                  >
                    {player.name}
                  </ThemedText>
                  {teamId && !isFreeAgent && playerRosterSlot !== 'IR' && (
                    <TouchableOpacity
                      onPress={() => {
                        handleClose();
                        router.push({
                          pathname: "/trades",
                          params: {
                            proposeTeamId: isOwnedByOther ? ownerTeamId ?? undefined : undefined,
                            proposePlayerId: player.player_id,
                            proposePlayerName: player.name,
                            proposePlayerPos: player.position,
                            proposePlayerTeam: player.nba_team,
                            proposePlayerFpts: avgFpts != null ? String(avgFpts) : undefined,
                          },
                        });
                      }}
                      hitSlop={8}
                      style={{ marginLeft: s(6) }}
                      accessibilityRole="button"
                      accessibilityLabel={`Trade ${player.name}`}
                    >
                      <Ionicons
                        name="swap-horizontal"
                        size={18}
                        color={c.secondaryText}
                      />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    onPress={() => {
                      const wasWatched = isWatchlisted(player.player_id);
                      toggleWatchlist(player.player_id);
                      showInlineToast(wasWatched ? 'Removed from watchlist' : 'Added to watchlist');
                    }}
                    hitSlop={8}
                    style={{ marginLeft: s(6) }}
                    accessibilityRole="button"
                    accessibilityLabel={
                      isWatchlisted(player.player_id)
                        ? `Remove ${player.name} from watchlist`
                        : `Add ${player.name} to watchlist`
                    }
                  >
                    <Ionicons
                      name={
                        isWatchlisted(player.player_id) ? "eye" : "eye-outline"
                      }
                      size={18}
                      color={
                        isWatchlisted(player.player_id)
                          ? c.link
                          : c.secondaryText
                      }
                    />
                  </TouchableOpacity>
                </View>
                {/* Line 2: Identity — team + positions + GP */}
                <View style={styles.subtitleRow}>
                  {(() => {
                    const logoUrl = getTeamLogoUrl(player.nba_team);
                    return logoUrl ? (
                      <Image
                        source={{ uri: logoUrl }}
                        style={styles.modalTeamLogo}
                        resizeMode="contain"
                      />
                    ) : null;
                  })()}
                  <ThemedText
                    style={[styles.subtitle, { color: c.secondaryText }]}
                  >
                    {player.nba_team} · {formatPosition(player.position)}
                    {player.birthdate ? ` · ${calculateAge(player.birthdate)}y` : ""}
                    {" · "}
                    {player.games_played}
                    {teamGamesPlayed ? `/${teamGamesPlayed}` : ""} GP
                  </ThemedText>
                </View>
                {/* Line 3: Ownership + action buttons */}
                <View style={styles.subtitleRow}>
                  {isOnMyTeam ? (
                    <ThemedText
                      style={[styles.subtitle, { color: c.accent }]}
                    >
                      Your team
                    </ThemedText>
                  ) : isOwnedByOther ? (
                    <ThemedText
                      style={[styles.subtitle, { color: c.secondaryText }]}
                    >
                      {resolvedOwnerName}
                    </ThemedText>
                  ) : (
                    <ThemedText
                      style={[styles.subtitle, { color: c.secondaryText }]}
                    >
                      Free Agent
                    </ThemedText>
                  )}
                  {hasActiveDraft && (
                    <ThemedText
                      style={[styles.headerWarning, { color: c.secondaryText }]}
                    >
                      {" "}· Draft locked
                    </ThemedText>
                  )}
                  {isOffseason && !hasActiveDraft && (
                    <ThemedText
                      style={[styles.headerWarning, { color: c.secondaryText }]}
                    >
                      {" "}· Offseason locked
                    </ThemedText>
                  )}
                  {teamId && ownershipInfo !== undefined && (
                    <View style={styles.headerActions}>
                      {isOnMyTeam ? (
                        <>
                          {playerRosterSlot === "IR" && (
                            <TouchableOpacity
                              style={[
                                styles.headerBtn,
                                { backgroundColor: c.success },
                                (!canTransact || playerGameStarted) &&
                                  styles.buttonDisabled,
                              ]}
                              onPress={handleActivateFromIR}
                              disabled={!canTransact || playerGameStarted}
                              accessibilityRole="button"
                              accessibilityLabel={`Activate ${player.name} from IR`}
                            >
                              {isProcessing ? (
                                <LogoSpinner size={18} />
                              ) : (
                                <ThemedText style={[styles.headerBtnText, { color: c.statusText }]}>
                                  Activate
                                </ThemedText>
                              )}
                            </TouchableOpacity>
                          )}
                          {playerRosterSlot === "TAXI" && (
                            <TouchableOpacity
                              style={[
                                styles.headerBtn,
                                { backgroundColor: c.success },
                                !canTransact && styles.buttonDisabled,
                              ]}
                              onPress={handlePromoteFromTaxi}
                              disabled={!canTransact}
                              accessibilityRole="button"
                              accessibilityLabel={`Promote ${player.name} from taxi squad`}
                            >
                              {isProcessing ? (
                                <LogoSpinner size={18} />
                              ) : (
                                <ThemedText style={[styles.headerBtnText, { color: c.statusText }]}>
                                  Promote
                                </ThemedText>
                              )}
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.headerBtn,
                              { backgroundColor: c.danger },
                              !canTransact && styles.buttonDisabled,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={`Drop ${player.name}`}
                            onPress={() => {
                              if (playerGameStarted) {
                                Alert.alert(
                                  "Drop Player",
                                  `${player.name}'s game has already started. Drop will be queued for tomorrow.`,
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    {
                                      text: "Drop",
                                      style: "destructive",
                                      onPress: () => handleQueueDrop(),
                                    },
                                  ],
                                );
                              } else {
                                Alert.alert(
                                  "Drop Player",
                                  `Are you sure you want to drop ${player.name}?`,
                                  [
                                    { text: "Cancel", style: "cancel" },
                                    {
                                      text: "Drop",
                                      style: "destructive",
                                      onPress: () => handleDropPlayer(),
                                    },
                                  ],
                                );
                              }
                            }}
                            disabled={!canTransact}
                          >
                            {isProcessing && playerRosterSlot !== "IR" ? (
                              <LogoSpinner size={18} />
                            ) : (
                              <ThemedText style={[styles.headerBtnText, { color: c.statusText }]}>
                                Drop
                              </ThemedText>
                            )}
                          </TouchableOpacity>
                          {canMoveToIR &&
                            !playerGameStarted &&
                            playerRosterSlot !== "IR" &&
                            playerRosterSlot !== "TAXI" && (
                              <TouchableOpacity
                                style={[
                                  styles.headerBtn,
                                  { backgroundColor: c.warning },
                                  !canTransact && styles.buttonDisabled,
                                ]}
                                onPress={handleMoveToIR}
                                disabled={!canTransact}
                                accessibilityRole="button"
                                accessibilityLabel={`Move ${player.name} to IR`}
                              >
                                <ThemedText style={[styles.headerBtnText, { color: c.statusText }]}>
                                  IR
                                </ThemedText>
                              </TouchableOpacity>
                            )}
                          {rosterInfo &&
                            rosterInfo.taxiSlotCount > 0 &&
                            rosterInfo.taxiCount < rosterInfo.taxiSlotCount &&
                            playerRosterSlot !== "TAXI" &&
                            playerRosterSlot !== "IR" &&
                            (!playerRosterSlot || playerRosterSlot === "BE") &&
                            isTaxiEligible(
                              player.nba_draft_year,
                              rosterInfo.season,
                              rosterInfo.taxiMaxExperience,
                            ) && (
                              <TouchableOpacity
                                style={[
                                  styles.headerBtn,
                                  styles.headerBtnTaxi,
                                  !canTransact && styles.buttonDisabled,
                                ]}
                                onPress={handleMoveToTaxi}
                                disabled={!canTransact}
                                accessibilityRole="button"
                                accessibilityLabel={`Move ${player.name} to taxi squad`}
                              >
                                <ThemedText style={[styles.headerBtnText, { color: c.statusText }]}>
                                  Taxi
                                </ThemedText>
                              </TouchableOpacity>
                            )}
                          <TouchableOpacity
                            style={[
                              styles.headerBtn,
                              isOnTradeBlock
                                ? { backgroundColor: c.warning }
                                : {
                                    backgroundColor: "transparent",
                                    borderWidth: 1,
                                    borderColor: c.warning,
                                  },
                              isProcessing && styles.buttonDisabled,
                            ]}
                            onPress={handleToggleTradeBlock}
                            disabled={isProcessing}
                            accessibilityRole="button"
                            accessibilityLabel={
                              isOnTradeBlock
                                ? `Remove ${player.name} from trade block`
                                : `Add ${player.name} to trade block`
                            }
                          >
                            <Ionicons
                              name={
                                isOnTradeBlock
                                  ? "megaphone"
                                  : "megaphone-outline"
                              }
                              size={12}
                              color={isOnTradeBlock ? c.statusText : c.warning}
                            />
                          </TouchableOpacity>
                        </>
                      ) : isFreeAgent ? (
                        <TouchableOpacity
                          style={[
                            styles.headerBtn,
                            needsWaiverClaim
                              ? { backgroundColor: c.gold }
                              : [styles.headerBtnAdd, { backgroundColor: c.success }],
                            !canAdd && styles.buttonDisabled,
                          ]}
                          onPress={handleAddPlayer}
                          disabled={!canAdd}
                          accessibilityRole="button"
                          accessibilityLabel={
                            needsWaiverClaim
                              ? `Claim ${player.name}`
                              : `Add ${player.name}`
                          }
                        >
                          {isProcessing ? (
                            <LogoSpinner size={18} />
                          ) : (
                            <ThemedText style={[styles.headerBtnText, { color: c.statusText }]}>
                              {needsWaiverClaim ? "Claim" : "Add"}
                            </ThemedText>
                          )}
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  )}
                </View>
              </View>
              <TouchableOpacity
                onPress={handleClose}
                style={styles.closeButton}
                accessibilityRole="button"
                accessibilityLabel="Close player details"
              >
                <ThemedText style={styles.closeText}>✕</ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView
            ref={scrollRef}
            contentContainerStyle={styles.scrollContent}
            stickyHeaderIndices={[6]}
          >
            {/* Stats + Insights (unified block) */}
            <SeasonAverages
              player={player}
              avgFpts={avgFpts}
              isCategories={isCategories}
              rankings={rankings}
              colors={{
                secondaryText: c.secondaryText,
                accent: c.accent,
                card: c.card,
                statusText: c.statusText,
              }}
            />
            <PlayerInsightsCard
              games={gameLog}
              scoringWeights={scoringWeights}
              seasonAvg={avgFpts}
              recentWindow={insightsWindow}
              onRecentWindowChange={setInsightsWindow}
              colors={{
                border: c.border,
                secondaryText: c.secondaryText,
                accent: c.accent,
                card: c.card,
              }}
              scoringType={leagueScoringType ?? undefined}
            />

            {/* Divider */}
            <View style={styles.divider} />

            {/* Tab pager: News, Transactions, Previous Seasons */}
            <HorizontalPager
              minHeight={120}
              pageLabels={[
                "News",
                "Transactions",
                ...(historicalStats && historicalStats.length > 0
                  ? ["Previous Seasons"]
                  : []),
              ]}
            >
              {[
                <View key="news" style={{ paddingHorizontal: s(16), gap: s(10) }}>
                  {isLoadingNews ? (
                    <View style={{ marginTop: s(20) }}><LogoSpinner /></View>
                  ) : playerNews && playerNews.length > 0 ? (
                    playerNews.slice(0, 10).map((article) => (
                      <NewsCard key={article.id} article={article} />
                    ))
                  ) : (
                    <ThemedText style={{ color: c.secondaryText, fontSize: ms(13), marginTop: s(8) }}>
                      No recent news for {player?.name ?? 'this player'}
                    </ThemedText>
                  )}
                </View>,
                <PlayerHistory
                  key="transactions"
                  playerId={player?.player_id}
                  leagueId={leagueId}
                />,
                ...(historicalStats && historicalStats.length > 0
                  ? [
                      <PreviousSeasons
                        key="prev-seasons"
                        historicalStats={historicalStats}
                        colors={{ border: c.border, secondaryText: c.secondaryText }}
                      />,
                    ]
                  : []),
              ]}
            </HorizontalPager>

            {/* Divider */}
            <View style={styles.divider} />

            {/* Game Log */}
            <View style={styles.section}>
              <View style={styles.sectionHeader}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Game Log
                </ThemedText>
                {(() => {
                  if (!upcomingGames || upcomingGames.length === 0) return null;
                  const now = new Date();
                  const day = now.getDay();
                  const daysUntilSunday = day === 0 ? 0 : 7 - day;
                  const endOfWeek = new Date(now);
                  endOfWeek.setDate(now.getDate() + daysUntilSunday);
                  const endStr = endOfWeek.toISOString().slice(0, 10);
                  const remaining = upcomingGames.filter((g) => g.game_date <= endStr).length;
                  if (remaining === 0) return null;
                  return (
                    <ThemedText
                      style={[styles.gamesThisWeek, { color: c.secondaryText }]}
                      accessibilityLabel={`${remaining} game${remaining !== 1 ? "s" : ""} remaining this week`}
                    >
                      {remaining} game{remaining !== 1 ? "s" : ""} this week
                    </ThemedText>
                  );
                })()}
              </View>
            </View>

            {/* Sticky header: pins to bottom of player header while scrolling;
                stays horizontally in sync with the body via shared refs. */}
            <PlayerGameLogHeader
              scoringWeights={scoringWeights}
              isCategories={isCategories}
              headerScrollRef={gameLogHeaderScrollRef}
              backgroundColor={c.background}
              colors={{
                border: c.border,
                secondaryText: c.secondaryText,
                accent: c.accent,
              }}
            />

            <PlayerGameLog
              gameLog={gameLog}
              isLoading={isLoadingGameLog}
              scoringWeights={scoringWeights}
              upcomingGames={upcomingGames}
              liveStats={liveStats}
              liveToGameLog={liveToGameLog}
              formatGameInfo={formatGameInfo}
              playerName={player?.name ?? ""}
              expanded={gameLogExpanded}
              onExpand={() => setGameLogExpanded(true)}
              isCategories={isCategories}
              bodyScrollRef={gameLogBodyScrollRef}
              onBodyScroll={handleGameLogBodyScroll}
              colors={{
                border: c.border,
                secondaryText: c.secondaryText,
                accent: c.accent,
              }}
            />
          </ScrollView>

          {/* Inline toast — sits inside the sheet so it isn't hidden by the Modal */}
          {inlineToast && (
            <View
              pointerEvents="none"
              style={styles.inlineToastWrap}
              accessibilityRole="alert"
              accessibilityLiveRegion="assertive"
              accessibilityLabel={inlineToast}
            >
              <View style={[styles.inlineToastPill, { backgroundColor: c.success }]}>
                <Ionicons
                  name="checkmark-circle"
                  size={16}
                  color={c.statusText}
                  style={{ marginRight: s(6) }}
                />
                <ThemedText style={[styles.inlineToastText, { color: c.statusText }]}>
                  {inlineToast}
                </ThemedText>
              </View>
            </View>
          )}

          {/* Trade block note prompt — rendered inside the main modal */}
          {tradeBlockPromptVisible && (
            <KeyboardAvoidingView
              style={styles.tradeBlockPromptOverlay}
              behavior={Platform.OS === "ios" ? "padding" : undefined}
            >
              <View
                style={[
                  styles.tradeBlockPromptCard,
                  { backgroundColor: c.card },
                ]}
              >
                <ThemedText
                  type="defaultSemiBold"
                  style={styles.tradeBlockPromptTitle}
                  accessibilityRole="header"
                >
                  Add to Trade Block
                </ThemedText>
                <ThemedText
                  style={[
                    styles.tradeBlockPromptDesc,
                    { color: c.secondaryText },
                  ]}
                >
                  What are you looking for? (optional)
                </ThemedText>
                <TextInput
                  style={[
                    styles.tradeBlockPromptInput,
                    {
                      color: c.text,
                      borderColor: c.border,
                      backgroundColor: c.background,
                    },
                  ]}
                  value={tradeBlockNoteInput}
                  onChangeText={setTradeBlockNoteInput}
                  placeholder='e.g. "2nd Rounder", "Wing player"'
                  placeholderTextColor={c.secondaryText}
                  maxLength={100}
                  autoFocus
                  accessibilityLabel="Asking price or trade note"
                />
                <View style={styles.tradeBlockPromptButtons}>
                  <TouchableOpacity
                    style={[
                      styles.tradeBlockPromptBtn,
                      { borderColor: c.border },
                    ]}
                    onPress={() => setTradeBlockPromptVisible(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                  >
                    <ThemedText>Cancel</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[
                      styles.tradeBlockPromptBtn,
                      { backgroundColor: c.warning },
                    ]}
                    onPress={() => {
                      setTradeBlockPromptVisible(false);
                      submitTradeBlockUpdate(
                        true,
                        tradeBlockNoteInput.trim() || null,
                      );
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Add to trade block"
                  >
                    <ThemedText style={{ color: c.statusText, fontWeight: "600" }}>
                      Add
                    </ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    minHeight: "90%",
    maxHeight: "92%",
    overflow: "hidden",
    paddingBottom: s(32),
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: s(16),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerHeadshotWrap: {
    position: "relative" as const,
    marginRight: s(12),
  },
  headerHeadshotCircle: {
    width: s(74),
    height: s(74),
    borderRadius: 40,
    borderWidth: 1.5,
    overflow: "hidden" as const,
  },
  injuryChip: {
    position: "absolute" as const,
    top: s(-2),
    left: s(-4),
    paddingHorizontal: s(4),
    paddingVertical: 0,
    maxHeight: s(16),
    borderRadius: 3,
  },
  injuryChipText: {
    fontSize: ms(8),
    fontWeight: "800" as const,
    letterSpacing: 0.5,
    position: "relative" as const,
    top: -4,
  },
  headerHeadshotImg: {
    position: "absolute" as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(66),
  },
  headerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: ms(22),
    flexShrink: 1,
  },
  subtitleRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: s(4),
    marginTop: s(2),
  },
  modalTeamLogo: {
    width: s(14),
    height: s(14),
    opacity: 0.6,
  },
  subtitle: {
    fontSize: ms(13),
  },
  outBadge: {
    fontWeight: "700",
  },
  closeButton: {
    padding: s(8),
    marginTop: s(-4),
    marginRight: s(-4),
  },
  closeText: {
    fontSize: ms(18),
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  headerBtn: {
    height: s(26),
    paddingHorizontal: s(10),
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  headerBtnAdd: {},
  headerBtnTaxi: {
    backgroundColor: "#8e44ad",
  },
  headerBtnText: {
    fontSize: ms(12),
    fontWeight: "600",
  },
  headerWarning: {
    fontSize: ms(10),
    marginTop: s(2),
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  scrollContent: {
    paddingTop: s(12),
  },
  sectionHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  gamesThisWeek: {
    fontSize: ms(12),
    fontWeight: "600",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(128,128,128,0.2)",
    marginHorizontal: s(16),
    marginVertical: s(8),
  },
  section: {
    paddingHorizontal: s(16),
    marginBottom: s(8),
  },
  sectionTitle: {
    marginBottom: s(8),
  },
  loading: {
    padding: s(20),
  },
  dropPickerList: {
    padding: s(8),
  },
  dropPickerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: s(14),
    paddingHorizontal: s(16),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropPickerInfo: {
    flex: 1,
  },
  dropPickerSub: {
    fontSize: ms(12),
    marginTop: s(2),
  },
  dropPickerFpts: {
    fontSize: ms(14),
    fontWeight: "600",
    marginLeft: s(12),
  },
  inlineToastWrap: {
    position: "absolute" as const,
    top: s(8),
    left: 0,
    right: 0,
    alignItems: "center" as const,
    zIndex: 200,
  },
  inlineToastPill: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    borderRadius: 999,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
    maxWidth: "90%",
  },
  inlineToastText: {
    fontSize: ms(13),
    fontWeight: "600" as const,
  },
  tradeBlockPromptOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
    padding: s(24),
    zIndex: 100,
  },
  tradeBlockPromptCard: {
    borderRadius: 14,
    padding: s(20),
    width: "100%",
    maxWidth: s(340),
  },
  tradeBlockPromptTitle: {
    fontSize: ms(17),
    marginBottom: s(4),
  },
  tradeBlockPromptDesc: {
    fontSize: ms(13),
    marginBottom: s(12),
  },
  tradeBlockPromptInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    fontSize: ms(14),
    marginBottom: s(16),
  },
  tradeBlockPromptButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: s(8),
  },
  tradeBlockPromptBtn: {
    paddingHorizontal: s(16),
    paddingVertical: s(10),
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "transparent",
  },
});
