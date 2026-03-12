import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { PlayerFilterBar } from "@/components/player/PlayerFilterBar";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { TimeRange, usePlayerFilter } from "@/hooks/usePlayerFilter";
import { sendNotification } from "@/lib/notifications";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { calculateAvgFantasyPoints } from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/injuryBadge";
import { getPlayerHeadshotUrl, getTeamLogoUrl } from "@/utils/playerHeadshot";
import { fetchNbaScheduleForDate } from "@/utils/nbaSchedule";
import { toDateStr } from "@/utils/dates";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Animated,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const SKELETON_COUNT = 8;

function SkeletonRow({ color, index }: { color: string; index: number }) {
  const pulse = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
          delay: index * 60,
        }),
        Animated.timing(pulse, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={[styles.row, { borderBottomColor: color }]}>
      <Animated.View
        style={[styles.headshot, { backgroundColor: color, opacity: pulse, marginRight: 10 }]}
      />
      <View style={styles.info}>
        <Animated.View
          style={[styles.skeletonBar, { width: 120, backgroundColor: color, opacity: pulse }]}
        />
        <Animated.View
          style={[styles.skeletonBar, { width: 40, marginTop: 4, backgroundColor: color, opacity: pulse }]}
        />
      </View>
      <View style={styles.rightSide}>
        <View style={styles.stats}>
          <Animated.View
            style={[styles.skeletonBar, { width: 60, backgroundColor: color, opacity: pulse }]}
          />
          <Animated.View
            style={[styles.skeletonBar, { width: 44, marginTop: 4, backgroundColor: color, opacity: pulse }]}
          />
        </View>
        <Animated.View
          style={[styles.addButton, { backgroundColor: color, opacity: pulse }]}
        >
          <Text style={styles.addButtonText}> </Text>
        </Animated.View>
      </View>
    </View>
  );
}

function SkeletonWaiverHeader({ color }: { color: string }) {
  const pulse = useRef(new Animated.Value(0.3)).current;
  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: true }),
      ]),
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <View style={[styles.claimsHeader, { borderColor: color }]}>
      <View style={styles.claimsHeaderLeft}>
        <Animated.View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: color, opacity: pulse }} />
        <Animated.View style={[styles.skeletonBar, { width: 110, backgroundColor: color, opacity: pulse }]} />
      </View>
      <Animated.View style={{ width: 16, height: 16, borderRadius: 4, backgroundColor: color, opacity: pulse }} />
    </View>
  );
}

function FadeInImage({ uri, style, resizeMode }: { uri: string; style: any; resizeMode: any }) {
  const opacity = useRef(new Animated.Value(0)).current;
  return (
    <Animated.Image
      source={{ uri }}
      style={[style, { opacity }]}
      resizeMode={resizeMode}
      onLoad={() => {
        Animated.timing(opacity, {
          toValue: 1,
          duration: 250,
          useNativeDriver: true,
        }).start();
      }}
    />
  );
}

interface FreeAgentListProps {
  leagueId: string;
  teamId: string;
}

export function FreeAgentList({ leagueId, teamId }: FreeAgentListProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);
  const [openAsDropPicker, setOpenAsDropPicker] = useState(false);
  const [addingPlayerId, setAddingPlayerId] = useState<string | null>(null);
  const [showClaimsSection, setShowClaimsSection] = useState(false);
  const [showWaiverOrder, setShowWaiverOrder] = useState(false);

  // FAAB bid modal state
  const [faabModalPlayer, setFaabModalPlayer] = useState<PlayerSeasonStats | null>(null);
  const [bidAmount, setBidAmount] = useState("0");
  const [faabDropPlayerId, setFaabDropPlayerId] = useState<string | null>(null);

  const [timeRange, setTimeRange] = useState<TimeRange>('season');

  const { data: scoringWeights } = useLeagueScoring(leagueId);

  // Fetch today's NBA schedule for "playing today" indicator
  const todayStr = toDateStr(new Date());
  const { data: todaySchedule } = useQuery({
    queryKey: ["todaySchedule", todayStr],
    queryFn: () => fetchNbaScheduleForDate(todayStr),
    staleTime: 1000 * 60 * 30,
  });

  const { data: hasActiveDraft } = useQuery({
    queryKey: ["hasActiveDraft", leagueId],
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
  });

  const draftInProgress = hasActiveDraft ?? true;

  // Fetch roster info + league waiver settings
  const { data: rosterInfo } = useQuery({
    queryKey: ["rosterInfo", leagueId, teamId],
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
          .select("roster_size, waiver_type, waiver_day_of_week, offseason_step, weekly_acquisition_limit")
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
        waiverType: (leagueRes.data?.waiver_type ?? 'none') as 'standard' | 'faab' | 'none',
        waiverDayOfWeek: leagueRes.data?.waiver_day_of_week ?? 3,
        offseasonStep: leagueRes.data?.offseason_step as string | null,
        weeklyAcquisitionLimit: leagueRes.data?.weekly_acquisition_limit as number | null,
      };
    },
    enabled: !!leagueId && !!teamId,
  });

  const rosterIsFull = rosterInfo
    ? rosterInfo.activeCount >= rosterInfo.maxSize
    : false;
  const waiverType = rosterInfo?.waiverType ?? 'none';
  const isOffseason = rosterInfo?.offseasonStep != null;
  const weeklyLimit = rosterInfo?.weeklyAcquisitionLimit ?? null;

  // Count this week's acquisitions (Mon-Sun) for weekly limit enforcement
  const { data: weeklyAddsUsed } = useQuery({
    queryKey: ["weeklyAdds", leagueId, teamId],
    queryFn: async () => {
      const now = new Date();
      const day = now.getDay(); // 0=Sun
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayOffset);
      const weekStart = monday.toISOString().split("T")[0];

      const { count, error } = await supabase
        .from("league_transactions")
        .select("id", { count: "exact", head: true })
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("type", "waiver")
        .gte("created_at", weekStart + "T00:00:00");
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!leagueId && !!teamId && weeklyLimit != null,
  });

  const weeklyLimitReached = weeklyLimit != null && (weeklyAddsUsed ?? 0) >= weeklyLimit;

  // Fetch players currently on waivers in this league (with expiry times)
  const { data: waiverPlayerMap } = useQuery({
    queryKey: ["leagueWaivers", leagueId],
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
    enabled: !!leagueId && waiverType !== 'none',
  });

  // Fetch team's FAAB remaining (for FAAB mode)
  const { data: faabRemaining } = useQuery({
    queryKey: ["faabRemaining", leagueId, teamId],
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
    enabled: !!leagueId && !!teamId && waiverType === 'faab',
  });

  // Fetch waiver priority order for all teams in the league (no dependency on rosterInfo)
  const { data: waiverOrder, isLoading: waiverOrderLoading } = useQuery({
    queryKey: ["waiverOrder", leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_priority")
        .select("team_id, priority, faab_remaining, team:teams!waiver_priority_team_id_fkey(name)")
        .eq("league_id", leagueId)
        .order("priority", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
  });

  // Fetch pending claims for this team
  const { data: pendingClaims } = useQuery({
    queryKey: ["pendingClaims", leagueId, teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("waiver_claims")
        .select("id, player_id, bid_amount, created_at, player:players!waiver_claims_player_id_fkey(name, position, nba_team)")
        .eq("league_id", leagueId)
        .eq("team_id", teamId)
        .eq("status", "pending")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId && !!teamId && waiverType !== 'none',
  });

  const { data: freeAgents, isLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: ["freeAgents", leagueId],
    queryFn: async () => {
      const { data: rosteredPlayers, error: rpError } = await supabase
        .from("league_players")
        .select("player_id")
        .eq("league_id", leagueId);

      if (rpError) throw rpError;
      const rosteredIds =
        rosteredPlayers?.map((p) => String(p.player_id)) || [];

      let query = supabase
        .from("player_season_stats")
        .select("*")
        .gt("games_played", 0)
        .order("avg_pts", { ascending: false });

      if (rosteredIds.length > 0) {
        query = query.filter(
          "player_id",
          "not.in",
          `(${rosteredIds.join(",")})`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    enabled: !!leagueId,
  });

  // Fetch last 30 days of game logs for free agents (time-range stats + "Minutes Up" filter)
  const freeAgentIds = useMemo(() => freeAgents?.map(p => p.player_id) ?? [], [freeAgents]);
  const { data: recentGameLogs } = useQuery({
    queryKey: ["recentGameLogs", leagueId],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      // Batch into chunks of 200 IDs to stay within URL length limits
      const CHUNK = 200;
      const allRows: any[] = [];
      for (let i = 0; i < freeAgentIds.length; i += CHUNK) {
        const chunk = freeAgentIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("player_games")
          .select('player_id, game_date, min, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double')
          .in("player_id", chunk)
          .gte("game_date", cutoffStr)
          .order("game_date", { ascending: false })
          .limit(5000);
        if (error) throw error;
        if (data) allRows.push(...data);
      }
      return allRows;
    },
    enabled: !!leagueId && freeAgentIds.length > 0,
    staleTime: 1000 * 60 * 15,
  });

  // Derive recentMinutesMap from game logs (for "Minutes Up" filter)
  const recentMinutesMap = useMemo(() => {
    if (!recentGameLogs) return undefined;
    const playerGames = new Map<string, number[]>();
    for (const g of recentGameLogs) {
      if (g.min == null) continue;
      const mins = playerGames.get(g.player_id);
      if (!mins) {
        playerGames.set(g.player_id, [g.min]);
      } else if (mins.length < 5) {
        mins.push(g.min);
      }
    }
    const map = new Map<string, number>();
    for (const [pid, mins] of playerGames) {
      if (mins.length < 3) continue;
      const avg = mins.reduce((a, b) => a + b, 0) / mins.length;
      map.set(pid, Math.round(avg * 10) / 10);
    }
    return map;
  }, [recentGameLogs]);

  // Build time-range-adjusted player stats when a non-season range is selected
  const adjustedPlayers = useMemo(() => {
    if (!freeAgents) return undefined;
    if (timeRange === 'season' || !recentGameLogs) return freeAgents;

    const days = timeRange === '7d' ? 7 : timeRange === '14d' ? 14 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    // Group game logs by player within the time window
    const grouped = new Map<string, typeof recentGameLogs>();
    for (const g of recentGameLogs) {
      const gDate = (g.game_date ?? '').slice(0, 10);
      if (gDate < cutoffStr) continue;
      const arr = grouped.get(g.player_id);
      if (arr) arr.push(g);
      else grouped.set(g.player_id, [g]);
    }

    const round = (v: number) => Math.round(v * 10) / 10;

    return freeAgents
      .filter(p => grouped.has(p.player_id))
      .map(p => {
        const games = grouped.get(p.player_id)!;
        const gp = games.length;
        const t = { pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, fgm: 0, fga: 0, threepm: 0, threepa: 0, ftm: 0, fta: 0, pf: 0, min: 0, dd: 0, td: 0 };
        for (const g of games) {
          t.pts += g.pts ?? 0;
          t.reb += g.reb ?? 0;
          t.ast += g.ast ?? 0;
          t.stl += g.stl ?? 0;
          t.blk += g.blk ?? 0;
          t.tov += g.tov ?? 0;
          t.fgm += g.fgm ?? 0;
          t.fga += g.fga ?? 0;
          t.threepm += g['3pm'] ?? 0;
          t.threepa += g['3pa'] ?? 0;
          t.ftm += g.ftm ?? 0;
          t.fta += g.fta ?? 0;
          t.pf += g.pf ?? 0;
          t.min += g.min ?? 0;
          t.dd += g.double_double ? 1 : 0;
          t.td += g.triple_double ? 1 : 0;
        }
        return {
          ...p,
          games_played: gp,
          total_pts: t.pts, avg_pts: round(t.pts / gp),
          total_reb: t.reb, avg_reb: round(t.reb / gp),
          total_ast: t.ast, avg_ast: round(t.ast / gp),
          total_stl: t.stl, avg_stl: round(t.stl / gp),
          total_blk: t.blk, avg_blk: round(t.blk / gp),
          total_tov: t.tov, avg_tov: round(t.tov / gp),
          total_fgm: t.fgm, avg_fgm: round(t.fgm / gp),
          total_fga: t.fga, avg_fga: round(t.fga / gp),
          total_3pm: t.threepm, avg_3pm: round(t.threepm / gp),
          total_3pa: t.threepa, avg_3pa: round(t.threepa / gp),
          total_ftm: t.ftm, avg_ftm: round(t.ftm / gp),
          total_fta: t.fta, avg_fta: round(t.fta / gp),
          total_pf: t.pf, avg_pf: round(t.pf / gp),
          total_dd: t.dd, total_td: t.td,
          avg_min: round(t.min / gp),
        } as PlayerSeasonStats;
      });
  }, [freeAgents, recentGameLogs, timeRange]);

  const { filteredPlayers, filterBarProps } = usePlayerFilter(
    adjustedPlayers,
    scoringWeights,
    recentMinutesMap,
    todaySchedule ?? undefined,
  );

  // Look up original season stats for PlayerDetailModal (avoid passing time-range-adjusted stats)
  const seasonStatsMap = useMemo(() => {
    if (!freeAgents) return new Map<string, PlayerSeasonStats>();
    return new Map(freeAgents.map(p => [p.player_id, p]));
  }, [freeAgents]);

  const selectPlayer = (player: PlayerSeasonStats) => {
    setSelectedPlayer(seasonStatsMap.get(player.player_id) ?? player);
  };

  // Compute when a claim will process
  function getProcessDate(playerId: string): string {
    if (waiverType === 'standard') {
      const until = waiverPlayerMap?.get(playerId);
      if (until) {
        const d = new Date(until);
        return `${d.getMonth() + 1}/${d.getDate()}`;
      }
      return '—';
    }
    if (waiverType === 'faab') {
      const targetDay = rosterInfo?.waiverDayOfWeek ?? 3;
      const now = new Date();
      const currentDay = now.getDay();
      let daysUntil = targetDay - currentDay;
      if (daysUntil <= 0) daysUntil += 7;
      const next = new Date(now);
      next.setDate(now.getDate() + daysUntil);
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      return `${dayNames[targetDay]} ${next.getMonth() + 1}/${next.getDate()}`;
    }
    return '—';
  }

  // Determine if a player requires a waiver claim
  function isOnWaivers(playerId: string): boolean {
    if (waiverType === 'none') return false;
    if (waiverType === 'faab') return true; // FAAB: all adds go through bidding
    // Standard: only recently dropped players
    return waiverPlayerMap?.has(playerId) ?? false;
  }

  // Instant add (free agent, no waivers)
  const handleAddPlayer = async (player: PlayerSeasonStats) => {
    setAddingPlayerId(player.player_id);
    try {
      // Re-check roster limit before adding
      const [allRes, irRes, leagueRes] = await Promise.all([
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
          .select("roster_size")
          .eq("id", leagueId)
          .single(),
      ]);
      const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
      const maxSize = leagueRes.data?.roster_size ?? 13;
      if (activeCount >= maxSize) {
        queryClient.invalidateQueries({ queryKey: ["rosterInfo", leagueId, teamId] });
        setOpenAsDropPicker(true);
        setSelectedPlayer(player);
        setAddingPlayerId(null);
        return;
      }

      const { error: lpError } = await supabase.from("league_players").insert({
        league_id: leagueId,
        player_id: player.player_id,
        team_id: teamId,
        acquired_via: "free_agent",
        acquired_at: new Date().toISOString(),
        position: player.position,
      });

      if (lpError) throw lpError;

      const { data: txn, error: txnError } = await supabase
        .from("league_transactions")
        .insert({
          league_id: leagueId,
          type: "waiver",
          notes: `Added ${player.name} from free agency`,
          team_id: teamId,
        })
        .select("id")
        .single();

      if (txnError) throw txnError;

      await supabase.from("league_transaction_items").insert({
        transaction_id: txn.id,
        player_id: player.player_id,
        team_to_id: teamId,
      });

      // Fire-and-forget notification to league
      (async () => {
        const { data: team } = await supabase.from("teams").select("team_name").eq("id", teamId).single();
        sendNotification({
          league_id: leagueId,
          category: "roster_moves",
          title: "Roster Move",
          body: `${team?.team_name ?? "A team"} added ${player.name}`,
          data: { screen: "roster" },
        });
      })();

      queryClient.invalidateQueries({ queryKey: ["freeAgents", leagueId] });
      queryClient.invalidateQueries({ queryKey: ["teamRoster", teamId] });
      queryClient.invalidateQueries({ queryKey: ["rosterInfo", leagueId, teamId] });
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to add player");
    } finally {
      setAddingPlayerId(null);
    }
  };

  // Submit a waiver claim (standard mode)
  const handleSubmitClaim = async (player: PlayerSeasonStats, dropPlayerId?: string) => {
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

      queryClient.invalidateQueries({ queryKey: ["pendingClaims", leagueId, teamId] });
      queryClient.invalidateQueries({ queryKey: ["faabRemaining", leagueId, teamId] });
      queryClient.invalidateQueries({ queryKey: ["waiverOrder", leagueId] });
      Alert.alert("Claim Submitted", `Waiver claim for ${player.name} submitted.`);
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Failed to submit claim");
    } finally {
      setAddingPlayerId(null);
    }
  };

  // Submit a FAAB bid
  const handleSubmitFaabBid = async (player: PlayerSeasonStats, bid: number, dropPlayerId?: string) => {
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

      queryClient.invalidateQueries({ queryKey: ["pendingClaims", leagueId, teamId] });
      queryClient.invalidateQueries({ queryKey: ["faabRemaining", leagueId, teamId] });
      queryClient.invalidateQueries({ queryKey: ["waiverOrder", leagueId] });
      Alert.alert("Bid Submitted", `$${bid} bid for ${player.name} submitted.`);
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
    queryClient.invalidateQueries({ queryKey: ["pendingClaims", leagueId, teamId] });
    queryClient.invalidateQueries({ queryKey: ["faabRemaining", leagueId, teamId] });
    queryClient.invalidateQueries({ queryKey: ["waiverOrder", leagueId] });
  };

  // State to track if the drop picker is in "claim with drop" mode
  const [claimWithDropPlayer, setClaimWithDropPlayer] = useState<PlayerSeasonStats | null>(null);

  // Trigger the claim flow (standard or FAAB) for a player, optionally with a drop
  const triggerClaimFlow = (player: PlayerSeasonStats, dropPlayerId?: string) => {
    if (waiverType === 'faab') {
      setBidAmount("0");
      setFaabModalPlayer(player);
      // Store drop player id for when bid is submitted
      if (dropPlayerId) setFaabDropPlayerId(dropPlayerId);
    } else {
      Alert.alert(
        "Submit Waiver Claim",
        `Claim ${player.name}?${dropPlayerId ? '' : ''}`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Submit", onPress: () => handleSubmitClaim(player, dropPlayerId) },
        ],
      );
    }
  };

  // Handle the add/claim button press
  const handleButtonPress = (player: PlayerSeasonStats) => {
    const needsClaim = isOnWaivers(player.player_id);

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

  const renderPlayer = ({ item }: { item: PlayerSeasonStats }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : undefined;
    const isAdding = addingPlayerId === item.player_id;
    const headshotUrl = getPlayerHeadshotUrl(item.external_id_nba);
    const logoUrl = getTeamLogoUrl(item.nba_team);
    const badge = getInjuryBadge(item.status);
    const needsClaim = isOnWaivers(item.player_id);
    const gameToday = todaySchedule?.get(item.nba_team) ?? null;

    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: c.border }]}
        onPress={() => selectPlayer(item)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatPosition(item.position)}, ${item.nba_team}${fpts !== undefined ? `, ${fpts} fantasy points` : ''}`}
      >
        <View style={styles.portraitWrap}>
          {headshotUrl ? (
            <FadeInImage
              uri={headshotUrl}
              style={styles.headshot}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.headshot, { backgroundColor: c.border }]} />
          )}
          <View style={styles.teamPill}>
            {logoUrl && (
              <Image
                source={{ uri: logoUrl }}
                style={styles.teamPillLogo}
                resizeMode="contain"
              />
            )}
            <Text style={styles.teamPillText}>{item.nba_team}</Text>
          </View>
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText
              type="defaultSemiBold"
              numberOfLines={1}
              style={{ flexShrink: 1, fontSize: 14 }}
            >
              {item.name}
            </ThemedText>
            {badge && (
              <View style={[styles.badge, { backgroundColor: badge.color }]}>
                <Text style={styles.badgeText}>{badge.label}</Text>
              </View>
            )}
          </View>
          <View style={styles.posRow}>
            <ThemedText style={[styles.posText, { color: c.secondaryText }]}>
              {formatPosition(item.position)}
            </ThemedText>
            {gameToday && (
              <View style={styles.gameTodayBadge}>
                <Text style={styles.gameTodayText}>{gameToday}</Text>
              </View>
            )}
          </View>
        </View>

        <View style={styles.rightSide}>
          <View style={styles.stats}>
            <ThemedText style={[styles.statLine, { color: c.secondaryText }]}>
              {item.avg_pts}/{item.avg_reb}/{item.avg_ast}
            </ThemedText>
            {fpts !== undefined && (
              <ThemedText style={[styles.fpts, { color: c.accent }]}>
                {fpts} FPTS
              </ThemedText>
            )}
          </View>
          <TouchableOpacity
            style={[
              needsClaim ? styles.claimButton : styles.addButton,
              (isAdding || draftInProgress || isOffseason || weeklyLimitReached) && styles.addButtonDisabled,
            ]}
            onPress={() => handleButtonPress(item)}
            disabled={isAdding || draftInProgress || isOffseason || weeklyLimitReached}
            accessibilityRole="button"
            accessibilityLabel={needsClaim ? `Claim ${item.name}` : `Add ${item.name}`}
          >
            <ThemedText style={styles.addButtonText}>
              {needsClaim ? "Claim" : "+"}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const claimCount = pendingClaims?.length ?? 0;

  if (isLoading) {
    return (
      <View style={styles.container}>
        <PlayerFilterBar {...filterBarProps} timeRange={timeRange} onTimeRangeChange={setTimeRange} />
        {waiverOrderLoading && <SkeletonWaiverHeader color={c.border} />}
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
      <PlayerFilterBar {...filterBarProps} timeRange={timeRange} onTimeRangeChange={setTimeRange} />

      {isOffseason && (
        <View style={[styles.offseasonBanner, { backgroundColor: '#FF950022', borderColor: '#FF9500' }]}>
          <Ionicons name="lock-closed" size={14} color="#FF9500" />
          <ThemedText style={{ fontSize: 12, marginLeft: 6, color: c.secondaryText }}>
            Free agent transactions are locked during the offseason.
          </ThemedText>
        </View>
      )}

      {weeklyLimit != null && !isOffseason && (
        <View style={[styles.offseasonBanner, {
          backgroundColor: weeklyLimitReached ? '#dc354522' : '#007AFF12',
          borderColor: weeklyLimitReached ? '#dc3545' : '#007AFF',
        }]}>
          <Ionicons
            name={weeklyLimitReached ? "lock-closed" : "swap-horizontal"}
            size={14}
            color={weeklyLimitReached ? '#dc3545' : '#007AFF'}
          />
          <ThemedText style={{ fontSize: 12, marginLeft: 6, color: c.secondaryText }}>
            {weeklyLimitReached
              ? `Weekly add limit reached (${weeklyLimit}/${weeklyLimit})`
              : `Adds this week: ${weeklyAddsUsed ?? 0}/${weeklyLimit}`}
          </ThemedText>
        </View>
      )}

      {/* Pending Claims Header */}
      {claimCount > 0 && (
        <View>
          <TouchableOpacity
            style={[styles.claimsHeader, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => setShowClaimsSection(!showClaimsSection)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showClaimsSection }}
            accessibilityLabel={`Pending Claims, ${claimCount}`}
          >
            <View style={styles.claimsHeaderLeft}>
              <Ionicons name="time-outline" size={16} color="#D4A017" accessible={false} />
              <ThemedText style={styles.claimsHeaderText}>
                Pending Claims ({claimCount})
              </ThemedText>
            </View>
            <Ionicons
              name={showClaimsSection ? "chevron-up" : "chevron-down"}
              size={16}
              color={c.secondaryText}
            />
          </TouchableOpacity>
          {showClaimsSection && (
            <View style={[styles.claimsList, { backgroundColor: c.card, borderColor: c.border }]}>
              {pendingClaims!.map((claim: any) => (
                <View key={claim.id} style={[styles.claimRow, { borderBottomColor: c.border }]}>
                  <View style={{ flex: 1 }}>
                    <ThemedText style={{ fontSize: 13, fontWeight: '600' }}>
                      {claim.player?.name ?? 'Unknown'}
                    </ThemedText>
                    <ThemedText style={{ fontSize: 11, color: c.secondaryText }}>
                      {claim.player?.position} - {claim.player?.nba_team}
                      {waiverType === 'faab' ? ` | $${claim.bid_amount} bid` : ''}
                      {' · Processes ' + getProcessDate(claim.player_id)}
                    </ThemedText>
                  </View>
                  <TouchableOpacity
                    onPress={() =>
                      Alert.alert("Cancel Claim", "Remove this waiver claim?", [
                        { text: "Keep", style: "cancel" },
                        { text: "Cancel Claim", style: "destructive", onPress: () => handleCancelClaim(claim.id) },
                      ])
                    }
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`Cancel claim for ${claim.player?.name ?? 'player'}`}
                  >
                    <Ionicons name="close-circle" size={20} color={c.secondaryText} />
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Waiver Priority Order */}
      {waiverOrderLoading && <SkeletonWaiverHeader color={c.border} />}
      {waiverOrder && waiverOrder.length > 0 && (
        <View>
          <TouchableOpacity
            style={[styles.claimsHeader, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => setShowWaiverOrder(!showWaiverOrder)}
            accessibilityRole="button"
            accessibilityState={{ expanded: showWaiverOrder }}
            accessibilityLabel={`Waiver Order${waiverType === 'faab' ? ' and FAAB' : ''}`}
          >
            <View style={styles.claimsHeaderLeft}>
              <Ionicons name="list-outline" size={16} color={c.accent} accessible={false} />
              <ThemedText style={styles.claimsHeaderText}>
                Waiver Order{waiverType === 'faab' ? ' / FAAB' : ''}
              </ThemedText>
            </View>
            <Ionicons
              name={showWaiverOrder ? "chevron-up" : "chevron-down"}
              size={16}
              color={c.secondaryText}
            />
          </TouchableOpacity>
          {showWaiverOrder && (
            <View style={[styles.claimsList, { backgroundColor: c.card, borderColor: c.border }]}>
              {!waiverOrder ? (
                <View style={[styles.claimRow, { borderBottomWidth: 0 }]}>
                  <ThemedText style={{ fontSize: 13, color: c.secondaryText }}>Loading…</ThemedText>
                </View>
              ) : waiverOrder.map((wp: any) => (
                <View key={wp.team_id} style={[styles.claimRow, { borderBottomColor: c.border }]}>
                  <ThemedText style={{ fontSize: 14, fontWeight: '700', width: 24, color: c.secondaryText }}>
                    {wp.priority}
                  </ThemedText>
                  <ThemedText style={{ flex: 1, fontSize: 13, fontWeight: wp.team_id === teamId ? '700' : '400' }}>
                    {wp.team?.name ?? 'Unknown'}{wp.team_id === teamId ? ' (You)' : ''}
                  </ThemedText>
                  {waiverType === 'faab' && (
                    <ThemedText style={{ fontSize: 12, color: c.secondaryText }}>
                      ${wp.faab_remaining}
                    </ThemedText>
                  )}
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* FAAB remaining badge */}
      {waiverType === 'faab' && faabRemaining != null && (
        <View style={[styles.faabBadge, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText style={{ fontSize: 12, color: c.secondaryText }}>
            FAAB Budget: <Text style={{ fontWeight: '700', color: c.text }}>${faabRemaining}</Text>
          </ThemedText>
        </View>
      )}

      <FlatList<PlayerSeasonStats>
        data={filteredPlayers}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.player_id}
        contentContainerStyle={styles.listContent}
        initialNumToRender={15}
        maxToRenderPerBatch={15}
        windowSize={5}
      />

      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId}
        teamId={teamId}
        onClose={() => {
          setSelectedPlayer(null);
          setOpenAsDropPicker(false);
          setClaimWithDropPlayer(null);
        }}
        startInDropPicker={openAsDropPicker}
        onDropForClaim={claimWithDropPlayer ? (dropPlayer) => {
          triggerClaimFlow(claimWithDropPlayer, dropPlayer.player_id);
          setClaimWithDropPlayer(null);
        } : undefined}
        onClaimPlayer={selectedPlayer && isOnWaivers(selectedPlayer.player_id) ? () => {
          triggerClaimFlow(selectedPlayer);
        } : undefined}
      />

      {/* FAAB Bid Modal */}
      <Modal visible={!!faabModalPlayer} animationType="fade" transparent onRequestClose={() => setFaabModalPlayer(null)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.faabModal, { backgroundColor: c.card }]}>
            <ThemedText type="defaultSemiBold" style={{ fontSize: 16, marginBottom: 4 }}>
              Place FAAB Bid
            </ThemedText>
            <ThemedText style={{ fontSize: 13, color: c.secondaryText, marginBottom: 16 }}>
              {faabModalPlayer?.name} - {formatPosition(faabModalPlayer?.position ?? '')}
            </ThemedText>

            <View style={styles.bidRow}>
              <ThemedText style={{ fontSize: 14, color: c.secondaryText }}>Bid Amount ($)</ThemedText>
              <TextInput
                style={[styles.bidInput, { color: c.text, borderColor: c.border, backgroundColor: c.input }]}
                value={bidAmount}
                onChangeText={setBidAmount}
                keyboardType="number-pad"
                selectTextOnFocus
                accessibilityLabel="Bid amount in dollars"
              />
            </View>
            <ThemedText style={{ fontSize: 11, color: c.secondaryText, marginBottom: 16 }}>
              Remaining budget: ${faabRemaining ?? 0}
            </ThemedText>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: c.cardAlt }]}
                onPress={() => { setFaabModalPlayer(null); setFaabDropPlayerId(null); }}
                accessibilityRole="button"
                accessibilityLabel="Cancel bid"
              >
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, { backgroundColor: c.accent }]}
                accessibilityRole="button"
                accessibilityLabel="Submit bid"
                onPress={() => {
                  const bid = Math.max(0, Math.min(parseInt(bidAmount) || 0, faabRemaining ?? 0));
                  const dropId = faabDropPlayerId ?? undefined;
                  setFaabModalPlayer(null);
                  setFaabDropPlayerId(null);
                  handleSubmitFaabBid(faabModalPlayer!, bid, dropId);
                }}
              >
                <Text style={{ color: c.accentText, fontWeight: '600' }}>Submit Bid</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  offseasonBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    marginHorizontal: 8,
    marginTop: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  listContent: {
    padding: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  portraitWrap: {
    width: 52,
    height: 48,
    marginRight: 10,
  },
  headshot: {
    width: 52,
    height: 40,
    borderRadius: 6,
  },
  teamPill: {
    position: "absolute",
    bottom: 0,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    gap: 2,
  },
  teamPillLogo: {
    width: 10,
    height: 10,
  },
  teamPillText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    color: "#fff",
    fontSize: 8,
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  posRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  posText: {
    fontSize: 11,
    marginTop: 0,
  },
  gameTodayBadge: {
    backgroundColor: "#007AFF22",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  gameTodayText: {
    color: "#007AFF",
    fontSize: 9,
    fontWeight: "700",
  },
  rightSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  stats: {
    alignItems: "flex-end",
  },
  statLine: {
    fontSize: 12,
  },
  fpts: {
    fontSize: 11,
    fontWeight: "600",
    marginTop: 1,
  },
  addButton: {
    backgroundColor: "#28a745",
    width: 48,
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: "center" as const,
  },
  claimButton: {
    backgroundColor: "#D4A017",
    width: 48,
    paddingVertical: 6,
    borderRadius: 4,
    alignItems: "center" as const,
  },
  addButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  addButtonDisabled: {
    backgroundColor: "#ccc",
  },
  skeletonBar: {
    height: 12,
    borderRadius: 4,
  },

  // Pending claims
  claimsHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginHorizontal: 8,
    marginTop: 4,
    borderWidth: 1,
    borderRadius: 8,
  },
  claimsHeaderLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  claimsHeaderText: {
    fontSize: 13,
    fontWeight: "600",
  },
  claimsList: {
    marginHorizontal: 8,
    borderWidth: 1,
    borderTopWidth: 0,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    paddingHorizontal: 12,
  },
  claimRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },

  // FAAB badge
  faabBadge: {
    marginHorizontal: 8,
    marginTop: 4,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderRadius: 8,
    alignItems: "center",
  },

  // FAAB bid modal
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  faabModal: {
    width: "80%",
    borderRadius: 12,
    padding: 20,
  },
  bidRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  bidInput: {
    width: 80,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
  },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    minWidth: 80,
  },
});
