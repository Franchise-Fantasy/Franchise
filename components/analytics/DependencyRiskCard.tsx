import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { TeamLogo } from "@/components/team/TeamLogo";
import { InfoModal } from "@/components/ui/InfoModal";
import { ListRow } from "@/components/ui/ListRow";
import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts, cardShadow } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { useLeagueRosterConfig } from "@/hooks/useLeagueRosterConfig";
import { type LeaguePlayerWithTeam } from "@/hooks/useLeagueRosterStats";
import { usePrevSeasonCatProduction } from "@/hooks/usePrevSeasonProduction";
import { type ScoringWeight } from "@/types/player";
import { fetchStandingsTeams } from "@/utils/league/standingsQueries";
import { isActiveRosterSlot } from "@/utils/roster/rosterSlots";
import { ms, s } from "@/utils/scale";
import {
  assignDependencyLevels,
  computeDependencyRisk,
  dependencyTopN,
  leagueMaxGamesPlayed,
  type DependencyLevel,
} from "@/utils/scoring/dependencyRisk";

interface DependencyRiskCardProps {
  allPlayers: LeaguePlayerWithTeam[];
  weights: ScoringWeight[] | undefined;
  scoringType: string | undefined;
  teamId: string;
  leagueId: string;
  /** Prev-season fpts/g per player, for POINTS leagues. Without it a league
   *  that hasn't tipped off has no production to rank and the card reads 0%
   *  for everyone. Categories leagues ignore this and fetch their own
   *  cat-contribution map below — fpts isn't their currency. */
  prevSeasonFptsMap?: Map<string, number>;
}

/**
 * League-wide "Dependency Risk" overview — what share of each team's
 * games-weighted production comes from its top few players, ranked most- to
 * least-concentrated. A roster-shape signal (lives in Roster Analytics).
 * Self-contained: computes risk + adaptive thresholds and reuses the cached
 * standings / roster-config queries, so callers pass only roster data.
 */
export function DependencyRiskCard({
  allPlayers,
  weights,
  scoringType,
  teamId,
  leagueId,
  prevSeasonFptsMap,
}: DependencyRiskCardProps) {
  const c = useColors();
  const [infoVisible, setInfoVisible] = useState(false);
  const isCategories = scoringType === "h2h_categories";
  // Scoring must be evaluated with the league's sport, or an NFL roster's
  // production sums to zero and every team shows 0% dependency.
  const sport = useActiveLeagueSport(leagueId);

  // Team names/logos/tricodes for the rows. Shares the standings query key, so
  // it's already in cache whenever the user has seen Standings or the home
  // preview — no extra round-trip.
  const { data: teams } = useQuery({
    queryKey: queryKeys.standings(leagueId),
    queryFn: () => fetchStandingsTeams(leagueId),
    enabled: !!leagueId,
  });
  const teamById = useMemo(() => {
    const m = new Map<
      string,
      { name: string; tricode: string | null; logo_key: string | null }
    >();
    for (const t of teams ?? []) {
      m.set(t.id, { name: t.name, tricode: t.tricode, logo_key: t.logo_key });
    }
    return m;
  }, [teams]);

  // How many players each bar covers, from the league's active roster size
  // (starters + bench; isActiveRosterSlot drops IR/taxi, which aren't playing).
  // Shares the roster-config query key with the roster tab.
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId);
  const topN = useMemo(() => {
    if (!rosterConfig?.length) return dependencyTopN(undefined);
    const activeSlots = rosterConfig
      .filter((slot) => isActiveRosterSlot(slot.position))
      .reduce((sum, slot) => sum + slot.slot_count, 0);
    return dependencyTopN(activeSlots);
  }, [rosterConfig]);

  // Categories leagues need last season's composite cat contribution, not fpts.
  // Only fetched for those leagues; points leagues get the map from their page.
  const catPlayerIds = useMemo(
    () => (isCategories ? (allPlayers ?? []).map((p) => p.player_id) : []),
    [isCategories, allPlayers],
  );
  const { data: prevSeasonCatMap } = usePrevSeasonCatProduction(
    leagueId,
    sport,
    catPlayerIds,
  );
  const prevSeasonMap = isCategories ? prevSeasonCatMap : prevSeasonFptsMap;

  const depResults = useMemo(() => {
    if (!allPlayers?.length || !weights?.length) return [];
    return computeDependencyRisk(allPlayers, weights, {
      scoringType,
      sport,
      prevSeasonMap,
      topN,
    });
  }, [allPlayers, weights, scoringType, sport, prevSeasonMap, topN]);

  // No games logged league-wide → the shares below come from last season, which
  // the footnote says out loud rather than passing them off as this season's.
  const preseason = useMemo(
    () => leagueMaxGamesPlayed(allPlayers ?? []) === 0,
    [allPlayers],
  );

  // Sorted by top-N share (most concentrated first) so the bars descend and the
  // color ramp reads top-to-bottom in lock-step with the % shown.
  const depSorted = useMemo(
    () => [...depResults].sort((a, b) => b.topPct - a.topPct),
    [depResults],
  );

  // Risk level per team, ranked relative to the rest of the league.
  const depLevels = useMemo(() => assignDependencyLevels(depResults), [depResults]);

  function depColor(level: DependencyLevel | undefined): string {
    if (level === "high") return c.danger;
    if (level === "moderate") return c.warning;
    return c.success;
  }

  const levelWord: Record<DependencyLevel, string> = {
    high: "high concentration",
    moderate: "moderate concentration",
    deep: "deep roster",
  };

  // Every team at 0% is a wall of empty bars that reads as broken — say there's
  // nothing to rank yet instead (categories leagues before tip-off, mainly).
  const hasProduction = depSorted.some((r) => r.topPct > 0);

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
      <View style={styles.eyebrowRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText
          type="varsitySmall"
          style={[styles.eyebrow, { color: c.secondaryText, flex: 1 }]}
        >
          DEPENDENCY RISK
        </ThemedText>
        <TouchableOpacity
          onPress={() => setInfoVisible(true)}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="What dependency risk measures"
        >
          <Ionicons name="information-circle-outline" size={ms(18)} color={c.secondaryText} />
        </TouchableOpacity>
      </View>
      <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
        Share of season production from each team&apos;s top {topN} — the most
        concentrated rosters in your league are flagged
      </ThemedText>

      {depSorted.length === 0 || !hasProduction ? (
        <ThemedText style={[styles.placeholder, { color: c.secondaryText }]}>
          {depSorted.length === 0
            ? "Roster data unavailable"
            : "No production to rank yet — check back once the season tips off."}
        </ThemedText>
      ) : (
        depSorted.map((r, idx) => {
          const team = teamById.get(r.teamId);
          if (!team) return null;
          const isViewed = r.teamId === teamId;
          const pct = Math.round(r.topPct * 100);
          const level = depLevels.get(r.teamId);
          const color = depColor(level);
          return (
            <ListRow
              key={r.teamId}
              index={idx}
              total={depSorted.length}
              isActive={isViewed}
              accessibilityLabel={`${team.name}, ${pct}% from top ${topN}${preseason ? " based on last season" : ""}, ${level ? levelWord[level] : "deep roster"}: ${r.topPlayers.join(", ")}`}
            >
              <View style={styles.logo}>
                <TeamLogo
                  logoKey={team.logo_key}
                  teamName={team.name}
                  tricode={team.tricode ?? undefined}
                  size="small"
                />
              </View>
              <ThemedText
                style={[styles.teamName, { color: c.text, fontWeight: isViewed ? "700" : "500" }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {team.name}
              </ThemedText>
              <View style={[styles.barOuter, { backgroundColor: c.border }]}>
                <View style={[styles.barInner, { width: `${pct}%`, backgroundColor: color }]} />
              </View>
              <Text style={[styles.pct, { color }]}>{pct}%</Text>
            </ListRow>
          );
        })
      )}

      {preseason && hasProduction ? (
        <ThemedText style={[styles.footnote, { color: c.secondaryText }]}>
          Based on last season — no games played yet
        </ThemedText>
      ) : null}

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="Dependency Risk"
      >
        <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
          The bar shows how much of a team&apos;s season production comes from
          its top {topN} players, weighted by games played. That&apos;s a
          quarter of your active roster — deeper rosters get a wider bar so the
          number means the same thing in any league. IR and taxi stashes are
          left out.
        </ThemedText>
        <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
          Colors are ranked relative to your league — the teams leaning hardest
          on their top {topN} are{" "}
          <ThemedText style={{ fontWeight: "700", color: c.text }}>High</ThemedText>{" "}
          (more fragile: an injury or rest day hits their output harder), and the
          most balanced are{" "}
          <ThemedText style={{ fontWeight: "700", color: c.text }}>Deep</ThemedText>.
          So this always highlights the relative risk within your league, even
          when every roster is fairly balanced.
        </ThemedText>
      </InfoModal>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(14),
    paddingTop: s(12),
    paddingBottom: s(10),
    // Breathing room from the chart / footnote above it.
    marginTop: s(18),
    marginBottom: s(14),
  },
  eyebrowRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: s(8),
    marginBottom: s(4),
  },
  rule: {
    height: 2,
    width: s(18),
  },
  eyebrow: {
    fontSize: ms(9.5),
    letterSpacing: 1.3,
  },
  subtitle: {
    fontSize: ms(12),
    lineHeight: ms(16),
    marginBottom: s(12),
  },
  placeholder: {
    fontSize: ms(14),
    textAlign: "center",
    paddingVertical: s(20),
  },
  footnote: {
    fontSize: ms(11),
    fontStyle: "italic",
    textAlign: "center",
    marginTop: s(8),
  },
  logo: {
    width: s(28),
    alignItems: "flex-start",
  },
  teamName: {
    width: s(74),
    fontSize: ms(12),
    marginLeft: s(6),
  },
  barOuter: {
    flex: 1,
    height: s(10),
    borderRadius: 4,
    marginHorizontal: s(10),
    overflow: "hidden",
    opacity: 0.35,
  },
  barInner: {
    height: "100%",
    borderRadius: 4,
    opacity: 1,
  },
  pct: {
    width: s(40),
    textAlign: "right",
    fontSize: ms(11.5),
    fontFamily: Fonts.mono,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  modalBody: {
    fontSize: ms(13),
    lineHeight: ms(20),
    marginBottom: s(10),
  },
});
