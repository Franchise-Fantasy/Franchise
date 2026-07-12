import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { PlayerPoolTable } from "@/components/draft/PlayerPoolTable";
import { PlayerDetailModal } from "@/components/player/PlayerDetailModal";
import { PlayerFilterBar } from "@/components/player/PlayerFilterBar";
import { PlayerHeadshotImage } from "@/components/player/PlayerHeadshotImage";
import { PlayerName } from "@/components/player/PlayerName";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { ThemedText } from "@/components/ui/ThemedText";
import { getPreviousSeason } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useSession } from "@/context/AuthProvider";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useBreakpoint } from "@/hooks/useBreakpoint";
import { useColors } from "@/hooks/useColors";
import { useDraftPlayer } from "@/hooks/useDraftPlayer";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { useLeagueScoringType } from "@/hooks/useLeagueScoringType";
import { TimeRange, usePlayerFilter } from "@/hooks/usePlayerFilter";
import { usePlayerProjections } from "@/hooks/usePlayerProjections";
import { useProspectBoard } from "@/hooks/useProspectBoard";
import { supabase } from "@/lib/supabase";
import { PlayerSeasonStats } from "@/types/player";
import { preferProjection } from "@/utils/draft/draftRanking";
import { formatPosition } from "@/utils/formatting";
import { blendNflSeasonView, buildAdjustedPlayers } from "@/utils/freeAgent/freeAgentStats";
import { getInjuryBadge } from "@/utils/nba/injuryBadge";
import { getTeamLogoUrl } from "@/utils/nba/playerHeadshot";
import { checkPositionLimits, type PositionLimits } from "@/utils/roster/positionLimits";
import { ms, s } from "@/utils/scale";
import { calculateAvgFantasyPoints } from "@/utils/scoring/fantasyPoints";
import { nflAvgRowToGameShape, nflStatFields } from "@/utils/scoring/nflStatLine";

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
  const { isDesktop } = useBreakpoint();
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
    // Thin position-limit shape — kept on its own key so it can't pollute the
    // full-roster cache the "My Team" tab (TeamRoster) reads. Still under the
    // "teamRoster" prefix, so post-pick / roster-change invalidations refresh it.
    queryKey: queryKeys.teamRoster(teamId, "positions"),
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

  // L5/L10/L15 aggregate basketball game-log columns, so PlayerFilterBar hides
  // those chips for NFL — but the state itself persists across league/sport
  // switches, so a stale Lx from a basketball session must be coerced back.
  useEffect(() => {
    if (sport === "nfl" && timeRange !== "season" && timeRange !== "lastSeason") {
      setTimeRange("season");
    }
  }, [sport, timeRange]);

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
    // NFL has no projections engine — skip the query instead of fetching an
    // empty map (the NFL season-view blend below uses last season instead).
    !!leagueId && !isRookieDraft && sport !== "nfl",
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
    // NFL keeps this warm year-round: with no NFL projections, last season IS
    // the default pre-season draft ranking (see the season-view blend below).
    enabled: !!leagueId && (timeRange === "lastSeason" || sport === "nfl"),
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
      // NFL v1 has no projections, so the thin-sample fallback is last
      // season's production — the same proj→lastSeason chain the autodraft
      // bot walks in effectiveDraftPts, so bot and board stay in agreement.
      if (sport === "nfl") {
        return blendNflSeasonView(players, historicalStats) ?? players;
      }
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
    return buildAdjustedPlayers(players, recentGameLogs, historicalStats, timeRange, sport);
  }, [players, recentGameLogs, historicalStats, seasonProjections, timeRange, sport]);

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
    // The draft's league, NOT the global active league — a user can draft in a
    // league (sport) they don't have active, and the position chips / FPTS
    // math must follow the drafted league's sport.
    leagueId,
  );

  // Personal prospect big board ("My Board" in the Prospects hub) — powers the
  // board sort for rookie drafts. prospect_boards.player_id IS players.id, the
  // same id the pool rows carry, so the join is a Map lookup. The board is
  // global (not league/sport-scoped); ranks for players outside this pool are
  // simply never looked up.
  const userId = useSession()?.user?.id;
  const { data: boardRows } = useProspectBoard(userId, !!isRookieDraft);
  const boardRankMap = useMemo(
    () => new Map((boardRows ?? []).map((r) => [r.player_id, r.rank])),
    [boardRows],
  );
  const hasBoardPlayers = useMemo(
    () => !!isRookieDraft && (players ?? []).some((p) => boardRankMap.has(p.player_id)),
    [isRookieDraft, players, boardRankMap],
  );
  // null = no explicit choice → defaults ON. Prospects have no pro stats, so
  // every stat sort is degenerate for a rookie pool — the user's own ranking
  // is the most useful default order when they've built one.
  const [boardSortPref, setBoardSortPref] = useState<boolean | null>(null);
  const boardSortActive = hasBoardPlayers && (boardSortPref ?? true);

  const displayPlayers = useMemo(() => {
    if (!boardSortActive) return filteredPlayers;
    // Stable sort: board-ranked players first (by rank); everyone else keeps
    // the active stat-sort order behind them. Search + filters still apply —
    // this only reorders what the filter hook returned.
    const rank = (p: PlayerSeasonStats) =>
      boardRankMap.get(p.player_id) ?? Number.POSITIVE_INFINITY;
    return [...filteredPlayers].sort((a, b) => rank(a) - rank(b));
  }, [boardSortActive, filteredPlayers, boardRankMap]);

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

  // Accessors for the desktop table. They keep PlayerPoolTable presentational:
  // it renders a pool, and knows nothing about scoring weights, position limits
  // or projections.
  const fptsFor = useCallback(
    (p: PlayerSeasonStats) =>
      scoringWeights && !isCategories
        ? calculateAvgFantasyPoints(p, scoringWeights, sport)
        : undefined,
    [scoringWeights, isCategories, sport],
  );
  const isProjectedId = useCallback(
    (playerId: string) => projectedIds.has(playerId),
    [projectedIds],
  );
  const boardRankFor = useCallback(
    (playerId: string) => (isRookieDraft ? boardRankMap.get(playerId) : undefined),
    [isRookieDraft, boardRankMap],
  );
  const draftBlockFor = useCallback(
    (p: PlayerSeasonStats) => {
      if (!hasLimits) return null;
      return checkPositionLimits(positionLimits, myRoster ?? [], p.position)?.position ?? null;
    },
    [hasLimits, positionLimits, myRoster],
  );

  const renderPlayer = useCallback(
    ({ item }: { item: PlayerSeasonStats }) => {
      const fpts = scoringWeights && !isCategories
        ? calculateAvgFantasyPoints(item, scoringWeights, sport)
        : undefined;
      const isProjected = projectedIds.has(item.player_id);
      const logoUrl = getTeamLogoUrl(item.pro_team, sport);
      const badge = getInjuryBadge(item.status);
      // Category box-score lines, built once so the row can render them under
      // the name (see the isCategories branch below) rather than in a fixed
      // right-hand column that crowds the name out.
      const catSlash = `${fixed1(item.avg_pts)}/${fixed1(item.avg_reb)}/${fixed1(item.avg_ast)}/${fixed1(item.avg_stl)}/${fixed1(item.avg_blk)}`;
      // Before a season starts every average is NULL, and interpolating those
      // straight into the slash line rendered a bare "//". Show an em dash for
      // "no games yet" instead of three empty slots.
      // NFL rows swap the basketball triple for a position-shaped per-game
      // line ("245.1Y 1.9TD") built from the row's avg_* NFL columns — two
      // fields, so the line fits the same column the basketball slash uses.
      let boxSlash = "—";
      if (sport === "nfl") {
        const shape = nflAvgRowToGameShape(item as unknown as Record<string, unknown>);
        if (Object.keys(shape).length > 0) {
          boxSlash = nflStatFields(shape)
            .slice(0, 2)
            .map(([key, suffix]) => `${fixed1(Number(shape[key]) || 0)}${suffix}`)
            .join(" ");
        }
      } else if (item.avg_pts != null || item.avg_reb != null || item.avg_ast != null) {
        boxSlash = `${fixed1(item.avg_pts)}/${fixed1(item.avg_reb)}/${fixed1(item.avg_ast)}`;
      }
      const fgPct =
        (item.avg_fga ?? 0) > 0
          ? (((item.avg_fgm ?? 0) / (item.avg_fga as number)) * 100).toFixed(1)
          : "0.0";
      const ftPct =
        (item.avg_fta ?? 0) > 0
          ? (((item.avg_ftm ?? 0) / (item.avg_fta as number)) * 100).toFixed(1)
          : "0.0";
      const limitViolation = hasLimits
        ? checkPositionLimits(positionLimits, myRoster ?? [], item.position)
        : null;
      const limitBlocked = !!limitViolation;
      const draftDisabled = !isMyTurn || isDrafting || limitBlocked;
      // The user's own prospect-board rank — shown on rookie-draft rows so
      // "who's my next guy" is answerable at a glance even when board sort
      // is toggled off or filters reorder the list.
      const boardRank = isRookieDraft ? boardRankMap.get(item.player_id) : undefined;

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
            // The row is a single accessible node, so the visible #rank badge's
            // own label is dropped — fold it in here or a VoiceOver user never
            // hears their board rank.
            (boardRank !== undefined ? `Board rank ${boardRank}, ` : "") +
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
              {boardRank !== undefined && (
                <ThemedText
                  style={[styles.boardRank, { color: c.heritageGold }]}
                  accessibilityLabel={`Ranked ${boardRank} on your prospect board`}
                >
                  #{boardRank}
                </ThemedText>
              )}
              <PlayerName
                name={item.name}
                type="defaultSemiBold"
                style={{ fontSize: ms(14) }}
                containerStyle={{ flexShrink: 1 }}
              />
              {badge && (
                <View style={[styles.badge, { backgroundColor: badge.color }]} accessibilityLabel={badge.label}>
                  <Text style={[styles.badgeText, { color: c.statusText }]}>{badge.label}</Text>
                </View>
              )}
            </View>
            {isCategories ? (
              // Category leagues: 5-cat slash + shooting line live UNDER the
              // name across the full row width, so the name isn't squeezed by a
              // fixed right-hand stat column. Position sits inline with the
              // box-score slash (reusing the line the position used to own).
              <>
                <View style={styles.catMetaRow}>
                  <ThemedText style={[styles.posText, { color: c.secondaryText }]}>
                    {formatPosition(item.position)}
                  </ThemedText>
                  <ThemedText
                    type="mono"
                    style={[styles.catSlash, { color: c.text }]}
                    numberOfLines={1}
                  >
                    {catSlash}
                  </ThemedText>
                  {isProjected && (
                    <ThemedText style={[styles.projTag, { color: c.accent }]}>
                      PROJ
                    </ThemedText>
                  )}
                </View>
                <ThemedText
                  numberOfLines={1}
                  style={[styles.catLine, { color: c.secondaryText }]}
                >
                  {fgPct}% FG · {ftPct}% FT · {fixed1(item.avg_tov)} TO
                </ThemedText>
              </>
            ) : (
              <ThemedText style={[styles.posText, { color: c.secondaryText }]}>
                {formatPosition(item.position)}
              </ThemedText>
            )}
          </View>

          <View style={styles.rightSide}>
            {!isCategories && (
              <View style={[styles.stats, styles.statsPoints]}>
                <ThemedText style={[styles.statLine, { color: c.secondaryText }]}>
                  {boxSlash}
                </ThemedText>
                {fpts !== undefined && (
                  <ThemedText style={[styles.fpts, { color: c.accent }]}>
                    {fpts} FPTS
                  </ThemedText>
                )}
                {isProjected && (
                  <ThemedText style={[styles.projTag, { color: c.accent }]}>
                    PROJ
                  </ThemedText>
                )}
              </View>
            )}
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
    [c, scoringWeights, isCategories, isMyTurn, isDrafting, addToQueue, queuedPlayerIds, sport, players, hasLimits, positionLimits, myRoster, projectedIds, isRookieDraft, boardRankMap],
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
      {/* Rookie drafts: sort the pool by the user's prospect big board. Only
          offered when the board intersects this pool; defaults ON. */}
      {hasBoardPlayers && (
        <View style={[styles.boardSortRow, { borderBottomColor: c.border }]}>
          <TouchableOpacity
            style={[
              styles.boardChip,
              {
                borderColor: boardSortActive ? c.accent : c.border,
                backgroundColor: boardSortActive ? c.accent : "transparent",
              },
            ]}
            onPress={() => setBoardSortPref(!boardSortActive)}
            // Chip is ~22pt tall; pad the touch target to the 44pt minimum.
            hitSlop={{ top: s(11), bottom: s(11), left: s(4), right: s(4) }}
            accessibilityRole="switch"
            accessibilityState={{ checked: boardSortActive }}
            accessibilityLabel="Sort by my prospect board"
          >
            <Ionicons
              name={boardSortActive ? "checkmark" : "list-outline"}
              size={12}
              color={boardSortActive ? c.statusText : c.secondaryText}
            />
            <ThemedText
              type="varsitySmall"
              style={[
                styles.boardChipText,
                { color: boardSortActive ? c.statusText : c.secondaryText },
              ]}
            >
              My Board
            </ThemedText>
          </TouchableOpacity>
          {boardSortActive && (
            <ThemedText style={[styles.boardSortHint, { color: c.secondaryText }]}>
              Sorted by your prospect rankings
            </ThemedText>
          )}
        </View>
      )}
      {isDesktop ? (
        /* Desktop reads the pool as a sortable scouting table, not a card list
           — see PlayerPoolTable. The phone path below is untouched. */
        <PlayerPoolTable
          players={displayPlayers}
          sport={sport}
          isCategories={isCategories}
          sortBy={filterBarProps.sortBy}
          onSortChange={filterBarProps.onSortChange}
          fptsFor={fptsFor}
          isProjected={isProjectedId}
          boardRankFor={boardRankFor}
          draftBlockFor={draftBlockFor}
          canDraft={isMyTurn && !isDrafting}
          queuedPlayerIds={queuedPlayerIds}
          addToQueue={addToQueue}
          onDraft={handleDraft}
          onSelectPlayer={setSelectedPlayer}
        />
      ) : (
        <>
      {/* Column-key header. FPTS leagues key the right-hand stat column (mirrors
          FreeAgentList); category rows render their 5-stat slash inline over
          each name, so their legend left-aligns over the name/stat column to
          give the otherwise context-free numbers a heading. */}
      {isCategories ? (
        <View style={[styles.colKey, styles.colKeyCat, { borderBottomColor: c.border }]}>
          <ThemedText
            type="varsitySmall"
            style={[styles.colKeyText, styles.colKeyCatText, { color: c.secondaryText }]}
            accessibilityLabel="Stat line format: points, rebounds, assists, steals, blocks"
          >
            PTS / REB / AST / STL / BLK
          </ThemedText>
        </View>
      ) : sport === "nfl" ? null : (
        // NFL rows carry their units inline ("245.1Y 1.9TD") and the stat mix
        // varies by position, so a fixed column legend would be wrong — skip it.
        <View style={[styles.colKey, { borderBottomColor: c.border }]}>
          <View style={[styles.colKeyStats, styles.statsPoints]}>
            <ThemedText
              type="varsitySmall"
              style={[styles.colKeyText, { color: c.secondaryText }]}
            >
              PTS · REB · AST
            </ThemedText>
          </View>
          <View style={styles.colKeyAddSpacer} />
        </View>
      )}
      <FlatList<PlayerSeasonStats>
        data={displayPlayers}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.player_id}
        contentContainerStyle={styles.listContent}
        maxToRenderPerBatch={10}
        windowSize={5}
        removeClippedSubviews
        initialNumToRender={15}
      />
        </>
      )}
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
  // Category legend left-aligns under the info column (slashes render inline
  // beneath each name). paddingLeft ≈ row padding s(12) + portrait s(58) +
  // its marginRight s(10) so the legend starts at the name/stat column.
  colKeyCat: {
    justifyContent: "flex-start",
    paddingLeft: s(80),
  },
  colKeyCatText: {
    textAlign: "left" as const,
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
  // "My Board" sort toggle — rookie drafts only.
  boardSortRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  boardChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(4),
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(10),
    paddingVertical: s(4),
  },
  boardChipText: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  boardSortHint: {
    fontSize: ms(11),
    flexShrink: 1,
  },
  boardRank: {
    fontSize: ms(12),
    fontWeight: "800",
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
    // Floor the name column so the wide 5-stat category line can't crush it to
    // an unreadable sliver (the bug where names looked "covered" by the stats).
    minWidth: s(70),
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
  // Category rows: position + box-score slash share one line under the name,
  // and the name above gets the row's full width (no fixed right stat column).
  catMetaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: s(6),
    marginTop: 1,
  },
  catSlash: {
    fontSize: ms(11),
    flexShrink: 1,
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
  statLine: {
    fontSize: ms(10),
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
