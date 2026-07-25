import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

import { InfoModal } from "@/components/ui/InfoModal";
import { ListRow } from "@/components/ui/ListRow";
import { ThemedText } from "@/components/ui/ThemedText";
import { Fonts, cardShadow } from "@/constants/Colors";
import { queryKeys } from "@/constants/queryKeys";
import { useActiveLeagueSport } from "@/hooks/useActiveLeagueSport";
import { useColors } from "@/hooks/useColors";
import { type LeaguePlayerWithTeam } from "@/hooks/useLeagueRosterStats";
import { type ScoringWeight } from "@/types/player";
import { fetchStandingsTeams } from "@/utils/league/standingsQueries";
import { ms, s } from "@/utils/scale";
import {
  assignDependencyLevels,
  computeDependencyRisk,
  type DependencyLevel,
} from "@/utils/scoring/dependencyRisk";

interface DependencyRiskCardProps {
  allPlayers: LeaguePlayerWithTeam[];
  weights: ScoringWeight[] | undefined;
  scoringType: string | undefined;
  teamId: string;
  leagueId: string;
}

/**
 * League-wide "Dependency Risk" overview — what share of each team's
 * games-weighted production comes from its top 3 players, ranked most- to
 * least-concentrated. A roster-shape signal (lives in Roster Analytics).
 * Self-contained: computes risk + adaptive thresholds and reuses the cached
 * standings teams query for display names, so callers pass only roster data.
 */
export function DependencyRiskCard({
  allPlayers,
  weights,
  scoringType,
  teamId,
  leagueId,
}: DependencyRiskCardProps) {
  const c = useColors();
  const [infoVisible, setInfoVisible] = useState(false);
  // Scoring must be evaluated with the league's sport, or an NFL roster's
  // production sums to zero and every team shows 0% dependency.
  const sport = useActiveLeagueSport(leagueId);

  // Team names/tricodes for the rows. Shares the standings query key, so it's
  // already in cache whenever the user has seen Standings or the home preview —
  // no extra round-trip.
  const { data: teams } = useQuery({
    queryKey: queryKeys.standings(leagueId),
    queryFn: () => fetchStandingsTeams(leagueId),
    enabled: !!leagueId,
  });
  const teamById = useMemo(() => {
    const m = new Map<string, { name: string; tricode: string | null }>();
    for (const t of teams ?? []) m.set(t.id, { name: t.name, tricode: t.tricode });
    return m;
  }, [teams]);

  const depResults = useMemo(() => {
    if (!allPlayers?.length || !weights?.length) return [];
    return computeDependencyRisk(allPlayers, weights, scoringType, sport);
  }, [allPlayers, weights, scoringType, sport]);

  // Sorted by top-3 share (most concentrated first) so the bars descend and the
  // color ramp reads top-to-bottom in lock-step with the % shown.
  const depSorted = useMemo(
    () => [...depResults].sort((a, b) => b.topThreePct - a.topThreePct),
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
        Share of season production from each team's top 3 — the most
        concentrated rosters in your league are flagged
      </ThemedText>

      {depSorted.length === 0 ? (
        <ThemedText style={[styles.placeholder, { color: c.secondaryText }]}>
          Roster data unavailable
        </ThemedText>
      ) : (
        depSorted.map((r, idx) => {
          const team = teamById.get(r.teamId);
          if (!team) return null;
          const isViewed = r.teamId === teamId;
          const pct = Math.round(r.topThreePct * 100);
          const level = depLevels.get(r.teamId);
          const color = depColor(level);
          return (
            <ListRow
              key={r.teamId}
              index={idx}
              total={depSorted.length}
              isActive={isViewed}
              accessibilityLabel={`${team.name}, ${pct}% from top 3, ${level ? levelWord[level] : "deep roster"}: ${r.topThreePlayers.join(", ")}`}
            >
              <ThemedText
                style={[styles.teamName, { color: c.text, fontWeight: isViewed ? "700" : "500" }]}
                numberOfLines={1}
              >
                {team.tricode ?? team.name.slice(0, 10)}
              </ThemedText>
              <View style={[styles.barOuter, { backgroundColor: c.border }]}>
                <View style={[styles.barInner, { width: `${pct}%`, backgroundColor: color }]} />
              </View>
              <Text style={[styles.pct, { color }]}>{pct}%</Text>
            </ListRow>
          );
        })
      )}

      <InfoModal
        visible={infoVisible}
        onClose={() => setInfoVisible(false)}
        title="Dependency Risk"
      >
        <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
          The bar shows how much of a team's season production comes from its top
          3 players, weighted by games played.
        </ThemedText>
        <ThemedText style={[styles.modalBody, { color: c.secondaryText }]}>
          Colors are ranked relative to your league — the teams leaning hardest
          on their top 3 are{" "}
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
  teamName: {
    width: s(68),
    fontSize: ms(12),
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
