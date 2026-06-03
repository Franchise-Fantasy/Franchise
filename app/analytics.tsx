import { type ReactNode, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnalyticsEmptyState } from "@/components/analytics/AnalyticsEmptyState";
import { CatAnalytics } from "@/components/analytics/CatAnalytics";
import { PointsAgeAnalytics } from "@/components/analytics/PointsAgeAnalytics";
import { PointsStrengthAnalytics } from "@/components/analytics/PointsStrengthAnalytics";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { type PositionCurve } from "@/constants/agingCurves";
import { type Sport } from "@/constants/LeagueDefaults";
import { useAppState } from "@/context/AppStateProvider";
import { useColors } from "@/hooks/useColors";
import { useLeague } from "@/hooks/useLeague";
import { useLeagueRosterStats } from "@/hooks/useLeagueRosterStats";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { usePrevSeasonFpts } from "@/hooks/usePrevSeasonFpts";
import { s } from "@/utils/scale";

/**
 * Roster Analytics — routes to one of three views by league shape:
 *   • categories            → CatAnalytics (radar + age, dynasty-aware)
 *   • points + dynasty       → PointsAgeAnalytics (age-vs-production)
 *   • points + keeper/redraft→ PointsStrengthAnalytics (FPTS strength, no age)
 * Age framing only means something for multi-year (dynasty) rosters.
 */
export default function AnalyticsScreen() {
  const c = useColors();
  const { leagueId, teamId } = useAppState();

  const { data: league } = useLeague();
  const isCategories = league?.scoring_type === "h2h_categories";
  const isDynasty = (league?.league_type ?? "dynasty") === "dynasty";

  const { data: allPlayers, isLoading: loadingPlayers } = useLeagueRosterStats(
    leagueId!,
  );
  const { data: weights, isLoading: loadingScoring } = useLeagueScoring(
    leagueId!,
  );

  // Pre-tipoff WNBA / first-month NBA / categories leagues all read 0 fpts
  // for current season. Pull last season's avg fpts as a fallback weight so
  // weighted-age / strength math has a meaningful denominator. The hook
  // returns an empty map otherwise (no extra rows fetched).
  const allPlayerIds = useMemo(
    () => (allPlayers ?? []).map((p) => p.player_id),
    [allPlayers],
  );
  const sport: Sport = (league?.sport as Sport | undefined) ?? "nba";
  const { data: prevSeasonFptsMap } = usePrevSeasonFpts(
    leagueId,
    sport,
    allPlayerIds,
    weights,
  );

  // Aging-curve chip set — WNBA uses canonical basketball positions
  // (G/F/C); other sports use the NBA spectrum. Filter logic for G/F
  // already maps PG/SG → G and SF/PF → F, so chip semantics match.
  const curveChips: PositionCurve[] = sport === "wnba"
    ? ["ALL", "G", "F", "C"]
    : ["ALL", "PG", "SG", "SF", "PF", "C"];

  // My team's players (for scatter / leaderboard / detail modal)
  const players = useMemo(
    () => allPlayers?.filter((p) => p.team_id === teamId) ?? [],
    [allPlayers, teamId],
  );

  const isLoading = loadingPlayers || loadingScoring;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <View style={styles.loading}>
        <LogoSpinner />
      </View>
    );
  } else if (isCategories) {
    body = allPlayers && allPlayers.length > 0 ? (
      <CatAnalytics
        allPlayers={allPlayers as any}
        myPlayers={players}
        weights={weights}
        scoringType={league?.scoring_type}
        teamId={teamId!}
        leagueId={leagueId!}
        isDynasty={isDynasty}
      />
    ) : (
      <AnalyticsEmptyState
        title="Nothing to chart yet."
        sub="NO LEAGUE DATA · CHECK BACK SOON"
      />
    );
  } else if (isDynasty) {
    body = (
      <PointsAgeAnalytics
        players={players}
        allPlayers={(allPlayers ?? []) as any}
        weights={weights}
        scoringType={league?.scoring_type}
        prevSeasonFptsMap={prevSeasonFptsMap}
        teamId={teamId!}
        leagueId={leagueId!}
        sport={sport}
        curveChips={curveChips}
      />
    );
  } else {
    body = (
      <PointsStrengthAnalytics
        players={players}
        allPlayers={(allPlayers ?? []) as any}
        weights={weights}
        scoringType={league?.scoring_type}
        prevSeasonFptsMap={prevSeasonFptsMap}
        teamId={teamId!}
        leagueId={leagueId!}
        sport={sport}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Roster Analytics" />
      <View style={styles.content}>{body}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: s(16), paddingTop: s(10) },
  loading: { marginTop: s(40) },
});
