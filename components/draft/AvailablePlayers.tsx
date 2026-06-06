import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useCallback, useMemo, useState } from "react";
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
import { getPreviousSeason } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { useDraftPlayer } from "@/hooks/useDraftPlayer";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useLeagueScoringType } from "@/hooks/useLeagueScoringType";
import { TimeRange, usePlayerFilter } from "@/hooks/usePlayerFilter";
import { usePlayerProjections } from "@/hooks/usePlayerProjections";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { preferProjection } from "@/utils/draft/draftRanking";
import { formatPosition } from "@/utils/formatting";
import { buildAdjustedPlayers } from "@/utils/freeAgent/freeAgentStats";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
import { checkPositionLimits, type PositionLimits } from "@/utils/roster/positionLimits";
import { ms, s } from "@/utils/scale";
import { calculateAvgFantasyPoints } from "@/utils/scoring/fantasyPoints";

// Coalesces a possibly-null average to a 1-decimal string. A player with no
// games this season has NULL stat columns, and the category slash line calls
// .toFixed on each — guard here so a statless player doesn't crash the row.
const fixed1 = (v: number | null | undefined) => (v ?? 0).toFixed(1);

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
  const c = useColors();
  const isMyTurn = currentPick?.current_team_id === teamId;
  const sport = useActiveLeagueSport(leagueId);
  const [selectedPlayer, setSelectedPlayer] =
    useState<PlayerSeasonStats | null>(null);

  const { mutate: draftPlayer, isPending: isDrafting } = useDraftPlayer(
    leagueId,
    draftId,
  );
  const { data: scoringWeights } = useLeagueScoring(leagueId);

  const { isCategories } = useLeagueScoringType(leagueId);

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

  // Default draft board view: a player's current-season averages are a tiny
  // (or empty, pre-tipoff) sample early on, so the "season" view shows their
  // season PROJECTION until they've played enough games
  // (DRAFT_PROJECTION_GAME_THRESHOLD), then flips to current averages — the
  // blend lives in adjustedPlayers below. WNBA pre-tipoff this means the whole
  // board reads off projections (replacing the old last-season-averages
  // default). Rookie drafts opt out — that pool is ranked by prospect data, not
  // pro projections.
  const { data: seasonProjections } = usePlayerProjections(
    sport,
    "season",
    !!leagueId && !isRookieDraft,
  );

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

  // Fetch recent game logs for the L5/L10/L15 windows. 45 days comfortably
  // contains 15 played games; DESC order + limit keeps the most-recent rows.
  const playerIds = useMemo(
    () => players?.map((p) => p.player_id) ?? [],
    [players],
  );
  const { data: recentGameLogs } = useQuery({
    queryKey: [...queryKeys.draftRecentGameLogs(leagueId), sport],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 45);
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

    // Default "season" view: replace a thin-sample player's current averages
    // with their season projection until they cross the games threshold. We
    // reconstruct total_* (= proj per-game × projected games) and set
    // games_played so calculateAvgFantasyPoints / the FPTS sort yield the
    // projected value — mirrors the lastSeason blend below. Players without a
    // projection, or past the threshold, keep their real current line.
    if (timeRange === "season") {
      if (!seasonProjections || seasonProjections.size === 0) return players;
      const num = (v: unknown) => Number(v) || 0;
      return players.map((p) => {
        if (!preferProjection(p.games_played)) return p;
        const pr = seasonProjections.get(p.player_id);
        if (!pr) return p;
        const g = num(pr.projected_games) || 1;
        const avg = {
          pts: num(pr.proj_pts), reb: num(pr.proj_reb), ast: num(pr.proj_ast),
          stl: num(pr.proj_stl), blk: num(pr.proj_blk), tov: num(pr.proj_tov),
          fgm: num(pr.proj_fgm), fga: num(pr.proj_fga),
          ftm: num(pr.proj_ftm), fta: num(pr.proj_fta),
          tpm: num(pr.proj_3pm), tpa: num(pr.proj_3pa),
          min: num(pr.proj_min),
        };
        return {
          ...p,
          games_played: g,
          avg_min: avg.min,
          avg_pts: avg.pts, total_pts: avg.pts * g,
          avg_reb: avg.reb, total_reb: avg.reb * g,
          avg_ast: avg.ast, total_ast: avg.ast * g,
          avg_stl: avg.stl, total_stl: avg.stl * g,
          avg_blk: avg.blk, total_blk: avg.blk * g,
          avg_tov: avg.tov, total_tov: avg.tov * g,
          avg_fgm: avg.fgm, total_fgm: avg.fgm * g,
          avg_fga: avg.fga, total_fga: avg.fga * g,
          avg_ftm: avg.ftm, total_ftm: avg.ftm * g,
          avg_fta: avg.fta, total_fta: avg.fta * g,
          avg_3pm: avg.tpm, total_3pm: avg.tpm * g,
          avg_3pa: avg.tpa, total_3pa: avg.tpa * g,
        } as PlayerSeasonStats;
      });
    }

    // lastSeason + L5/L10/L15 reuse the free-agent browser's aggregation so the
    // draft board and the wire read identical windows. The "season" view is
    // handled above — it layers the draft-only projection blend on top.
    return buildAdjustedPlayers(players, recentGameLogs, historicalStats, timeRange);
  }, [players, recentGameLogs, historicalStats, seasonProjections, timeRange]);

  // Players whose row is showing a season projection (vs real stats) in the
  // default view — drives the "PROJ" tag. Mirrors the blend condition above.
  const projectedIds = useMemo(() => {
    const set = new Set<string>();
    if (timeRange !== "season" || !players || !seasonProjections) return set;
    for (const p of players) {
      if (preferProjection(p.games_played) && seasonProjections.has(p.player_id)) {
        set.add(p.player_id);
      }
    }
    return set;
  }, [players, seasonProjections, timeRange]);

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
    undefined,
    undefined,
    undefined,
    isCategories,
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
      const isProjected = projectedIds.has(item.player_id);
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
          accessibilityLabel={
            `${item.name}, ${formatPosition(item.position)}, ${item.pro_team}` +
            (isProjected ? ", projected" : "") +
            (isCategories
              ? `, ${fixed1(item.avg_pts)} points, ${fixed1(item.avg_reb)} rebounds, ${fixed1(item.avg_ast)} assists, ${fixed1(item.avg_stl)} steals, ${fixed1(item.avg_blk)} blocks`
              : fpts !== undefined
                ? `, ${fpts} fantasy points`
                : "")
          }
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
            <View
              style={[
                styles.stats,
                isCategories ? styles.statsCategories : styles.statsPoints,
              ]}
            >
              {isCategories ? (
                <>
                  <ThemedText
                    type="mono"
                    style={[styles.statLine, { color: c.secondaryText }]}
                  >
                    {fixed1(item.avg_pts)}/{fixed1(item.avg_reb)}/{fixed1(item.avg_ast)}/{fixed1(item.avg_stl)}/{fixed1(item.avg_blk)}
                  </ThemedText>
                  <ThemedText style={[styles.catLine, { color: c.secondaryText }]}>
                    {(item.avg_fga ?? 0) > 0
                      ? (((item.avg_fgm ?? 0) / (item.avg_fga as number)) * 100).toFixed(1)
                      : "0.0"}
                    % FG ·{" "}
                    {(item.avg_fta ?? 0) > 0
                      ? (((item.avg_ftm ?? 0) / (item.avg_fta as number)) * 100).toFixed(1)
                      : "0.0"}
                    % FT · {fixed1(item.avg_tov)} TO
                  </ThemedText>
                </>
              ) : (
                <>
                  <ThemedText style={[styles.statLine, { color: c.secondaryText }]}>
                    {item.avg_pts}/{item.avg_reb}/{item.avg_ast}
                  </ThemedText>
                  {fpts !== undefined && (
                    <ThemedText style={[styles.fpts, { color: c.accent }]}>
                      {fpts} FPTS
                    </ThemedText>
                  )}
                </>
              )}
              {isProjected && (
                <ThemedText style={[styles.projTag, { color: c.accent }]}>
                  PROJ
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
    [c, scoringWeights, isCategories, isMyTurn, isDrafting, addToQueue, queuedPlayerIds, sport, players, hasLimits, positionLimits, myRoster, projectedIds],
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
      {/* Column-key header over the stat column — mirrors FreeAgentList so the
          draft board reads the same. Category leagues key the 5-stat line. */}
      <View style={[styles.colKey, { borderBottomColor: c.border }]}>
        <View
          style={[
            styles.colKeyStats,
            isCategories ? styles.statsCategories : styles.statsPoints,
          ]}
        >
          <ThemedText
            type="varsitySmall"
            style={[styles.colKeyText, { color: c.secondaryText }]}
          >
            {isCategories ? "PTS · REB · AST · STL · BLK" : "PTS · REB · AST"}
          </ThemedText>
        </View>
        <View style={styles.colKeyAddSpacer} />
      </View>
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
  colKey: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    paddingHorizontal: s(20),
    paddingTop: s(8),
    paddingBottom: s(6),
    gap: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  colKeyStats: {
    alignItems: "flex-end",
  },
  colKeyText: {
    fontSize: ms(9),
    letterSpacing: 1.2,
    textAlign: "right" as const,
  },
  // Spacer matching the row's Draft button (minWidth s(62)) + gap + queue
  // button (s(22)) so the header sits over the stat column, not the buttons.
  colKeyAddSpacer: {
    width: s(90),
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
  // Fixed-width stat columns keep the slash-line right edge aligned under the
  // colKey header. Category leagues need extra room for the 5-stat line.
  statsPoints: {
    width: s(100),
  },
  statsCategories: {
    width: s(150),
  },
  statLine: {
    fontSize: ms(11),
    textAlign: "right" as const,
  },
  catLine: {
    fontSize: ms(10),
    marginTop: 1,
  },
  fpts: {
    fontSize: ms(11),
    fontWeight: "600",
    marginTop: 1,
  },
  projTag: {
    fontSize: ms(8),
    fontWeight: "700",
    letterSpacing: 0.5,
    marginTop: 1,
  },
  draftButton: {
    minWidth: s(62),
    alignItems: "center",
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
