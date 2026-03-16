import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { PlayerFilterBar } from "@/components/player/PlayerFilterBar";
import { ThemedText } from "@/components/ThemedText";
import { Colors } from "@/constants/Colors";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useDraftPlayer } from "@/hooks/useDraftPlayer";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { TimeRange, usePlayerFilter } from "@/hooks/usePlayerFilter";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { calculateAvgFantasyPoints } from "@/utils/fantasyPoints";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/injuryBadge";
import { getPlayerHeadshotUrl, getTeamLogoUrl } from "@/utils/playerHeadshot";
import { Ionicons } from "@expo/vector-icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

interface AvailablePlayersProps {
  draftId: string;
  leagueId: string;
  currentPick: { id: string; current_team_id: string } | null;
  teamId: string;
  isRookieDraft?: boolean;
  addToQueue?: (playerId: string) => void;
  queuedPlayerIds?: Set<string>;
}

export function AvailablePlayers({
  draftId,
  leagueId,
  currentPick,
  teamId,
  isRookieDraft,
  addToQueue,
  queuedPlayerIds,
}: AvailablePlayersProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const isMyTurn = currentPick?.current_team_id === teamId;
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);

  const { mutate: draftPlayer, isPending: isDrafting } = useDraftPlayer(
    leagueId,
    draftId,
  );
  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const [timeRange, setTimeRange] = useState<TimeRange>("season");

  const { data: players, isLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: ["availablePlayers", leagueId],
    queryFn: async () => {
      const { data: draftedPlayers, error: draftedError } = await supabase
        .from("league_players")
        .select("player_id")
        .eq("league_id", leagueId);

      if (draftedError) throw draftedError;
      const draftedIds = draftedPlayers?.map((p) => String(p.player_id)) || [];

      let query = supabase
        .from("player_season_stats")
        .select("*")
        .order("avg_pts", { ascending: false });

      // Rookie drafts: only show rookies. Initial drafts: require games played.
      if (isRookieDraft) {
        query = query.eq("rookie", true);
      } else {
        query = query.gt("games_played", 0);
      }

      if (draftedIds.length > 0) {
        query = query.filter(
          "player_id",
          "not.in",
          `(${draftedIds.join(",")})`,
        );
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    enabled: !!leagueId,
  });

  // Fetch last 30 days of game logs for time-range stats
  const playerIds = useMemo(
    () => players?.map((p) => p.player_id) ?? [],
    [players],
  );
  const { data: recentGameLogs } = useQuery({
    queryKey: ["draftRecentGameLogs", leagueId],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const cutoffStr = cutoff.toISOString().split("T")[0];

      const CHUNK = 200;
      const allRows: any[] = [];
      for (let i = 0; i < playerIds.length; i += CHUNK) {
        const chunk = playerIds.slice(i, i + CHUNK);
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
    enabled: !!leagueId && playerIds.length > 0,
    staleTime: 1000 * 60 * 15,
  });

  // Build time-range-adjusted player stats when a non-season range is selected
  const adjustedPlayers = useMemo(() => {
    if (!players) return undefined;
    if (timeRange === "season" || !recentGameLogs) return players;

    const days = timeRange === "7d" ? 7 : timeRange === "14d" ? 14 : 30;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const grouped = new Map<string, typeof recentGameLogs>();
    for (const g of recentGameLogs) {
      const gDate = (g.game_date ?? "").slice(0, 10);
      if (gDate < cutoffStr) continue;
      const arr = grouped.get(g.player_id);
      if (arr) arr.push(g);
      else grouped.set(g.player_id, [g]);
    }

    const round = (v: number) => Math.round(v * 10) / 10;

    return players
      .filter((p) => grouped.has(p.player_id))
      .map((p) => {
        const games = grouped.get(p.player_id)!;
        const gp = games.length;
        const t = {
          pts: 0,
          reb: 0,
          ast: 0,
          stl: 0,
          blk: 0,
          tov: 0,
          fgm: 0,
          fga: 0,
          threepm: 0,
          threepa: 0,
          ftm: 0,
          fta: 0,
          pf: 0,
          min: 0,
          dd: 0,
          td: 0,
        };
        for (const g of games) {
          t.pts += g.pts ?? 0;
          t.reb += g.reb ?? 0;
          t.ast += g.ast ?? 0;
          t.stl += g.stl ?? 0;
          t.blk += g.blk ?? 0;
          t.tov += g.tov ?? 0;
          t.fgm += g.fgm ?? 0;
          t.fga += g.fga ?? 0;
          t.threepm += g["3pm"] ?? 0;
          t.threepa += g["3pa"] ?? 0;
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
          total_pts: t.pts,
          avg_pts: round(t.pts / gp),
          total_reb: t.reb,
          avg_reb: round(t.reb / gp),
          total_ast: t.ast,
          avg_ast: round(t.ast / gp),
          total_stl: t.stl,
          avg_stl: round(t.stl / gp),
          total_blk: t.blk,
          avg_blk: round(t.blk / gp),
          total_tov: t.tov,
          avg_tov: round(t.tov / gp),
          total_fgm: t.fgm,
          avg_fgm: round(t.fgm / gp),
          total_fga: t.fga,
          avg_fga: round(t.fga / gp),
          total_3pm: t.threepm,
          avg_3pm: round(t.threepm / gp),
          total_3pa: t.threepa,
          avg_3pa: round(t.threepa / gp),
          total_ftm: t.ftm,
          avg_ftm: round(t.ftm / gp),
          total_fta: t.fta,
          avg_fta: round(t.fta / gp),
          total_pf: t.pf,
          avg_pf: round(t.pf / gp),
          total_dd: t.dd,
          total_td: t.td,
          avg_min: round(t.min / gp),
        } as PlayerSeasonStats;
      });
  }, [players, recentGameLogs, timeRange]);

  // Pass an empty rosteredPlayerIds so the "free agents only" filter (default ON)
  // doesn't short-circuit to []. The query already excludes drafted players.
  const emptySet = useMemo(() => new Set<string>(), []);
  const { filteredPlayers, filterBarProps } = usePlayerFilter(
    adjustedPlayers,
    scoringWeights,
    undefined,
    undefined,
    undefined,
    emptySet,
  );

  const handleDraft = (player: PlayerSeasonStats) => {
    if (!isMyTurn || !currentPick) return;
    draftPlayer({
      id: player.player_id,
      name: player.name,
      position: player.position,
      nba_team: player.nba_team,
    });
  };

  // Real-time updates when players are drafted
  useEffect(() => {
    const channel = supabase
      .channel(`league_players_${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "league_players",
          filter: `league_id=eq.${leagueId}`,
        },
        () => {
          queryClient.invalidateQueries({
            queryKey: ["availablePlayers", leagueId],
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId, queryClient]);

  const renderPlayer = useCallback(
    ({ item }: { item: PlayerSeasonStats }) => {
      const fpts = scoringWeights
        ? calculateAvgFantasyPoints(item, scoringWeights)
        : undefined;
      const headshotUrl = getPlayerHeadshotUrl(item.external_id_nba);
      const logoUrl = getTeamLogoUrl(item.nba_team);
      const badge = getInjuryBadge(item.status);

      return (
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: c.border }]}
          onPress={() => setSelectedPlayer(item)}
          activeOpacity={0.7}
        >
          <View style={styles.portraitWrap}>
            {headshotUrl ? (
              <Image
                source={{ uri: headshotUrl }}
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
            <ThemedText style={[styles.posText, { color: c.secondaryText }]}>
              {formatPosition(item.position)}
            </ThemedText>
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
                styles.draftButton,
                (!isMyTurn || isDrafting) && styles.draftButtonDisabled,
              ]}
              onPress={() => handleDraft(item)}
              disabled={!isMyTurn || isDrafting}
            >
              <ThemedText
                style={[
                  styles.draftButtonText,
                  (!isMyTurn || isDrafting) && styles.draftButtonTextDisabled,
                ]}
              >
                Draft
              </ThemedText>
            </TouchableOpacity>
            {addToQueue && (
              <View style={styles.queueButton}>
                {!queuedPlayerIds?.has(item.player_id) ? (
                  <TouchableOpacity
                    onPress={() => addToQueue(item.player_id)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${item.name} to draft queue`}
                  >
                    <Ionicons
                      name="add-circle-outline"
                      size={22}
                      color={c.accent}
                    />
                  </TouchableOpacity>
                ) : (
                  <Ionicons
                    name="checkmark-circle"
                    size={22}
                    color={c.secondaryText}
                    accessibilityLabel="Already in queue"
                  />
                )}
              </View>
            )}
          </View>
        </TouchableOpacity>
      );
    },
    [c, scoringWeights, isMyTurn, isDrafting, addToQueue, queuedPlayerIds],
  );

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PlayerFilterBar
        {...filterBarProps}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
      />
      <FlatList<PlayerSeasonStats>
        data={filteredPlayers}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.player_id}
        contentContainerStyle={styles.listContent}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews
        initialNumToRender={15}
      />
      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId}
        teamId={teamId}
        onClose={() => setSelectedPlayer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 8,
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
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
  posText: {
    fontSize: 11,
    marginTop: 1,
  },
  rightSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
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
  draftButton: {
    backgroundColor: "#0066cc",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  draftButtonText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "bold",
  },
  draftButtonDisabled: {
    backgroundColor: "#ccc",
  },
  draftButtonTextDisabled: {
    color: "#666",
  },
  queueButton: {
    width: 22,
    alignItems: "center",
    justifyContent: "center",
  },
});
