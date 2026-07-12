import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  NativeScrollEvent,
  NativeSyntheticEvent,
  PanResponder,
  ScrollView,
  View,
} from "react-native";

import { NextGameProjStrip } from "@/components/player/NextGameProjStrip";
import { PlayerActionBar } from "@/components/player/PlayerActionBar";
import { PlayerDetailHeader } from "@/components/player/PlayerDetailHeader";
import { PlayerGameLog, PlayerGameLogHeader } from "@/components/player/PlayerGameLog";
import { PlayerHistory } from "@/components/player/PlayerHistory";
import { PlayerInsightsCard } from "@/components/player/PlayerInsights";
import { PlayerNewsSection } from "@/components/player/PlayerNewsSection";
import { SeasonAverages } from "@/components/player/SeasonAverages";
import { Badge } from "@/components/ui/Badge";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { ThemedText } from "@/components/ui/ThemedText";
import { getCurrentSeason, getSeasonEnd, getSeasonStart } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useConfirm, useTextPrompt } from "@/context/ConfirmProvider";
import { useToast } from "@/context/ToastProvider";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useLeagueScoringType } from "@/hooks/useLeagueScoringType";
import { usePlayerGameLog } from "@/hooks/usePlayerGameLog";
import { usePlayerGameLogWithDnp } from "@/hooks/usePlayerGameLogWithDnp";
import { usePlayerHistoricalStats } from "@/hooks/usePlayerHistoricalStats";
import { usePlayerNews } from "@/hooks/usePlayerNews";
import { usePlayerProjections } from "@/hooks/usePlayerProjections";
import { usePlayerRankings } from "@/hooks/usePlayerRankings";
import { useWatchlist } from "@/hooks/useWatchlist";
import { sendNotification } from "@/lib/notifications";
import { capture } from "@/lib/posthog";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import {
  getSportToday,
  getSportTomorrow,
  nextSlateRollover,
} from "@/utils/leagueTime";
import { GameTimeMap, hasAnyGameStarted, isGameStarted, useTodayGameTimes } from "@/utils/nba/gameStarted";
import {
  formatGameInfo,
  liveToGameLog,
  useLivePlayerStats,
} from "@/utils/nba/nbaLive";
import { isOnline } from "@/utils/network";
import { addFreeAgent } from "@/utils/roster/addFreeAgent";
import { guardIllegalIR } from "@/utils/roster/illegalIR";
import { guardOverCap } from "@/utils/roster/overCap";
import { isEligibleForSlot } from "@/utils/roster/rosterSlots";
import { ROSTER_SLOT } from "@/utils/roster/rosterSlotsShared";
import { rosterAddDrop } from "@/utils/roster/rosterTransaction";
import { isTaxiEligible } from "@/utils/roster/taxiEligibility";
import { s } from "@/utils/scale";
import { calculateAvgFantasyPoints } from "@/utils/scoring/fantasyPoints";

import { DropPickerModal } from "./DropPickerModal";
import { playerDetailStyles as styles } from "./playerDetailStyles";

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
  /** Pre-fetched owner team name from parent - avoids flash while ownership query loads */
  ownerTeamName?: string;
  /** Lock mode passed from FreeAgentList for add-drop game-time checks */
  playerLockType?: "daily" | "individual";
  /** Today's game times passed from FreeAgentList */
  gameTimeMap?: GameTimeMap;
  /** When true, swap the "Add" CTA for "Draft" - used when this modal is
   *  opened from inside the draft room. Requires `onDraftPlayer`. */
  draftMode?: boolean;
  /** Whether the Draft button should be enabled (typically `isMyTurn && !isDrafting`). */
  canDraft?: boolean;
  /** Press handler for the Draft button. Parent owns the draftPlayer mutation. */
  onDraftPlayer?: (player: PlayerSeasonStats) => void;
  /** Suppresses the roster-action footer (Drop / IR / Taxi / Activate / trade
   *  block). Set when the modal is opened from the draft "My Team" tab, where
   *  lineup editing isn't valid mid-draft — mirrors the team-roster mirror page
   *  intentionally omitting quick actions. */
  hideRosterActions?: boolean;
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
  draftMode,
  canDraft,
  onDraftPlayer,
  hideRosterActions,
  gameTimeMap: parentGameTimeMap,
}: PlayerDetailModalProps) {
  const router = useRouter();
  const c = useColors();
  const sport = useActiveLeagueSport(leagueId);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const confirm = useConfirm();
  const promptInput = useTextPrompt();
  const { isWatchlisted, toggleWatchlist } = useWatchlist();

  const [isProcessing, setIsProcessing] = useState(false);
  const [showDropPicker, setShowDropPicker] = useState(false);
  const [activateFromIR, setActivateFromIR] = useState(false);
  const [insightsWindow, setInsightsWindow] = useState(10);

  const [gameLogExpanded, setGameLogExpanded] = useState(false);

  // Local in-modal toast - the global ToastProvider renders beneath the Modal
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
  // Merge in DNP rows for games the player's team played but he sat out (no
  // player_games row exists for injured/inactive players). Game-log table only.
  const gameLogWithDnp = usePlayerGameLogWithDnp(player?.pro_team, sport, gameLog);
  const { data: seasonProjections } = usePlayerProjections(sport, "season");
  const { data: nextGameProjections } = usePlayerProjections(sport, "next_game");
  const { data: historicalStats } = usePlayerHistoricalStats(
    player?.player_id ?? null,
  );
  const { data: playerNews, isLoading: isLoadingNews } = usePlayerNews(player?.player_id);

  // Fetch scoring type for insights branching
  const { scoringType: leagueScoringType, isCategories } =
    useLeagueScoringType(leagueId);
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

  // Check if player is owned by another team - use prop from parent if available, otherwise query
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
          .eq("roster_slot", ROSTER_SLOT.TAXI),
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
          .eq("position", ROSTER_SLOT.TAXI)
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

  // Fetch roster players for the drop picker (exclude IR - dropping them doesn't free active spots)
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
  const currentSeason = getCurrentSeason(sport);
  // Before the season tips off, the current-season box is empty — SeasonAverages
  // shows the season projection in its place. A missing start date (cache cold)
  // defaults to "started" so we never hide real averages on a stale config.
  const seasonStart = getSeasonStart(sport, currentSeason);
  const seasonStarted = !seasonStart || new Date().toISOString().slice(0, 10) >= seasonStart;
  const { data: teamGamesPlayed } = useQuery({
    queryKey: queryKeys.teamGamesPlayed(sport, currentSeason, player?.pro_team ?? ''),
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      // Cap at the regular-season end date so playoff games don't inflate the
      // denominator - player.games_played comes from BDL regular-season averages.
      const seasonEnd = getSeasonEnd(sport, currentSeason);
      const cutoff = seasonEnd && seasonEnd < today ? seasonEnd : today;
      let query = supabase
        .from("game_schedule")
        .select("id", { count: "exact", head: true })
        .eq("sport", sport)
        .eq("season", currentSeason)
        .or(`home_team.eq.${player!.pro_team},away_team.eq.${player!.pro_team}`)
        .lte("game_date", cutoff);
      // NBA games are stored twice: legacy NBA-official ids (game_id LIKE '00%',
      // incl. preseason) and the canonical BDL-internal ids that
      // sync-game-schedule + poll-live-stats maintain. Count only the canonical
      // rows so the total isn't doubled. WNBA has a single id scheme.
      if (sport === "nba") query = query.not("game_id", "like", "00%");
      const { count, error } = await query;
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!player,
  });

  // Game lock detection
  const gameTimeMap = useTodayGameTimes(!!player);
  const playerGameStarted = player
    ? isGameStarted(player.pro_team, gameTimeMap)
    : false;

  // Live stats for today's game
  const playerIdArr = player ? [player.player_id] : [];
  const liveMap = useLivePlayerStats(playerIdArr, !!player, sport);
  const liveStats = player ? (liveMap.get(player.player_id) ?? null) : null;

  // Next 3 upcoming games
  const { data: upcomingGames } = useQuery({
    queryKey: queryKeys.upcomingGames(sport, currentSeason, player?.pro_team ?? ''),
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from("game_schedule")
        .select("game_date, home_team, away_team, game_time_utc")
        .eq("sport", sport)
        .eq("season", currentSeason)
        .or(`home_team.eq.${player!.pro_team},away_team.eq.${player!.pro_team}`)
        .not("game_id", "like", "001%")
        .gte("game_date", today)
        .order("game_date", { ascending: true })
        .limit(4);
      if (error) throw error;
      return (data ?? []).map((g) => {
        const isHome = g.home_team === player!.pro_team;
        return {
          game_date: g.game_date as string,
          opponent: isHome ? g.away_team : g.home_team,
          prefix: isHome ? "vs" : "@",
          game_time_utc: g.game_time_utc as string | null,
        };
      });
    },
    enabled: !!player?.pro_team,
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
      (rosterInfo?.waiverType === "standard" ||
        rosterInfo?.waiverType === "faab"),
  });

  if (!player) return null;

  const waiverType = rosterInfo?.waiverType ?? "none";
  // A player is only biddable/claimable while sitting on the waiver wire after
  // being dropped. Never-rostered free agents (and players who clear with no
  // bid) are instant adds in every waiver mode.
  const needsWaiverClaim = waiverType !== "none" && (playerOnWaivers ?? false);

  const rosterIsFull = rosterInfo
    ? rosterInfo.activeCount >= rosterInfo.maxSize
    : false;

  const canMoveToIR = rosterInfo
    ? (player.status === "OUT" || player.status === "SUSP") &&
      rosterInfo.irSlotCount > 0 &&
      rosterInfo.irCount < rosterInfo.irSlotCount
    : false;

  const avgFpts = scoringWeights
    ? calculateAvgFantasyPoints(player, scoringWeights, sport)
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
    queryClient.invalidateQueries({
      queryKey: ["illegal-ir", leagueId, teamId],
    });
    queryClient.invalidateQueries({
      queryKey: ["over-cap", leagueId, teamId],
    });
    onRosterChange?.();
  };

  // Submit a waiver claim natively (used when no external callback is provided)
  const submitWaiverClaim = async (dropPlayerId?: string) => {
    if (!teamId || !player) return;

    const { data: existingClaim } = await supabase
      .from("waiver_claims")
      .select("id")
      .eq("league_id", leagueId)
      .eq("team_id", teamId)
      .eq("player_id", player.player_id)
      .eq("status", "pending")
      .maybeSingle();
    if (existingClaim) {
      throw new Error(
        "You already have a pending claim for this player. Cancel the existing claim before submitting a new one.",
      );
    }

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

    // If this player requires a waiver claim, delegate to the claim callback
    // or handle natively if no callback provided
    if (needsWaiverClaim) {
      if (rosterIsFull) {
        setShowDropPicker(true);
        return;
      }
      // IR/over-cap lockout preflight - only reached once we know this isn't
      // routing through the drop picker. (When it does, the picker's own drop
      // handlers already guard + exempt the chosen drop target - guarding
      // here first would block that resolution before the picker ever opens.)
      if (!(await guardIllegalIR(leagueId, teamId))) return;
      if (!(await guardOverCap(leagueId, teamId))) return;
      if (onClaimPlayer) {
        onClaimPlayer();
        return;
      }
      // No callback - handle the claim natively
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
          .eq("roster_slot", ROSTER_SLOT.TAXI),
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

      // IR/over-cap lockout preflight - only reached once we know this is a
      // direct add with no drop picker involved.
      if (!(await guardIllegalIR(leagueId, teamId))) {
        setIsProcessing(false);
        return;
      }
      if (!(await guardOverCap(leagueId, teamId))) {
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
          pro_team: player.pro_team ?? "",
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

    // A pure drop always shrinks the roster, so it's allowed even while the
    // team is IR-locked or over cap — dropping from anywhere is how you clear
    // those states. Only the *add* half of an add-and-drop stays gated: the IR
    // lock exists to discourage acquiring players while healthy guys sit on IR.
    // Exempt the dropped player so dropping the illegal-IR player itself (as
    // the add+drop's drop) still resolves the lock.
    const isAddDrop = !!playerToDrop && !!player;
    if (
      isAddDrop &&
      !(await guardIllegalIR(leagueId, teamId, [dropping.player_id]))
    ) {
      return;
    }

    setIsProcessing(true);
    try {
      // The dropped player's game may already be underway. Queue the drop for
      // the next rollover so they still score today, and defer the add with it
      // so the team never sits over its roster size for a day. A PURE drop
      // always applies immediately — that's how a GM clears an over-cap or IR
      // lock, so it can't wait for tomorrow.
      const queueDrop =
        isAddDrop && !!parentGameTimeMap && !!playerLockType
          ? playerLockType === "daily"
            ? hasAnyGameStarted(parentGameTimeMap)
            : isGameStarted(dropping.pro_team, parentGameTimeMap)
          : false;

      // The incoming player's own lock. Only consulted when the drop isn't
      // queued — a queued drop defers the add regardless.
      const addGameTimes = parentGameTimeMap ?? gameTimeMap;
      const deferAdd =
        isAddDrop && !queueDrop && playerLockType === "daily"
          ? hasAnyGameStarted(addGameTimes)
          : isAddDrop && !queueDrop && playerLockType === "individual"
            ? isGameStarted(player!.pro_team ?? "", addGameTimes)
            : false;

      // One transaction: lineup markers, the roster delete, the waiver
      // placement, the roster-size/position guard, the add, and both ledger
      // entries. If the add is rejected — roster full, position cap, or someone
      // else claimed the player first — the drop rolls back with it and the
      // dropped player stays on the roster. This used to be nine separate
      // commits, and a rejected add left the dropped player gone for good.
      const result = await rosterAddDrop({
        leagueId,
        teamId,
        addPlayerId: isAddDrop ? player!.player_id : undefined,
        dropPlayerId: dropping.player_id,
        deferAdd,
        queueDrop,
        groupId: isAddDrop ? Crypto.randomUUID() : undefined,
      });

      // One push for the whole move, so an add+drop reads as a single event.
      (async () => {
        const { data: team } = await supabase
          .from("teams")
          .select("name")
          .eq("id", teamId)
          .single();
        const who = team?.name ?? "A team";
        sendNotification({
          league_id: leagueId,
          category: "roster_moves",
          title: "Roster Move",
          body: !isAddDrop
            ? `${who} dropped ${dropping.name}`
            : result.queued_drop
              ? `${who} added ${player!.name} (dropping ${dropping.name} tomorrow)`
              : `${who} added ${player!.name} (dropped ${dropping.name})`,
          data: { screen: "activity" },
        });
      })();

      if (isAddDrop) {
        capture("player_add_drop", { added: player!.name, dropped: dropping.name });
        if (result.queued_drop) {
          Alert.alert(
            "Add/Drop",
            `${player!.name} will appear on your roster tomorrow. ${dropping.name} will be dropped tomorrow (currently in lineup).`,
          );
        } else if (result.deferred) {
          Alert.alert(
            "Player Added",
            `${player!.name} will appear on your roster tomorrow.`,
          );
        }
      } else {
        capture("player_dropped", { player_name: dropping.name });
      }

      invalidateRosterQueries();
      queryClient.invalidateQueries({
        queryKey: queryKeys.leagueWaivers(leagueId),
      });
      setShowDropPicker(false);
      onClose();
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
      const today = getSportToday(sport);

      // Check if the player's game is in progress - defer to tomorrow if so
      const isLocked =
        (playerLockType === "daily" && hasAnyGameStarted(parentGameTimeMap ?? gameTimeMap)) ||
        (playerLockType === "individual" && playerGameStarted);

      if (isLocked) {
        const tomorrowStr = getSportTomorrow(sport);

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
          `${player.name}'s game has started. The move to IR takes effect tomorrow.`,
        );
        onClose();
        return;
      }

      // No game lock - move immediately
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
          .eq("roster_slot", ROSTER_SLOT.TAXI),
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

      const today = getSportToday(sport);

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
      // Flip any future daily_lineups from IR -> BE
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
      // ---- Snapshot & drop the selected player ----
      const today = getSportToday(sport);
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
            roster_slot: ROSTER_SLOT.DROPPED,
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

      // Place on waivers - slate-anchored expiry, matches handleDropPlayer.
      const wt = rosterInfo?.waiverType ?? "none";
      const wpDays = rosterInfo?.waiverPeriodDays ?? 2;
      if (wt !== "none" && wpDays > 0) {
        const until = nextSlateRollover(sport);
        until.setUTCDate(until.getUTCDate() + (wpDays - 1));
        await supabase.from("league_waivers").insert({
          league_id: leagueId,
          player_id: playerToDrop.player_id,
          on_waivers_until: until.toISOString(),
          dropped_by_team_id: teamId,
        });
      }

      // ---- Activate from IR into the dropped player's slot (if eligible) ----
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
      // Flip any future daily_lineups from IR -> destSlot
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

      // ---- Transaction log ----
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
        .update({ roster_slot: ROSTER_SLOT.TAXI })
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
    confirm({
      title: "Promote from Taxi",
      message: `Move ${player.name} to bench? This is permanent - they cannot return to the taxi squad.`,
      action: {
        label: "Promote",
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
    });
  };

  const handleToggleTradeBlock = () => {
    if (!teamId || !player) return;
    if (!isOnTradeBlock) {
      // Adding - prompt for asking price / note
      promptInput({
        title: "Add to Trade Block",
        message: "What are you looking for? (optional)",
        placeholder: 'e.g. "2nd Rounder", "Wing player"',
        defaultValue: ownershipInfo?.tradeBlockNote ?? "",
        maxLength: 100,
        action: {
          label: "Add",
          onSubmit: (note) =>
            submitTradeBlockUpdate(true, note.trim() || null),
        },
      });
    } else {
      // Removing
      confirm({
        title: "Remove from Trade Block",
        message: `Remove ${player.name} from the trade block?`,
        action: {
          label: "Remove",
          onPress: () => submitTradeBlockUpdate(false, null),
        },
      });
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
    // A queued drop is a pure drop (deferred to tomorrow because the player's
    // game already started) — it only shrinks the roster, so it's always
    // allowed, even while the team is IR-locked or over cap.
    setIsProcessing(true);
    try {
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

      // Slate-anchored: cron fires at the precise next 5am ET rollover, and
      // the DROPPED daily_lineups marker uses the tomorrow slate date.
      const executeAfter = nextSlateRollover(sport).toISOString();

      const { error } = await supabase.from("pending_transactions").insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: player.player_id,
        action_type: "drop",
        execute_after: executeAfter,
        status: "pending",
      });
      if (error) throw error;

      // Write daily_lineups markers so the dropped player vanishes from
      // tomorrow's roster view immediately.
      try {
        const todaySlate = getSportToday(sport);
        const tomorrowSlate = getSportTomorrow(sport);
        const { data: weekRow } = await supabase
          .from("league_schedule")
          .select("start_date")
          .eq("league_id", leagueId)
          .lte("start_date", todaySlate)
          .gte("end_date", todaySlate)
          .single();

        const { data: droppingLp } = await supabase
          .from("league_players")
          .select("roster_slot")
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", player.player_id)
          .single();
        const droppingSlot = droppingLp?.roster_slot ?? "BE";

        if (weekRow) {
          await supabase.from("daily_lineups").upsert(
            {
              league_id: leagueId,
              team_id: teamId,
              player_id: player.player_id,
              lineup_date: weekRow.start_date,
              roster_slot: droppingSlot,
            },
            {
              onConflict: "team_id,player_id,lineup_date",
              ignoreDuplicates: true,
            },
          );
        }

        await supabase.from("daily_lineups").upsert(
          {
            league_id: leagueId,
            team_id: teamId,
            player_id: player.player_id,
            lineup_date: tomorrowSlate,
            roster_slot: ROSTER_SLOT.DROPPED,
          },
          { onConflict: "team_id,player_id,lineup_date" },
        );

        await supabase
          .from("daily_lineups")
          .delete()
          .eq("league_id", leagueId)
          .eq("team_id", teamId)
          .eq("player_id", player.player_id)
          .gt("lineup_date", tomorrowSlate);
      } catch (lineupErr) {
        console.warn(
          "Failed to write queued-drop daily_lineups markers - roster will reconcile when cron runs:",
          lineupErr,
        );
      }

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
  // Dropping and activating-from-IR reshape the team's OWN roster (no free-agent
  // acquisition), so they stay available even in the offseason — that's how a
  // team trims an over-sized imported roster back to the cap and legalizes
  // healthy players stranded on IR. Adds/promotions/IR/taxi assignments remain
  // gated by canTransact; a live draft or an in-flight mutation still blocks.
  const canManageRoster = !!teamId && !hasActiveDraft && !isProcessing;

  const handleSubmitWaiverClaimFromDropPicker = async (
    dropPlayerId?: string,
  ) => {
    if (!teamId) return;
    // Exempt the chosen drop target — if that player is the illegal-IR (or
    // over-cap) one, this claim resolves the lockout for them once it
    // processes. Any other illegal-IR/over-cap players still block. (The
    // upfront guard was removed from handleAddPlayer so the drop picker can
    // open while locked; the terminal handler re-checks with the exemption.)
    const exempt = dropPlayerId ? [dropPlayerId] : [];
    if (!(await guardIllegalIR(leagueId, teamId, exempt))) return;
    if (!(await guardOverCap(leagueId, teamId, exempt))) return;
    setIsProcessing(true);
    try {
      await submitWaiverClaim(dropPlayerId);
    } finally {
      setIsProcessing(false);
    }
  };

  if (showDropPicker && player) {
    return (
      <DropPickerModal
        player={player}
        rosterPlayers={rosterPlayers}
        isProcessing={isProcessing}
        activateFromIR={activateFromIR}
        startInDropPicker={startInDropPicker}
        startInActivateFromIR={startInActivateFromIR}
        needsWaiverClaim={needsWaiverClaim}
        scoringWeights={scoringWeights}
        isCategories={isCategories}
        playerLockType={playerLockType}
        gameTimeMap={gameTimeMap}
        translateY={translateY}
        panHandlers={panResponder.panHandlers}
        onClose={handleClose}
        onDismissDropPicker={() => {
          setShowDropPicker(false);
          setActivateFromIR(false);
        }}
        onDropForClaim={onDropForClaim}
        onDropAndActivateFromIR={handleDropAndActivateFromIR}
        onDropPlayer={handleDropPlayer}
        onSubmitWaiverClaim={handleSubmitWaiverClaimFromDropPicker}
      />
    );
  }

  const hasMinutesRestriction =
    playerNews?.some((a) => a.has_minutes_restriction) ?? false;
  const isTaxiSlot = playerRosterSlot === ROSTER_SLOT.TAXI;
  const canShowIR =
    canMoveToIR &&
    !playerGameStarted &&
    playerRosterSlot !== "IR" &&
    playerRosterSlot !== ROSTER_SLOT.TAXI;
  const canMoveToTaxi =
    !!rosterInfo &&
    rosterInfo.taxiSlotCount > 0 &&
    rosterInfo.taxiCount < rosterInfo.taxiSlotCount &&
    playerRosterSlot !== ROSTER_SLOT.TAXI &&
    playerRosterSlot !== "IR" &&
    (!playerRosterSlot || playerRosterSlot === "BE") &&
    isTaxiEligible(player.draft_year, rosterInfo.season, rosterInfo.taxiMaxExperience);
  const canTrade = !!teamId && !isFreeAgent && playerRosterSlot !== "IR";
  const showFooter =
    !hideRosterActions &&
    !!teamId &&
    ownershipInfo !== undefined &&
    (isOnMyTeam || !!draftMode || isFreeAgent);

  const handleToggleWatch = () => {
    const wasWatched = isWatchlisted(player.player_id);
    toggleWatchlist(player.player_id);
    showInlineToast(wasWatched ? "Removed from watchlist" : "Added to watchlist");
  };

  const handleTradePress = () => {
    handleClose();
    router.push({
      pathname: "/trades",
      params: {
        proposeTeamId: isOwnedByOther ? ownerTeamId ?? undefined : undefined,
        proposePlayerId: player.player_id,
        proposePlayerName: player.name,
        proposePlayerPos: player.position,
        proposePlayerTeam: player.pro_team,
        proposePlayerFpts: avgFpts != null ? String(avgFpts) : undefined,
        proposePlayerExternalId: player.external_id_nba ?? undefined,
      },
    });
  };

  const handleDropPress = () => {
    if (playerGameStarted) {
      confirm({
        title: "Drop Player",
        message: `${player.name}'s game has started. Drop will be queued for tomorrow.`,
        action: { label: "Drop", destructive: true, onPress: () => handleQueueDrop() },
      });
    } else {
      confirm({
        title: "Drop Player",
        message: `Are you sure you want to drop ${player.name}?`,
        action: { label: "Drop", destructive: true, onPress: () => handleDropPlayer() },
      });
    }
  };

  // Games remaining for this player's team between now and Sunday.
  const gamesThisWeek = (() => {
    if (!upcomingGames || upcomingGames.length === 0) return 0;
    const now = new Date();
    const day = now.getDay();
    const daysUntilSunday = day === 0 ? 0 : 7 - day;
    const endOfWeek = new Date(now);
    endOfWeek.setDate(now.getDate() + daysUntilSunday);
    const endStr = endOfWeek.toISOString().slice(0, 10);
    return upcomingGames.filter((g) => g.game_date <= endStr).length;
  })();

  const gameLogColors = {
    border: c.border,
    secondaryText: c.secondaryText,
    accent: c.accent,
  };

  // Insights need at least 5 played games (matches calculatePlayerInsights /
  // calculateCategoryInsights). Gate the eyebrow so it never orphans above an
  // empty card; the wrapper View still renders so the sticky index stays put.
  // Suppressed for NFL — the insight engine (B2B, schedule density, basketball
  // stat trends) has no NFL analogue in v1.
  const hasInsights =
    sport !== "nfl" && (gameLog ?? []).filter((g) => g.min > 0).length >= 5;

  return (
    <BottomSheet
      visible={!!player}
      onClose={handleClose}
      title={null}
      scrollableBody={false}
      height="92%"
      bodyStyle={styles.body}
      footer={
        showFooter ? (
          <PlayerActionBar
            playerName={player.name}
            isOnMyTeam={isOnMyTeam}
            isFreeAgent={isFreeAgent}
            draftMode={!!draftMode}
            playerRosterSlot={playerRosterSlot}
            isTaxiSlot={isTaxiSlot}
            isProcessing={isProcessing}
            canTransact={canTransact}
            canManageRoster={canManageRoster}
            canAdd={canAdd}
            canDraft={!!canDraft}
            needsWaiverClaim={needsWaiverClaim}
            playerGameStarted={playerGameStarted}
            canMoveToIR={canShowIR}
            canMoveToTaxi={canMoveToTaxi}
            isOnTradeBlock={isOnTradeBlock}
            onAdd={handleAddPlayer}
            onDraft={() => {
              if (!canDraft || !onDraftPlayer) return;
              onDraftPlayer(player);
              onClose();
            }}
            onActivateFromIR={handleActivateFromIR}
            onPromoteFromTaxi={handlePromoteFromTaxi}
            onDrop={handleDropPress}
            onMoveToIR={handleMoveToIR}
            onMoveToTaxi={handleMoveToTaxi}
            onToggleTradeBlock={handleToggleTradeBlock}
          />
        ) : undefined
      }
    >
      <View style={styles.bodyInner}>
        <PlayerDetailHeader
          player={player}
          sport={sport}
          teamGamesPlayed={teamGamesPlayed}
          hasMinutesRestriction={hasMinutesRestriction}
          ownership={{
            isOnMyTeam,
            isOwnedByOther,
            ownerName: resolvedOwnerName,
            isFreeAgent,
          }}
          lock={{
            draftLocked: !!hasActiveDraft,
            offseasonLocked: isOffseason && !hasActiveDraft,
          }}
          isWatched={isWatchlisted(player.player_id)}
          onToggleWatchlist={handleToggleWatch}
          canTrade={canTrade}
          onTrade={handleTradePress}
          onClose={handleClose}
        />

        <NextGameProjStrip
          projection={nextGameProjections?.get(player.player_id) ?? null}
          nextGame={upcomingGames?.[0] ?? null}
          scoringWeights={scoringWeights}
          isCategories={isCategories}
        />

        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          stickyHeaderIndices={[4]}
          showsVerticalScrollIndicator={false}
        >
          {/* 0 - Scoring Range (box plot) — the FPTS-distribution showcase, up
                 top. (Category insights for CAT leagues.) Always-present wrapper
                 keeps the sticky index stable. */}
          <View style={styles.sectionPad}>
            {hasInsights && (
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
                scoringType={leagueScoringType}
              />
            )}
          </View>

          {/* 1 - Averages — windowable box-score (recent windows + seasons),
                 with the situational splits strip. Ranks sit on the eyebrow. */}
          <View style={styles.sectionPad}>
            <View style={styles.eyebrowRow}>
              <View style={styles.eyebrowLeft}>
                <View style={[styles.goldRule, { backgroundColor: c.gold }]} />
                <ThemedText type="sectionLabel" accessibilityRole="header">
                  AVERAGES
                </ThemedText>
              </View>
              {rankings && !isCategories && (
                <View style={styles.rankBadges}>
                  <Badge label={`#${rankings.overallRank} OVR`} variant="gold" />
                  <Badge
                    label={`#${rankings.positionRank} ${rankings.primaryPosition}`}
                    variant="neutral"
                  />
                </View>
              )}
            </View>
            <SeasonAverages
              player={player}
              sport={sport}
              currentSeasonLabel={currentSeason}
              currentGamesDenominator={teamGamesPlayed}
              avgFpts={avgFpts}
              isCategories={isCategories}
              historicalStats={historicalStats}
              scoringWeights={scoringWeights}
              gameLog={gameLog}
              projection={seasonProjections?.get(player.player_id) ?? null}
              seasonStarted={seasonStarted}
            />
          </View>

          {/* 2 - News (outer View always present to keep the sticky index stable) */}
          <View style={styles.sectionPad}>
            <PlayerNewsSection news={playerNews} isLoading={isLoadingNews} />
          </View>

          {/* 3 - Game log eyebrow */}
          <View style={[styles.sectionPad, styles.eyebrowRow]}>
            <View style={styles.eyebrowLeft}>
              <View style={[styles.goldRule, { backgroundColor: c.gold }]} />
              <ThemedText type="sectionLabel" accessibilityRole="header">
                GAME LOG
              </ThemedText>
            </View>
            {gamesThisWeek > 0 && (
              <Badge
                label={`${gamesThisWeek} this week`}
                variant="neutral"
                size="small"
              />
            )}
          </View>

          {/* 4 - Sticky column header (pins to top of the body on scroll) */}
          <PlayerGameLogHeader
            scoringWeights={scoringWeights}
            isCategories={isCategories}
            sport={sport}
            headerScrollRef={gameLogHeaderScrollRef}
            backgroundColor={c.background}
            colors={gameLogColors}
          />

          {/* 5 - Game log body */}
          <PlayerGameLog
            gameLog={gameLogWithDnp}
            isLoading={isLoadingGameLog}
            scoringWeights={scoringWeights}
            sport={sport}
            upcomingGames={upcomingGames}
            liveStats={liveStats}
            liveToGameLog={(stats) => liveToGameLog(stats, sport)}
            formatGameInfo={formatGameInfo}
            playerName={player.name}
            expanded={gameLogExpanded}
            onExpand={() => setGameLogExpanded(true)}
            isCategories={isCategories}
            bodyScrollRef={gameLogBodyScrollRef}
            onBodyScroll={handleGameLogBodyScroll}
            projection={nextGameProjections?.get(player.player_id) ?? null}
            colors={gameLogColors}
          />

          {/* 6 - Transactions (moved below the game log; no side tabs) */}
          <View style={styles.txnWrap}>
            <View style={[styles.sectionPad, styles.eyebrowRow]}>
              <View style={styles.eyebrowLeft}>
                <View style={[styles.goldRule, { backgroundColor: c.gold }]} />
                <ThemedText type="sectionLabel" accessibilityRole="header">
                  TRANSACTIONS
                </ThemedText>
              </View>
            </View>
            <PlayerHistory playerId={player.player_id} leagueId={leagueId} />
          </View>
        </ScrollView>
      </View>

      {/* Inline toast - sits inside the sheet so it isn't hidden by the Modal */}
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
    </BottomSheet>
  );
}
