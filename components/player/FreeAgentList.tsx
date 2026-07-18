import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  View,
} from "react-native";

import { CompareBar } from "@/components/player/CompareBar";
import { FaabBidModal } from "@/components/player/FaabBidModal";
import {
  FreeAgentColumnKey,
  FreeAgentEmptyState,
  FreeAgentListHeader,
  FreeAgentOffseasonBanner,
} from "@/components/player/freeAgentListChrome";
import {
  SKELETON_COUNT,
  SkeletonRibbon,
  SkeletonRow,
} from "@/components/player/FreeAgentListSkeletons";
import { FreeAgentRow } from "@/components/player/FreeAgentRow";
import {
  FreeAgentStatusRibbon,
  type PendingClaim,
} from "@/components/player/FreeAgentStatusRibbon";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { WaiverOrderModal } from "@/components/player/WaiverOrderModal";
import { ProposeTradeModal } from "@/components/trade/ProposeTradeModal";
import { InfoModal } from "@/components/ui/InfoModal";
import { type ModalAction } from "@/components/ui/InlineAction";
import { SubmitOverlay } from "@/components/ui/SubmitOverlay";
import { getPreviousSeason } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useCompareSelection } from "@/context/CompareSelectionProvider";
import { useActionPicker, useConfirm } from "@/context/ConfirmProvider";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useLeagueScoringType } from "@/hooks/useLeagueScoringType";
import { TimeRange, usePlayerFilter } from "@/hooks/usePlayerFilter";
import { usePlayerProjections } from "@/hooks/usePlayerProjections";
import { useProjectionToggle } from "@/hooks/useProjectionToggle";
import { useRosterNeeds } from "@/hooks/useRosterNeeds";
import { useWatchlist } from "@/hooks/useWatchlist";
import { supabase, uniqueChannelTopic } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import {
  blendNflSeasonView,
  buildAdjustedPlayers,
  deriveMinutesUpPlayerIds,
} from "@/utils/freeAgent/freeAgentStats";
import { fetchSeasonPool } from "@/utils/freeAgent/seasonPool";
import {
  getWaiverBadgeLabel,
  isOnWaivers,
} from "@/utils/freeAgent/waiverLabels";
import { getSportToday } from "@/utils/leagueTime";
import { useTodayGameTimes } from "@/utils/nba/gameStarted";
import { fetchNbaScheduleForDate } from "@/utils/nba/nbaSchedule";
import { addFreeAgent } from "@/utils/roster/addFreeAgent";
import { guardIllegalIR } from "@/utils/roster/illegalIR";
import { guardOverCap } from "@/utils/roster/overCap";
import { checkPositionLimits } from "@/utils/roster/positionLimits";
import { fetchActiveRosterCount } from "@/utils/roster/rosterCounts";
import { countWeeklyAdds } from "@/utils/roster/weeklyAdds";
import { calculateAvgFantasyPoints, projAvgRowToFpts } from "@/utils/scoring/fantasyPoints";

import { freeAgentListStyles as styles } from "./freeAgentListStyles";

interface FreeAgentListProps {
  leagueId: string;
  teamId: string;
}

export function FreeAgentList({ leagueId, teamId }: FreeAgentListProps) {
  const c = useColors();
  const queryClient = useQueryClient();
  const {
    isCompareMode,
    selectedIds: compareSelectedIds,
    toggle: toggleCompare,
    setCompareMode,
  } = useCompareSelection();
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);
  const [openAsDropPicker, setOpenAsDropPicker] = useState(false);
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null);
  const [submitOverlayLabel, setSubmitOverlayLabel] = useState<string | null>(null);
  const pickAction = useActionPicker();
  const confirm = useConfirm();
  const [expandedSection, setExpandedSection] = useState<"claims" | null>(null);
  const toggleClaims = () =>
    setExpandedSection((prev) => (prev === "claims" ? null : "claims"));
  const [waiverOrderModalVisible, setWaiverOrderModalVisible] = useState(false);

  const [infoKey, setInfoKey] = useState<"acq" | null>(null);

  // FAAB bid modal state. The bid amount itself lives inside FaabBidModal —
  // keystrokes there must not re-render this whole list tree.
  const [faabModalPlayer, setFaabModalPlayer] =
    useState<PlayerSeasonStats | null>(null);
  const [faabDropPlayerId, setFaabDropPlayerId] = useState<string | null>(null);
  // Set when the FAAB modal is editing an existing pending bid (vs. placing a
  // new one). Drives an UPDATE of the claim's bid_amount instead of an INSERT.
  const [editingBidClaim, setEditingBidClaim] = useState<PendingClaim | null>(
    null,
  );

  const [timeRange, setTimeRange] = useState<TimeRange>("season");

  // Propose-trade target — set when the user taps the trade button on a
  // player rostered by another team. Holds the player plus the owning team
  // so the modal can pre-seed that team's side of the deal.
  const [tradeTarget, setTradeTarget] = useState<{
    player: PlayerSeasonStats;
    ownerTeamId: string;
  } | null>(null);

  const { data: scoringWeights } = useLeagueScoring(leagueId);

  // Detect category leagues to show cat stats instead of FPTS
  const { isCategories } = useLeagueScoringType(leagueId);

  // Projected next-game fpts shown beneath each row's season fpts (points
  // leagues), gated by the global projection toggle.
  const { enabled: projectionsEnabled } = useProjectionToggle();
  const projectionsActive = projectionsEnabled && !isCategories;

  // User-selected "playing on date" filter — null means filter is off
  const [playingOnDate, setPlayingOnDate] = useState<string | null>(null);

  const sport = useActiveLeagueSport(leagueId);
  const { data: projections } = usePlayerProjections(sport, 'next_game', projectionsActive);
  // Fetch schedule for the selected date (defaults to today so row badges still show)
  const todayStr = getSportToday(sport);
  const scheduleDate = playingOnDate ?? todayStr;
  const { data: todaySchedule } = useQuery({
    queryKey: [...queryKeys.todaySchedule(scheduleDate), sport],
    queryFn: () => fetchNbaScheduleForDate(scheduleDate, sport),
    staleTime: 1000 * 60 * 30,
  });

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
    enabled: !!leagueId,
    staleTime: 30_000,
  });

  const draftInProgress = hasActiveDraft ?? true;

  // Invalidate hasActiveDraft when draft status changes (e.g., draft completes)
  useEffect(() => {
    if (!leagueId) return;
    const channel = supabase
      .channel(uniqueChannelTopic(`fa_draft_status_${leagueId}`))
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "drafts",
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: queryKeys.hasActiveDraft(leagueId),
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, queryClient]);

  // Fetch roster info + league waiver settings
  const { data: rosterInfo } = useQuery({
    queryKey: queryKeys.freeAgentRosterInfo(leagueId, teamId),
    queryFn: async () => {
      const [allPlayersRes, irPlayersRes, leagueRes] = await Promise.all([
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
          .from("leagues")
          .select(
            "roster_size, waiver_type, offseason_step, weekly_acquisition_limit, player_lock_type, position_limits",
          )
          .eq("id", leagueId)
          .single(),
      ]);
      if (allPlayersRes.error) throw allPlayersRes.error;
      if (irPlayersRes.error) throw irPlayersRes.error;
      if (leagueRes.error) throw leagueRes.error;
      const activeCount =
        (allPlayersRes.count ?? 0) - (irPlayersRes.count ?? 0);
      return {
        activeCount,
        maxSize: leagueRes.data?.roster_size ?? 13,
        waiverType: (leagueRes.data?.waiver_type ?? "none") as
          | "standard"
          | "faab"
          | "none",
        offseasonStep: leagueRes.data?.offseason_step as string | null,
        weeklyAcquisitionLimit: leagueRes.data?.weekly_acquisition_limit as
          | number
          | null,
        playerLockType: (leagueRes.data?.player_lock_type ?? "daily") as
          | "daily"
          | "individual",
        positionLimits: leagueRes.data?.position_limits as
          | Record<string, number>
          | null,
      };
    },
    enabled: !!leagueId && !!teamId,
    placeholderData: (prev: any) => prev,
  });

  const rosterIsFull = rosterInfo
    ? rosterInfo.activeCount >= rosterInfo.maxSize
    : false;
  const waiverType = rosterInfo?.waiverType ?? "none";
  const isOffseason = rosterInfo?.offseasonStep != null;
  const weeklyLimit = rosterInfo?.weeklyAcquisitionLimit ?? null;
  const playerLockType = rosterInfo?.playerLockType ?? "daily";
  // The ribbon only carries pills when the league has a weekly add limit
  // and/or a waiver system; otherwise it's empty, so we skip it entirely.
  const hasRibbonContent = weeklyLimit != null || waiverType !== "none";

  const gameTimeMap = useTodayGameTimes(!isOffseason);

  // Adds used inside the league's current fantasy week — see countWeeklyAdds
  // (the window follows league_schedule, so NFL's Tue–Mon week is counted as
  // the week it is, not the calendar Mon–Sun one).
  const { data: weeklyAddsUsed } = useQuery({
    queryKey: queryKeys.weeklyAdds(leagueId, teamId),
    queryFn: () => countWeeklyAdds(leagueId, teamId, todayStr),
    enabled: !!leagueId && !!teamId && weeklyLimit != null,
    placeholderData: (prev: any) => prev,
  });

  const weeklyLimitReached =
    weeklyLimit != null && (weeklyAddsUsed ?? 0) >= weeklyLimit;

  // Fetch players currently on waivers in this league (with expiry times)
  const { data: waiverPlayerMap } = useQuery({
    queryKey: queryKeys.leagueWaivers(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("league_waivers")
        .select("player_id, on_waivers_until")
        .eq("league_id", leagueId)
        .gt("on_waivers_until", new Date().toISOString());
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of data ?? []) map.set(r.player_id, r.on_waivers_until);
      return map;
    },
    enabled: !!leagueId && waiverType !== "none",
  });

  // Fetch team's FAAB remaining (for FAAB mode)
  const { data: faabRemaining } = useQuery({
    queryKey: queryKeys.faabRemaining(leagueId, teamId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_priority")
        .select("faab_remaining")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .single();
      if (error) return null;
      return data?.faab_remaining ?? 0;
    },
    enabled: !!leagueId && !!teamId && waiverType === "faab",
  });

  // Fetch waiver priority order for all teams in the league (no dependency on rosterInfo)
  const { data: waiverOrder } = useQuery({
    queryKey: queryKeys.waiverOrder(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_priority")
        .select(
          "team_id, priority, faab_remaining, team:teams!waiver_priority_team_id_fkey(name)",
        )
        .eq("league_id", leagueId)
        .order("priority", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
  });

  // Net incoming players from this team's active pending trades. Used to
  // warn before adding a free agent that would push them over the limit
  // once a pending trade resolves. Mirrors the SQL in
  // assert_can_add_free_agent so the client surfaces the same answer.
  const { data: pendingTradeImpact } = useQuery({
    queryKey: queryKeys.pendingTradeRosterImpact(leagueId, teamId),
    queryFn: async () => {
      const ACTIVE_STATUSES = [
        "pending",
        "accepted",
        "in_review",
        "delayed",
        "pending_drops",
      ];
      const { data: proposals } = await supabase
        .from("trade_proposals")
        .select(
          "id, items:trade_proposal_items(player_id, from_team_id, to_team_id), teams:trade_proposal_teams(team_id, drop_player_ids)",
        )
        .eq("league_id", leagueId)
        .is("transaction_id", null)
        .in("status", ACTIVE_STATUSES);

      let netIncoming = 0;
      let queuedDrops = 0;
      for (const p of proposals ?? []) {
        for (const item of p.items ?? []) {
          if (!item.player_id) continue;
          if (item.to_team_id === teamId) netIncoming += 1;
          if (item.from_team_id === teamId) netIncoming -= 1;
        }
        for (const t of p.teams ?? []) {
          if (t.team_id === teamId) {
            queuedDrops += t.drop_player_ids?.length ?? 0;
          }
        }
      }
      return { netIncoming, queuedDrops };
    },
    enabled: !!leagueId && !!teamId,
  });

  // Fetch pending claims for this team
  const { data: pendingClaims } = useQuery({
    queryKey: queryKeys.pendingClaims(leagueId, teamId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_claims")
        .select(
          "id, player_id, drop_player_id, bid_amount, created_at, player:players!waiver_claims_player_id_fkey(name, position, pro_team)",
        )
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId && !!teamId && waiverType !== "none",
  });

  const { watchlistedIds } = useWatchlist();

  // Sport-scoped column select + null-coalescing live in fetchSeasonPool —
  // roughly half the payload of the old `select('*')` on ~93 columns.
  const { data: allPlayers, isLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: [...queryKeys.allPlayers(leagueId), sport],
    queryFn: () => fetchSeasonPool(sport),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });

  // Fetch rostered player IDs + team names for this league
  const { data: ownershipRows } = useQuery({
    queryKey: queryKeys.leagueOwnership(leagueId),
    queryFn: async () => {
      const [lpRes, teamsRes] = await Promise.all([
        supabase
          .from("league_players")
          .select("player_id, team_id, position, roster_slot")
          .eq("league_id", leagueId),
        supabase.from("teams").select("id, name").eq("league_id", leagueId),
      ]);
      if (lpRes.error) throw lpRes.error;
      if (teamsRes.error) throw teamsRes.error;
      const teamNames = new Map(
        (teamsRes.data ?? []).map((t) => [t.id, t.name as string]),
      );
      return (lpRes.data ?? []).map((r) => ({
        playerId: r.player_id as string,
        teamId: r.team_id as string,
        teamName: teamNames.get(r.team_id) ?? "Unknown",
        position: (r.position ?? "") as string,
        rosterSlot: (r.roster_slot ?? null) as string | null,
      }));
    },
    enabled: !!leagueId,
  });

  const rosteredPlayerIds = useMemo(
    () =>
      ownershipRows ? new Set(ownershipRows.map((r) => r.playerId)) : undefined,
    [ownershipRows],
  );

  const ownershipMap = useMemo(() => {
    if (!ownershipRows) return undefined;
    const map = new Map<string, { teamId: string; teamName: string }>();
    for (const row of ownershipRows) {
      map.set(row.playerId, { teamId: row.teamId, teamName: row.teamName });
    }
    return map;
  }, [ownershipRows]);

  // League-defined starter-slot config (PG: 1, G: 1, UTIL: 2, etc.).
  // Drives both the chip set and the per-position demand floor used to
  // flag "needs" / "thin" states in the roster-needs strip.
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId);
  const { chipPositions, myTeamCounts, positionStates } = useRosterNeeds(
    sport,
    rosterConfig,
    ownershipRows,
    teamId,
  );

  // Fetch the recent game logs that power the L5/L10/L15 windows. 45 days
  // comfortably contains 15 played games for an everyday player; the
  // DESC-ordered `limit` keeps the most-recent rows, so the last-N window is
  // never starved. Must include rostered players so they stay visible when the
  // user toggles off the "free agents only" pill. Gated to the game-window
  // ranges (same as the draft board) — the default season view doesn't read
  // these, and this was the single heaviest fetch on the screen.
  const allPlayerIds = useMemo(() => {
    if (!allPlayers) return [];
    return allPlayers.map((p) => p.player_id);
  }, [allPlayers]);
  const timeRangeNeedsLogs = timeRange !== "season" && timeRange !== "lastSeason";
  const { data: recentGameLogs } = useQuery({
    queryKey: queryKeys.recentGameLogs(leagueId),
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 45);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      // Batch into chunks of 200 IDs to stay within URL length limits
      const CHUNK = 200;
      const allRows: any[] = [];
      for (let i = 0; i < allPlayerIds.length; i += CHUNK) {
        const chunk = allPlayerIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("player_games")
          .select(
            'player_id, game_date, min, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double',
          )
          .in("player_id", chunk)
          .gte("game_date", cutoffStr)
          .order("game_date", { ascending: false })
          .limit(5000);
        if (error) throw error;
        if (data) allRows.push(...data);
      }
      return allRows;
    },
    enabled: !!leagueId && allPlayerIds.length > 0 && timeRangeNeedsLogs,
    staleTime: 1000 * 60 * 15,
  });

  // Lightweight minutes-only feed for the "Minutes Up" chip, so the chip
  // keeps working in the default season view without the 18-column stat logs
  // above (~6× less payload; same 45-day window and per-player 5-game walk).
  const { data: recentMinuteLogs } = useQuery({
    queryKey: [...queryKeys.recentGameLogs(leagueId), "minutes"],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 45);
      const cutoffStr = cutoff.toISOString().split("T")[0];
      const CHUNK = 200;
      const allRows: any[] = [];
      for (let i = 0; i < allPlayerIds.length; i += CHUNK) {
        const chunk = allPlayerIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("player_games")
          .select("player_id, min")
          .in("player_id", chunk)
          .gte("game_date", cutoffStr)
          .order("game_date", { ascending: false })
          .limit(5000);
        if (error) throw error;
        if (data) allRows.push(...data);
      }
      return allRows;
    },
    enabled: !!leagueId && allPlayerIds.length > 0,
    staleTime: 1000 * 60 * 15,
  });

  // Last-season averages for the `lastSeason` time-range pill. NFL keeps this
  // warm in the default season view too: with no NFL projections, last season
  // IS the thin-sample stat line + FPTS (see the blend below) — without it
  // every pre-season NFL row reads 0.0.
  const previousSeason = getPreviousSeason(sport);
  const { data: historicalStats } = useQuery({
    queryKey: [...queryKeys.freeAgentHistoricalStats(leagueId), sport, previousSeason],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_historical_stats")
        .select("*")
        .eq("sport", sport)
        .eq("season", previousSeason);
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId && (timeRange === "lastSeason" || sport === "nfl"),
    staleTime: 1000 * 60 * 30,
  });

  // Derive minutesUpPlayerIds from the light minutes feed (always loaded, so
  // the chip doesn't depend on which time range is selected)
  const minutesUpPlayerIds = useMemo(
    () => deriveMinutesUpPlayerIds(recentMinuteLogs, allPlayers),
    [recentMinuteLogs, allPlayers],
  );

  // Build time-range-adjusted player stats when a non-season range is selected
  const adjustedPlayers = useMemo(() => {
    const adjusted = buildAdjustedPlayers(allPlayers, recentGameLogs, historicalStats, timeRange, sport);
    // NFL default season view: blend last season onto thin-sample rows so the
    // list isn't 0.0 FPTS across the board pre-season — mirrors the draft
    // board and the autodraft bot's ranking chain.
    if (sport === "nfl" && timeRange === "season") {
      return blendNflSeasonView(adjusted, historicalStats);
    }
    return adjusted;
  }, [allPlayers, recentGameLogs, historicalStats, timeRange, sport]);

  const { filteredPlayers, filterBarProps } = usePlayerFilter(
    adjustedPlayers,
    scoringWeights,
    minutesUpPlayerIds,
    todaySchedule ?? undefined,
    watchlistedIds,
    rosteredPlayerIds,
    playingOnDate,
    setPlayingOnDate,
    leagueId,
    isCategories,
  );

  // Look up original season stats for PlayerDetailModal (avoid passing time-range-adjusted stats)
  const seasonStatsMap = useMemo(() => {
    if (!allPlayers) return new Map<string, PlayerSeasonStats>();
    return new Map(allPlayers.map((p) => [p.player_id, p]));
  }, [allPlayers]);

  // Alphabetical pro-team tricodes for the filter chip row. Built from the
  // full season pool (not the time-range-adjusted list) so the chip set
  // stays stable when the user switches Time Range.
  const availableProTeams = useMemo(() => {
    if (!allPlayers) return [] as string[];
    const set = new Set<string>();
    for (const p of allPlayers) {
      if (p.pro_team) set.add(p.pro_team);
    }
    return Array.from(set).sort();
  }, [allPlayers]);

  // Merged props for the shared list header (filter state + page extras +
  // compare toggle). Built once so the loading and loaded states stay in sync.
  const headerFilterBarProps = {
    ...filterBarProps,
    availableProTeams,
    timeRange,
    onTimeRangeChange: setTimeRange,
    compareMode: isCompareMode,
    onToggleCompareMode: () => setCompareMode(!isCompareMode),
  };

  const selectPlayer = useCallback(
    (player: PlayerSeasonStats) => {
      setSelectedPlayer(seasonStatsMap.get(player.player_id) ?? player);
    },
    [seasonStatsMap],
  );

  // Instant add (free agent, no waivers)
  const handleAddPlayer = async (player: PlayerSeasonStats) => {
    setAddingPlayerId(player.player_id);
    try {
      // Re-check roster limit and weekly acquisition limit before adding
      const [activeCount, leagueRes] = await Promise.all([
        fetchActiveRosterCount(leagueId, teamId),
        supabase
          .from("leagues")
          .select("roster_size, weekly_acquisition_limit, position_limits")
          .eq("id", leagueId)
          .single(),
      ]);
      const maxSize = leagueRes.data?.roster_size ?? 13;
      if (activeCount >= maxSize) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.freeAgentRosterInfo(leagueId, teamId),
        });
        setOpenAsDropPicker(true);
        setSelectedPlayer(player);
        setAddingPlayerId(null);
        return;
      }

      // IR/over-cap lockout preflight — only reached once we know this is a
      // direct add with no drop picker involved. (The picker's own drop
      // handlers already guard + exempt the chosen drop target.)
      if (!(await guardIllegalIR(leagueId, teamId))) {
        setAddingPlayerId(null);
        return;
      }
      if (!(await guardOverCap(leagueId, teamId))) {
        setAddingPlayerId(null);
        return;
      }

      // Pending-trade roster guard: block when an active pending trade
      // would push the team over the roster limit after this add. The
      // server-side RPC enforces the same rule; this gives a friendlier
      // pre-add message instead of an error toast after the round trip.
      const netIncoming = pendingTradeImpact?.netIncoming ?? 0;
      const queuedDrops = pendingTradeImpact?.queuedDrops ?? 0;
      const projected = activeCount + 1 + netIncoming - queuedDrops;
      if (projected > maxSize) {
        queryClient.invalidateQueries({
          queryKey: queryKeys.pendingTradeRosterImpact(leagueId, teamId),
        });
        Alert.alert(
          "Pending Trade Blocks Add",
          "You have a pending trade that would put you over your roster limit. Resolve the trade or drop a player first.",
        );
        setAddingPlayerId(null);
        return;
      }

      // Position limit check
      const posLimits = leagueRes.data?.position_limits as Record<string, number> | null;
      if (posLimits && Object.keys(posLimits).length > 0 && player.position) {
        const { data: rosterForLimits } = await supabase
          .from("league_players")
          .select("position, roster_slot")
          .eq("league_id", leagueId)
          .eq("team_id", teamId);
        const violation = checkPositionLimits(
          posLimits,
          (rosterForLimits ?? []).map((r) => ({ position: r.position, roster_slot: r.roster_slot ?? undefined })),
          player.position,
        );
        if (violation) {
          Alert.alert(
            "Position Limit Reached",
            `Your roster already has the maximum of ${violation.max} players eligible at ${violation.position}.`,
          );
          setAddingPlayerId(null);
          return;
        }
      }

      // Re-check the weekly add limit against fresh data (the pill above may be
      // stale if another device made an add). Same window the server enforces.
      const serverWeeklyLimit = leagueRes.data?.weekly_acquisition_limit as
        | number
        | null;
      if (serverWeeklyLimit != null) {
        const addsThisWeek = await countWeeklyAdds(leagueId, teamId, todayStr);

        if (addsThisWeek >= serverWeeklyLimit) {
          queryClient.invalidateQueries({
            queryKey: queryKeys.weeklyAdds(leagueId, teamId),
          });
          Alert.alert(
            "Acquisition Limit Reached",
            `You've used all ${serverWeeklyLimit} acquisitions for this week.`,
          );
          setAddingPlayerId(null);
          return;
        }
      }

      // Add the player (lock-aware: deferred adds get tomorrow's acquired_at)
      const { deferred } = await addFreeAgent({
        leagueId,
        teamId,
        player: {
          player_id: player.player_id,
          name: player.name,
          position: player.position,
          pro_team: player.pro_team ?? "",
        },
        playerLockType,
        gameTimeMap,
      });

      if (deferred) {
        Alert.alert(
          "Player Added",
          `${player.name} will appear on your roster tomorrow.`,
        );
      } else {
        setSubmitOverlayLabel("Added.");
      }

      queryClient.invalidateQueries({ queryKey: queryKeys.allPlayers(leagueId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.leagueOwnership(leagueId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.teamRoster(teamId) });
      queryClient.invalidateQueries({
        queryKey: queryKeys.freeAgentRosterInfo(leagueId, teamId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.rosterInfo(leagueId, teamId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.leagueRosterStats(leagueId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.weeklyAdds(leagueId, teamId),
      });

      // Warn if roster is now full and there are pending claims without a drop player
      if (activeCount + 1 >= maxSize && waiverType !== "none") {
        const vulnerableClaims = (pendingClaims ?? []).filter(
          (cl: any) => !cl.drop_player_id,
        );
        if (vulnerableClaims.length > 0) {
          const names = vulnerableClaims
            .map((cl: any) => cl.player?.name ?? "Unknown")
            .join(", ");
          Alert.alert(
            "Roster Full — Update Your Claims",
            `Your roster is now full. You have ${vulnerableClaims.length} pending waiver claim${vulnerableClaims.length > 1 ? "s" : ""} with no drop player (${names}). These claims will fail unless you add a drop player.`,
            [
              {
                text: "View Claims",
                onPress: () => setExpandedSection("claims"),
              },
              { text: "Dismiss" },
            ],
          );
        }
      }
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to add player");
    } finally {
      setAddingPlayerId(null);
    }
  };

  // Submit a waiver claim (standard mode)
  const handleSubmitClaim = async (
    player: PlayerSeasonStats,
    dropPlayerId?: string,
  ) => {
    // Warn if roster is full and no drop player selected
    if (rosterIsFull && !dropPlayerId) {
      const rosterFullActions: ModalAction[] = [
        {
          id: "add-drop",
          label: "Add Drop Player",
          icon: "person-remove-outline",
          onPress: () => {
            setClaimWithDropPlayer(player);
            setOpenAsDropPicker(true);
            setSelectedPlayer(player);
          },
        },
        {
          id: "submit-anyway",
          label: "Submit Anyway",
          icon: "arrow-forward-outline",
          destructive: true,
          onPress: () => submitClaim(player, undefined),
        },
      ];
      pickAction({
        title: "Roster Full",
        subtitle: "THIS CLAIM HAS NO DROP PLAYER",
        actions: rosterFullActions,
      });
      return;
    }
    submitClaim(player, dropPlayerId);
  };

  const submitClaim = async (
    player: PlayerSeasonStats,
    dropPlayerId?: string,
  ) => {
    if (pendingClaims?.some((c) => c.player_id === player.player_id)) {
      Alert.alert(
        "Claim Already Pending",
        `You already have a pending claim for ${player.name}. Cancel it before submitting a new one.`,
      );
      return;
    }
    // Exempt the chosen drop target — if *that* player is the illegal-IR (or
    // over-cap) one, this claim resolves the lockout for them once it
    // processes. Any other illegal-IR/over-cap players still block.
    const exempt = dropPlayerId ? [dropPlayerId] : [];
    if (!(await guardIllegalIR(leagueId, teamId, exempt))) return;
    if (!(await guardOverCap(leagueId, teamId, exempt))) return;
    setAddingPlayerId(player.player_id);
    try {
      // Get current waiver priority
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
        queryKey: queryKeys.pendingClaims(leagueId, teamId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.faabRemaining(leagueId, teamId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.waiverOrder(leagueId) });
      setSubmitOverlayLabel("Claim Submitted.");
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to submit claim");
    } finally {
      setAddingPlayerId(null);
    }
  };

  // Submit a FAAB bid
  const handleSubmitFaabBid = async (
    player: PlayerSeasonStats,
    bid: number,
    dropPlayerId?: string,
  ) => {
    if (rosterIsFull && !dropPlayerId) {
      Alert.alert(
        "Roster Full",
        "Your roster is full and this bid has no drop player. It will fail when processed. Select a drop player first.",
      );
      return;
    }
    if (pendingClaims?.some((c) => c.player_id === player.player_id)) {
      Alert.alert(
        "Bid Already Pending",
        `You already have a pending bid for ${player.name}. Cancel it before submitting a new one.`,
      );
      return;
    }
    // Exempt the chosen drop target — see submitClaim for rationale.
    const exempt = dropPlayerId ? [dropPlayerId] : [];
    if (!(await guardIllegalIR(leagueId, teamId, exempt))) return;
    if (!(await guardOverCap(leagueId, teamId, exempt))) return;
    setAddingPlayerId(player.player_id);
    try {
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
        bid_amount: bid,
        priority: wp?.priority ?? 99,
      });
      if (error) throw error;

      queryClient.invalidateQueries({
        queryKey: queryKeys.pendingClaims(leagueId, teamId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.faabRemaining(leagueId, teamId),
      });
      queryClient.invalidateQueries({ queryKey: queryKeys.waiverOrder(leagueId) });
      setSubmitOverlayLabel("Bid Placed.");
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to submit bid");
    } finally {
      setAddingPlayerId(null);
    }
  };

  // Cancel a pending claim
  const handleCancelClaim = async (claimId: string) => {
    const { error } = await supabase
      .from("waiver_claims")
      .update({ status: "cancelled" })
      .eq("id", claimId);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    queryClient.invalidateQueries({
      queryKey: queryKeys.pendingClaims(leagueId, teamId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.faabRemaining(leagueId, teamId),
    });
    queryClient.invalidateQueries({ queryKey: queryKeys.waiverOrder(leagueId) });
  };

  // State to track if the drop picker is in "claim with drop" mode
  const [claimWithDropPlayer, setClaimWithDropPlayer] =
    useState<PlayerSeasonStats | null>(null);

  // State for editing an existing claim's drop player
  const [editingClaimId, setEditingClaimId] = useState<string | null>(null);

  // Update the drop player on an existing claim
  const handleUpdateClaimDrop = async (
    claimId: string,
    dropPlayerId: string | null,
  ) => {
    const { error } = await supabase
      .from("waiver_claims")
      .update({ drop_player_id: dropPlayerId })
      .eq("id", claimId);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    setEditingClaimId(null);
    queryClient.invalidateQueries({
      queryKey: queryKeys.pendingClaims(leagueId, teamId),
    });
    Alert.alert(
      "Updated",
      dropPlayerId
        ? "Drop player updated on your claim."
        : "Drop player removed from your claim.",
    );
  };

  // Update the bid amount on an existing pending FAAB claim. The modal already
  // clamps the bid to (0, budget], so no extra validation is needed here.
  const handleUpdateClaimBid = async (claimId: string, bid: number) => {
    const { error } = await supabase
      .from("waiver_claims")
      .update({ bid_amount: bid })
      .eq("id", claimId);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    queryClient.invalidateQueries({
      queryKey: queryKeys.pendingClaims(leagueId, teamId),
    });
    queryClient.invalidateQueries({
      queryKey: queryKeys.faabRemaining(leagueId, teamId),
    });
    setSubmitOverlayLabel("Bid Updated.");
  };

  // Trigger the claim flow (standard or FAAB) for a player, optionally with a drop
  const triggerClaimFlow = (
    player: PlayerSeasonStats,
    dropPlayerId?: string,
  ) => {
    if (waiverType === "faab") {
      setFaabModalPlayer(player);
      // Store drop player id for when bid is submitted
      if (dropPlayerId) setFaabDropPlayerId(dropPlayerId);
    } else {
      confirm({
        title: "Submit Waiver Claim",
        message: `Claim ${player.name}?`,
        action: {
          label: "Submit",
          onPress: () => handleSubmitClaim(player, dropPlayerId),
        },
      });
    }
  };

  // Handle the add/claim button press
  const handleButtonPress = async (player: PlayerSeasonStats) => {
    // No upfront IR/over-cap preflight here: when the roster is full we route
    // into the drop picker below, and the user may pick the very illegal-IR
    // (or over-cap) player as the drop target — which resolves the lockout.
    // Guarding unconditionally here would block that resolution before the
    // picker ever opens. Each terminal handler (handleAddPlayer, submitClaim,
    // handleSubmitFaabBid) does its own guard, exempting the chosen drop
    // target when one is known.
    const needsClaim = isOnWaivers(player.player_id, waiverType, waiverPlayerMap);

    if (!needsClaim) {
      if (rosterIsFull) {
        setOpenAsDropPicker(true);
        selectPlayer(player);
      } else {
        handleAddPlayer(player);
      }
      return;
    }

    // Needs waiver claim
    if (rosterIsFull) {
      // Open drop picker in claim mode — player will be claimed, not instant added
      setClaimWithDropPlayer(player);
      setOpenAsDropPicker(true);
      selectPlayer(player);
    } else {
      triggerClaimFlow(player);
    }
  };

  // In compare mode a tap toggles selection; otherwise it opens the detail
  // modal. The snapshot carries the full (non-time-range-adjusted) season row
  // so the compare screen has real stats even for deep / non-top-600 players.
  const handleRowPress = (player: PlayerSeasonStats) => {
    if (isCompareMode) {
      const owner = ownershipMap?.get(player.player_id) ?? null;
      toggleCompare({
        player_id: player.player_id,
        name: player.name,
        position: player.position,
        pro_team: player.pro_team,
        external_id_nba: player.external_id_nba,
        seasonStats: seasonStatsMap.get(player.player_id) ?? player,
        ownerTag: owner?.teamName ?? null,
      });
    } else {
      selectPlayer(player);
    }
  };

  const handleTradePress = (player: PlayerSeasonStats) => {
    const owner = ownershipMap?.get(player.player_id);
    if (owner && owner.teamId !== teamId) {
      setTradeTarget({ player, ownerTeamId: owner.teamId });
    }
  };

  // Identity-stable dispatchers (latest-ref pattern) so the memo'd
  // FreeAgentRow isn't defeated by fresh closures on every list re-render.
  // The ref is refreshed post-commit (every render); handlers only fire on
  // user events, which always happen after commit.
  const rowHandlers = useRef({ handleRowPress, handleButtonPress, handleTradePress });
  useEffect(() => {
    rowHandlers.current = { handleRowPress, handleButtonPress, handleTradePress };
  });
  const onRowPress = useCallback(
    (p: PlayerSeasonStats) => rowHandlers.current.handleRowPress(p), []);
  const onRowAddOrClaim = useCallback(
    (p: PlayerSeasonStats) => rowHandlers.current.handleButtonPress(p), []);
  const onRowTrade = useCallback(
    (p: PlayerSeasonStats) => rowHandlers.current.handleTradePress(p), []);

  const listLength = filteredPlayers?.length ?? 0;
  const rowsDisabled = draftInProgress || isOffseason || weeklyLimitReached;
  const renderPlayer = useCallback(
    ({ item, index }: { item: PlayerSeasonStats; index: number }) => {
      const fpts =
        scoringWeights && !isCategories
          ? calculateAvgFantasyPoints(item, scoringWeights, sport)
          : undefined;
      const needsClaim = isOnWaivers(item.player_id, waiverType, waiverPlayerMap);
      const waiverLabel = needsClaim
        ? getWaiverBadgeLabel(item.player_id, waiverType, waiverPlayerMap)
        : null;
      const schedEntry = todaySchedule?.get(item.pro_team) ?? null;
      const gameToday = schedEntry?.matchup ?? null;
      // The next-game projection only makes sense when the player actually
      // plays on the selected day — gate on the schedule entry so it sits
      // beside the matchup chip instead of floating on no-game rows.
      const projRow =
        projectionsActive && gameToday ? projections?.get(item.player_id) : null;
      const projFpts =
        projRow && scoringWeights
          ? projAvgRowToFpts(projRow as Record<string, unknown>, scoringWeights, sport)
          : null;
      const owner = ownershipMap?.get(item.player_id) ?? null;
      // Only offer a trade when another team owns the player — never for the
      // user's own roster or unrostered free agents.
      const canTradeFor = owner != null && owner.teamId !== teamId;

      return (
        <FreeAgentRow
          player={item}
          index={index}
          isLast={index === listLength - 1}
          fpts={fpts}
          projFpts={projFpts}
          isCategories={isCategories}
          isAdding={addingPlayerId === item.player_id}
          needsClaim={needsClaim}
          waiverLabel={waiverLabel}
          gameToday={gameToday}
          isRostered={rosteredPlayerIds?.has(item.player_id) ?? false}
          ownerTeamName={owner?.teamName ?? null}
          sport={sport}
          isDisabled={rowsDisabled}
          compareMode={isCompareMode}
          compareSelected={compareSelectedIds.has(item.player_id)}
          onPress={onRowPress}
          onAddOrClaimPress={onRowAddOrClaim}
          canTrade={canTradeFor}
          onTradePress={onRowTrade}
        />
      );
    },
    [
      scoringWeights, isCategories, sport, waiverType, waiverPlayerMap,
      todaySchedule, projectionsActive, projections, ownershipMap,
      rosteredPlayerIds, teamId, addingPlayerId, rowsDisabled, listLength,
      isCompareMode, compareSelectedIds, onRowPress, onRowAddOrClaim, onRowTrade,
    ],
  );

  const openSlots = rosterInfo
    ? Math.max(0, rosterInfo.maxSize - rosterInfo.activeCount)
    : 0;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <FreeAgentListHeader
          chipPositions={chipPositions}
          rosterCounts={myTeamCounts}
          rosterStates={positionStates}
          openSlots={openSlots}
          filterBarProps={headerFilterBarProps}
        />
        <SkeletonRibbon color={c.border} />
        <View style={styles.listContent}>
          {Array.from({ length: SKELETON_COUNT }, (_, i) => (
            <SkeletonRow key={i} color={c.border} index={i} />
          ))}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FreeAgentListHeader
        chipPositions={chipPositions}
        rosterCounts={myTeamCounts}
        rosterStates={positionStates}
        openSlots={openSlots}
        filterBarProps={headerFilterBarProps}
      />

      {isOffseason && <FreeAgentOffseasonBanner />}

      {!isOffseason && hasRibbonContent && (
        <FreeAgentStatusRibbon
          weeklyLimit={weeklyLimit}
          weeklyAddsUsed={weeklyAddsUsed ?? 0}
          weeklyLimitReached={weeklyLimitReached}
          waiverType={waiverType}
          faabRemaining={faabRemaining ?? null}
          pendingClaims={pendingClaims ?? []}
          rosterIsFull={rosterIsFull}
          waiverPlayerMap={waiverPlayerMap}
          seasonStatsMap={seasonStatsMap}
          expandedSection={expandedSection}
          onToggleClaims={toggleClaims}
          onAcquisitionsInfoPress={() => setInfoKey('acq')}
          onWaiverOrderPress={() => setWaiverOrderModalVisible(true)}
          onRequestCancelClaim={(claim) =>
            confirm({
              title: 'Cancel Claim',
              message: 'Remove this waiver claim?',
              cancelLabel: 'Keep',
              action: {
                label: 'Cancel Claim',
                destructive: true,
                onPress: () => handleCancelClaim(claim.id),
              },
            })
          }
          onEditClaimBid={(claim) => {
            setEditingBidClaim(claim);
            setFaabModalPlayer(seasonStatsMap.get(claim.player_id) ?? null);
          }}
          onEditClaimDrop={(claim) => {
            setEditingClaimId(claim.id);
            setOpenAsDropPicker(true);
            setSelectedPlayer(seasonStatsMap.get(claim.player_id) ?? null);
          }}
        />
      )}

      {/* NFL rows carry their units inline ("245.1Y 1.9TD") and the stat mix
          varies by position, so the fixed basketball legend would be wrong. */}
      {sport !== "nfl" && (
        <View style={[styles.colKey, { borderBottomColor: c.border }]}>
          <FreeAgentColumnKey isCategories={isCategories} />
        </View>
      )}

      <FlatList<PlayerSeasonStats>
        data={filteredPlayers}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.player_id}
        contentContainerStyle={[
          styles.listContent,
          // Clear the floating compare bar so the last rows aren't hidden.
          isCompareMode && styles.listContentCompare,
        ]}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={5}
        ListEmptyComponent={<FreeAgentEmptyState />}
      />

      <CompareBar />

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId}
        teamId={teamId}
        ownerTeamName={
          (selectedPlayer && ownershipMap?.get(selectedPlayer.player_id)?.teamName) ?? undefined
        }
        playerLockType={playerLockType}
        gameTimeMap={gameTimeMap}
        onClose={() => {
          setSelectedPlayer(null);
          setOpenAsDropPicker(false);
          setClaimWithDropPlayer(null);
          setEditingClaimId(null);
        }}
        startInDropPicker={openAsDropPicker}
        onDropForClaim={
          claimWithDropPlayer || editingClaimId
            ? (dropPlayer) => {
                if (editingClaimId) {
                  handleUpdateClaimDrop(editingClaimId, dropPlayer.player_id);
                  setSelectedPlayer(null);
                  setOpenAsDropPicker(false);
                } else if (claimWithDropPlayer) {
                  triggerClaimFlow(claimWithDropPlayer, dropPlayer.player_id);
                  setClaimWithDropPlayer(null);
                }
              }
            : undefined
        }
        onClaimPlayer={
          selectedPlayer && isOnWaivers(selectedPlayer.player_id, waiverType, waiverPlayerMap)
            ? () => {
                triggerClaimFlow(selectedPlayer);
              }
            : undefined
        }
      />

      <FaabBidModal
        player={faabModalPlayer}
        isEditing={editingBidClaim != null}
        initialBid={editingBidClaim?.bid_amount ?? 0}
        faabRemaining={faabRemaining}
        onCancel={() => {
          setFaabModalPlayer(null);
          setFaabDropPlayerId(null);
          setEditingBidClaim(null);
        }}
        onSubmit={(player, bid) => {
          const editing = editingBidClaim;
          setFaabModalPlayer(null);
          if (editing) {
            setEditingBidClaim(null);
            handleUpdateClaimBid(editing.id, bid);
          } else {
            const dropId = faabDropPlayerId ?? undefined;
            setFaabDropPlayerId(null);
            handleSubmitFaabBid(player, bid, dropId);
          }
        }}
      />

      <InfoModal
        visible={infoKey === "acq"}
        onClose={() => setInfoKey(null)}
        title="Weekly Acquisitions"
        message="Player pickups used this matchup week. Once the limit is reached, no more free agent adds are allowed until next week."
      />

      <SubmitOverlay
        visible={submitOverlayLabel != null}
        label={submitOverlayLabel ?? ""}
        onDone={() => setSubmitOverlayLabel(null)}
      />

      <WaiverOrderModal
        visible={waiverOrderModalVisible}
        onClose={() => setWaiverOrderModalVisible(false)}
        waiverOrder={waiverOrder ?? []}
        teamId={teamId}
        waiverType={waiverType}
      />

      {tradeTarget && (
        <ProposeTradeModal
          leagueId={leagueId}
          teamId={teamId}
          preselectedTeamId={tradeTarget.ownerTeamId}
          preselectedPlayer={{
            player_id: tradeTarget.player.player_id,
            name: tradeTarget.player.name,
            position: tradeTarget.player.position,
            pro_team: tradeTarget.player.pro_team ?? "",
            external_id_nba: tradeTarget.player.external_id_nba,
          }}
          onClose={() => setTradeTarget(null)}
        />
      )}

    </View>
  );
}
