import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { PlayerFilterBar } from "@/components/player/PlayerFilterBar";
import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { Colors } from "@/constants/Colors";
import { getPreviousSeason } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColorScheme } from "@/hooks/useColorScheme";
import { useDraftPlayer } from "@/hooks/useDraftPlayer";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { TimeRange, usePlayerFilter } from "@/hooks/usePlayerFilter";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { formatPosition } from "@/utils/formatting";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
import { checkPositionLimits, type PositionLimits } from "@/utils/roster/positionLimits";
import { ms, s } from "@/utils/scale";
import { calculateAvgFantasyPoints } from "@/utils/scoring/fantasyPoints";

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
  const isMyTurn = currentPick?.current_team_id === teamId;
  const sport = useActiveLeagueSport(leagueId);
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);

  const { mutate: draftPlayer, isPending: isDrafting } = useDraftPlayer(
    leagueId,
    draftId,
  );
  const { data: scoringWeights } = useLeagueScoring(leagueId);

  const { data: scoringType } = useQuery<string>({
    queryKey: queryKeys.leagueScoringType(leagueId),
    queryFn: async () => {
      const { data } = await supabase
        .from("leagues")
        .select("scoring_type")
        .eq("id", leagueId)
        .single();
      return data?.scoring_type ?? "points";
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });
  const isCategories = scoringType === "h2h_categories";

  // Block the Draft button for players whose position would push the team over
  // a per-position limit — mirrors the edge function's checkPositionLimits()
  // so the violation surfaces visually before the round-trip.
  const { data: positionLimits } = useQuery<PositionLimits | null>({
    queryKey: queryKeys.leaguePositionLimits(leagueId),
    queryFn: async () => {
      const { data } = await supabase
        .from("leagues")
        .select("position_limits")
        .eq("id", leagueId)
        .single();
      return (data?.position_limits as PositionLimits) ?? null;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });

  const { data: myRoster } = useQuery<{ position: string; roster_slot?: string }[]>({
    queryKey: queryKeys.teamRoster(teamId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from("league_players")
        .select("position, roster_slot")
        .eq("team_id", teamId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        position: r.position,
        roster_slot: r.roster_slot ?? undefined,
      }));
    },
    enabled: !!teamId,
    staleTime: 0,
  });

  const hasLimits = !!positionLimits && Object.keys(positionLimits).length > 0;

  const [timeRange, setTimeRange] = useState<TimeRange>("season");

  // WNBA's current-season stats are empty during the offseason / pre-tipoff,
  // so default the draft view to last season's averages once we know the
  // league's sport. (useActiveLeagueSport returns 'nba' as a loading
  // fallback, so we can't make this the useState init — wait for resolve.)
  // Rookie drafts skip this since rookies have no prior season.
  const sportDefaultAppliedRef = useRef(false);
  useEffect(() => {
    if (sportDefaultAppliedRef.current) return;
    if (sport === "wnba" && !isRookieDraft) {
      setTimeRange("lastSeason");
      sportDefaultAppliedRef.current = true;
    }
  }, [sport, isRookieDraft]);

  const { data: players, isLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: [...queryKeys.availablePlayers(leagueId), sport],
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
        .eq("sport", sport)
        .order("avg_pts", { ascending: false });

      // Rookie drafts: only show rookies. Initial drafts: anyone on a real
      // team's roster (works year-round; `games_played > 0` would hide
      // everyone during the offseason — WNBA April–May, NBA June–September).
      if (isRookieDraft) {
        query = query.eq("rookie", true);
      } else {
        query = query.not("pro_team", "is", null);
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
    staleTime: 1000 * 60 * 5,
  });

  // Fetch last 30 days of game logs for time-range stats
  const playerIds = useMemo(
    () => players?.map((p) => p.player_id) ?? [],
    [players],
  );
  const { data: recentGameLogs } = useQuery({
    queryKey: [...queryKeys.draftRecentGameLogs(leagueId), sport],
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
          .eq("sport", sport)
          .in("player_id", chunk)
          .gte("game_date", cutoffStr)
          .order("game_date", { ascending: false })
          .limit(5000);
        if (error) throw error;
        if (data) allRows.push(...data);
      }
      return allRows;
    },
    enabled:
      !!leagueId &&
      playerIds.length > 0 &&
      timeRange !== "season" &&
      timeRange !== "lastSeason",
    staleTime: 1000 * 60 * 15,
  });

  const previousSeason = getPreviousSeason(sport);
  const { data: historicalStats } = useQuery({
    queryKey: [...queryKeys.draftHistoricalStats(leagueId), sport, previousSeason],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("player_historical_stats")
        .select("*")
        .eq("sport", sport)
        .eq("season", previousSeason);
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId && timeRange === "lastSeason",
    staleTime: 1000 * 60 * 30,
  });

  // Build time-range-adjusted player stats when a non-season range is selected
  const adjustedPlayers = useMemo(() => {
    if (!players) return undefined;
    if (timeRange === "season") return players;

    // Last season: merge historical averages onto player identity
    if (timeRange === "lastSeason") {
      if (!historicalStats) return players;
      const histMap = new Map(historicalStats.map((h: any) => [h.player_id, h]));
      return players
        .filter((p) => histMap.has(p.player_id))
        .map((p) => {
          const h = histMap.get(p.player_id)!;
          return {
            ...p,
            games_played: h.games_played ?? 0,
            avg_pts: h.avg_pts ?? 0,
            avg_reb: h.avg_reb ?? 0,
            avg_ast: h.avg_ast ?? 0,
            avg_stl: h.avg_stl ?? 0,
            avg_blk: h.avg_blk ?? 0,
            avg_tov: h.avg_tov ?? 0,
            avg_fgm: h.avg_fgm ?? 0,
            avg_fga: h.avg_fga ?? 0,
            avg_3pm: h.avg_3pm ?? 0,
            avg_3pa: h.avg_3pa ?? 0,
            avg_ftm: h.avg_ftm ?? 0,
            avg_fta: h.avg_fta ?? 0,
            avg_pf: h.avg_pf ?? 0,
            avg_min: h.avg_min ?? 0,
            total_pts: h.total_pts ?? 0,
            total_reb: h.total_reb ?? 0,
            total_ast: h.total_ast ?? 0,
            total_stl: h.total_stl ?? 0,
            total_blk: h.total_blk ?? 0,
            total_tov: h.total_tov ?? 0,
            total_dd: h.total_dd ?? 0,
            total_td: h.total_td ?? 0,
          } as PlayerSeasonStats;
        });
    }

    if (!recentGameLogs) return players;

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
  }, [players, recentGameLogs, historicalStats, timeRange]);

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
    if (hasLimits) {
      const violation = checkPositionLimits(positionLimits, myRoster ?? [], player.position);
      if (violation) {
        Alert.alert(
          "Position limit reached",
          `Your roster already has ${violation.current} of ${violation.max} players eligible at ${violation.position}. Pick someone else.`,
        );
        return;
      }
    }
    draftPlayer({
      id: player.player_id,
      name: player.name,
      position: player.position,
      pro_team: player.pro_team,
    });
  };

  // Realtime league_players subscription is handled by useRosterChanges
  // in the parent draft-room screen — no duplicate subscription needed here.

  const renderPlayer = useCallback(
    ({ item }: { item: PlayerSeasonStats }) => {
      const fpts = scoringWeights && !isCategories
        ? calculateAvgFantasyPoints(item, scoringWeights)
        : undefined;
      const logoUrl = getTeamLogoUrl(item.pro_team, sport);
      const badge = getInjuryBadge(item.status);
      const limitViolation = hasLimits
        ? checkPositionLimits(positionLimits, myRoster ?? [], item.position)
        : null;
      const limitBlocked = !!limitViolation;
      const draftDisabled = !isMyTurn || isDrafting || limitBlocked;

      return (
        <TouchableOpacity
          style={[styles.row, { borderBottomColor: c.border }]}
          onPress={() => {
            // Always open modal with current-season stats, not time-range-adjusted
            const original = players?.find((p) => p.player_id === item.player_id);
            setSelectedPlayer(original ?? item);
          }}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${item.name}, ${formatPosition(item.position)}, ${item.pro_team}`}
          accessibilityHint="View player details"
        >
          <View style={styles.portraitWrap}>
            <View style={[styles.headshotCircle, { borderColor: c.heritageGold, backgroundColor: c.cardAlt }]}>
              <PlayerHeadshotImage
                externalIdNba={item.external_id_nba}
                sport={sport}
                style={styles.headshotImg}
                accessible={false}
              />
            </View>
            <View style={styles.teamPill}>
              {logoUrl && (
                <Image
                  source={{ uri: logoUrl }}
                  style={styles.teamPillLogo}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  recyclingKey={logoUrl}
                  accessible={false}
                />
              )}
              <Text style={[styles.teamPillText, { color: c.statusText }]}>{item.pro_team}</Text>
            </View>
          </View>

          <View style={styles.info}>
            <View style={styles.nameRow}>
              <ThemedText
                type="defaultSemiBold"
                numberOfLines={1}
                style={{ flexShrink: 1, fontSize: ms(14) }}
              >
                {item.name}
              </ThemedText>
              {badge && (
                <View style={[styles.badge, { backgroundColor: badge.color }]} accessibilityLabel={badge.label}>
                  <Text style={[styles.badgeText, { color: c.statusText }]}>{badge.label}</Text>
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
                { backgroundColor: draftDisabled ? c.buttonDisabled : c.link },
              ]}
              onPress={() => handleDraft(item)}
              disabled={draftDisabled}
              accessibilityRole="button"
              accessibilityLabel={
                limitBlocked
                  ? `${item.name} blocked — roster already has ${limitViolation.max} at ${limitViolation.position}`
                  : `Draft ${item.name}`
              }
              accessibilityState={{ disabled: draftDisabled }}
            >
              <ThemedText
                style={[
                  styles.draftButtonText,
                  { color: draftDisabled ? c.secondaryText : c.statusText },
                ]}
              >
                {limitBlocked ? `Max ${limitViolation.position}` : "Draft"}
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
    [c, scoringWeights, isCategories, isMyTurn, isDrafting, addToQueue, queuedPlayerIds, sport, players, hasLimits, positionLimits, myRoster],
  );

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <LogoSpinner />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PlayerFilterBar
        {...filterBarProps}
        onFreeAgentsOnlyChange={undefined}
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
        draftMode
        canDraft={isMyTurn && !isDrafting}
        onDraftPlayer={handleDraft}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: s(8),
  },
  loading: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: s(8),
    paddingHorizontal: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  portraitWrap: {
    width: s(58),
    height: s(58),
    marginRight: s(10),
  },
  headshotCircle: {
    width: s(58),
    height: s(58),
    borderRadius: 29,
    borderWidth: 1.5,
    overflow: "hidden" as const,
  },
  headshotImg: {
    position: "absolute" as const,
    bottom: s(-2),
    left: 0,
    right: 0,
    height: s(48),
  },
  teamPill: {
    position: "absolute",
    bottom: 0,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.75)",
    borderRadius: 8,
    paddingHorizontal: s(4),
    paddingVertical: 1,
    gap: s(2),
  },
  teamPillLogo: {
    width: s(10),
    height: s(10),
  },
  teamPillText: {
    fontSize: ms(8),
    fontWeight: "700",
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    marginRight: s(8),
  },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
  },
  badge: {
    paddingHorizontal: s(4),
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: ms(8),
    fontWeight: "800",
    letterSpacing: 0.5,
  },
  posText: {
    fontSize: ms(11),
    marginTop: 1,
  },
  rightSide: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(6),
  },
  stats: {
    alignItems: "flex-end",
  },
  statLine: {
    fontSize: ms(12),
  },
  fpts: {
    fontSize: ms(11),
    fontWeight: "600",
    marginTop: 1,
  },
  draftButton: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 4,
  },
  draftButtonText: {
    fontSize: ms(12),
    fontWeight: "bold",
  },
  draftButtonDisabled: {},
  draftButtonTextDisabled: {},
  queueButton: {
    width: s(22),
    alignItems: "center",
    justifyContent: "center",
  },
});
