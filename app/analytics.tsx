import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AnalyticsEmptyState } from "@/components/analytics/AnalyticsEmptyState";
import { CatAnalytics } from "@/components/analytics/CatAnalytics";
import { PointsAgeAnalytics } from "@/components/analytics/PointsAgeAnalytics";
import { PointsStrengthAnalytics } from "@/components/analytics/PointsStrengthAnalytics";
import { TeamRail } from "@/components/analytics/TeamRail";
import { CoachMark } from "@/components/ui/CoachMark";
import { LogoSpinner } from "@/components/ui/LogoSpinner";
import { PageHeader } from "@/components/ui/PageHeader";
import { type PositionCurve } from "@/constants/agingCurves";
import { type Sport } from "@/constants/LeagueDefaults";
import { queryKeys } from "@/constants/queryKeys";
import { useAppState } from "@/context/AppStateProvider";
import { useColors } from "@/hooks/useColors";
import { useLeague } from "@/hooks/useLeague";
import { useLeagueRosterStats } from "@/hooks/useLeagueRosterStats";
import { useLeagueScoring } from "@/hooks/useLeagueScoring";
import { usePrevSeasonFpts } from "@/hooks/usePrevSeasonFpts";
import { fetchStandingsTeams } from "@/utils/league/standingsQueries";
import { s } from "@/utils/scale";
import { getSportModule } from "@/utils/sports/registry";

/**
 * Roster Analytics — routes to one of three views by league shape:
 *   • categories            → CatAnalytics (radar + age, dynasty-aware)
 *   • points + dynasty       → PointsAgeAnalytics (age-vs-production)
 *   • points + keeper/redraft→ PointsStrengthAnalytics (FPTS strength, no age)
 * Age framing only means something for multi-year (dynasty) rosters.
 *
 * The TeamRail repoints every view at any team in the league. Two ids flow down
 * as a result: `teamId` is the team being charted, `myTeamId` is the signed-in
 * user's — the latter feeds PlayerDetailModal, whose add/drop actions must
 * always target the user's own roster no matter whose chart is on screen.
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

  // Standings order drives the rail. Shares the standings query key, so it's
  // already cached whenever the user has seen the Standings tab or the home
  // StandingsSection — and PointsStrengthAnalytics reads the same key for its
  // leaderboard names/logos.
  const { data: standingsTeams } = useQuery({
    queryKey: queryKeys.standings(leagueId!),
    queryFn: () => fetchStandingsTeams(leagueId!),
    enabled: !!leagueId,
  });

  // The selection is stored against the league it was made in, so switching
  // leagues falls back to the user's own team without an effect to reset it —
  // a team id from the old league would match nothing in the new one.
  const [viewed, setViewed] = useState<{ leagueId: string; teamId: string } | null>(
    null,
  );
  const activeTeamId = (viewed?.leagueId === leagueId ? viewed.teamId : null) ?? teamId;
  const isMyTeam = activeTeamId === teamId;

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

  // Position-filter chips for the scatter, straight from the sport registry —
  // NBA adds the G/F group chips on top of its five tokens (the filter maps
  // PG/SG → G and SF/PF → F), WNBA already reports bare G/F/C, and NFL gets
  // QB/RB/WR/TE/K/DST. Hardcoding basketball here was why an NFL league saw
  // five chips that matched none of its players.
  const curveChips: PositionCurve[] = [
    "ALL",
    ...(getSportModule(sport).positions as readonly PositionCurve[]),
    ...(sport === "nba" ? (["G", "F"] as PositionCurve[]) : []),
  ];

  // The charted team's players (for scatter / leaderboard / detail modal)
  const players = useMemo(
    () => allPlayers?.filter((p) => p.team_id === activeTeamId) ?? [],
    [allPlayers, activeTeamId],
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
        teamId={activeTeamId!}
        myTeamId={teamId!}
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
        teamId={activeTeamId!}
        myTeamId={teamId!}
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
        teamId={activeTeamId!}
        myTeamId={teamId!}
        leagueId={leagueId!}
        sport={sport}
      />
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Roster Analytics" />

      {standingsTeams && standingsTeams.length > 1 && activeTeamId ? (
        <TeamRail
          teams={standingsTeams}
          selectedTeamId={activeTeamId}
          myTeamId={teamId!}
          onSelect={(id) => setViewed({ leagueId: leagueId!, teamId: id })}
        />
      ) : null}

      <View style={styles.content}>
        {/* Keyed on the charted team so the chart's zoom, selected dot and
            scroll position reset when the user switches teams — a stale zoom
            window from one roster means nothing on the next. */}
        <View key={activeTeamId ?? "none"} style={styles.body}>
          {body}
        </View>

        {/* First-visit hint for the scatter's tap + pinch gestures. */}
        <CoachMark
          id="analytics-chart"
          text="Tap a dot for player details. Pinch to stretch an axis and pull clustered players apart."
          bottom={16}
          active={
            isMyTeam &&
            isDynasty &&
            !isCategories &&
            !isLoading &&
            players.length >= 3
          }
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { flex: 1, paddingHorizontal: s(16), paddingTop: s(10) },
  body: { flex: 1 },
  loading: { marginTop: s(40) },
});
