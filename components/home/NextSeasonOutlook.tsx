import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { HomeListCard, RostersPill } from '@/components/home/HomeListCard';
import { TeamLogo } from '@/components/team/TeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColors } from '@/hooks/useColors';
import { useLeagueRosterStats } from '@/hooks/useLeagueRosterStats';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePrevSeasonFpts } from '@/hooks/usePrevSeasonFpts';
import { fetchStandingsTeams } from '@/utils/league/standingsQueries';
import { buildLeagueStrengthComparison } from '@/utils/roster/rosterStrength';
import { ms, s } from '@/utils/scale';
import { ANALYTICS_MIN_CURRENT_SEASON_GAMES } from '@/utils/scoring/fantasyPoints';

interface Props {
  leagueId: string;
  sport: Sport;
  /** The season about to be played — titles the card so the ranking is clearly
   *  forward-looking rather than a recap of the one that just ended. */
  season: string;
}

/**
 * Offseason replacement for the rookie-draft-order card, shown once the rookie
 * draft is done. Ranks every team by the per-game fantasy output of its active
 * roster, so the last thing the home screen says about the offseason is "here's
 * where your team stands going into next year" rather than a draft recap — the
 * full draft board already lives in League History → Drafts.
 */
export function NextSeasonOutlook({ leagueId, sport, season }: Props) {
  const c = useColors();
  const router = useRouter();
  const { teamId } = useAppState();

  const {
    data: allPlayers,
    isLoading: loadingPlayers,
    isError: playersError,
    refetch: refetchPlayers,
  } = useLeagueRosterStats(leagueId);
  const {
    data: weights,
    isLoading: loadingScoring,
    isError: scoringError,
    refetch: refetchScoring,
  } = useLeagueScoring(leagueId);

  // Team identity for the leaderboard. Deliberately the standings query key —
  // it's already in cache from StandingsSection / the Standings tab, so the card
  // usually costs no extra round-trip.
  const {
    data: teams,
    isError: teamsError,
    refetch: refetchTeams,
  } = useQuery({
    queryKey: queryKeys.standings(leagueId),
    queryFn: () => fetchStandingsTeams(leagueId),
    enabled: !!leagueId,
  });
  const teamById = useMemo(() => {
    const m = new Map<string, { name: string; logo_key: string | null; tricode: string | null }>();
    for (const t of teams ?? []) m.set(t.id, { name: t.name, logo_key: t.logo_key, tricode: t.tricode });
    return m;
  }, [teams]);

  // Load-bearing in the offseason, not a nicety: once season_config rolls to the
  // upcoming season the current-season matview has zero games, so EVERY player
  // falls through to this map. Without it the whole league ranks 0.0.
  const allPlayerIds = useMemo(() => (allPlayers ?? []).map((p) => p.player_id), [allPlayers]);
  const {
    data: prevSeasonFptsMap,
    isLoading: loadingPrevSeason,
    isError: prevSeasonError,
    refetch: refetchPrevSeason,
  } = usePrevSeasonFpts(leagueId, sport, allPlayerIds, weights);

  const comparison = useMemo(() => {
    if (!allPlayers?.length || !weights?.length || !teamId) return null;
    return buildLeagueStrengthComparison(allPlayers, weights, teamId, {
      prevSeasonFptsMap,
      minGames: ANALYTICS_MIN_CURRENT_SEASON_GAMES,
      sport,
      // Just-drafted rookies have no pro history, so they score 0 and sit on the
      // bench (which counts as active). Averaging them in would penalise exactly
      // the teams that acquired the most picks.
      excludeUnscored: true,
    });
  }, [allPlayers, weights, teamId, prevSeasonFptsMap, sport]);

  const isLoading = loadingPlayers || loadingScoring || loadingPrevSeason;
  // The prev-season map failing isn't cosmetic here (see above — in the
  // offseason it IS the data), so any failed source gets the error state
  // rather than a confidently wrong all-zeros ranking.
  const isError = playersError || scoringError || teamsError || prevSeasonError;
  const profiles = comparison?.allProfiles ?? [];

  return (
    <HomeListCard
      label={`${season} Outlook`}
      accessory={<RostersPill teamId={profiles[0]?.teamId ?? null} />}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => {
        if (playersError) refetchPlayers();
        if (scoringError) refetchScoring();
        if (teamsError) refetchTeams();
        if (prevSeasonError) refetchPrevSeason();
      }}
      empty={profiles.length === 0}
      emptyText="Team outlook will appear once rosters are set."
    >
      <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
        <ThemedText type="varsitySmall" style={[styles.rank, { color: c.secondaryText }]}>#</ThemedText>
        <View style={{ width: s(26) }} />
        <ThemedText type="varsitySmall" style={[styles.teamCol, { color: c.secondaryText }]}>
          Team
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.value, { color: c.secondaryText }]}>
          FP/G
        </ThemedText>
      </View>
      {profiles.map((p, i) => {
        const meta = teamById.get(p.teamId);
        const name = meta?.name ?? 'Unknown';
        const isMe = p.teamId === teamId;
        const isLast = i === profiles.length - 1;
        return (
          <TouchableOpacity
            key={p.teamId}
            style={[
              styles.row,
              { borderBottomColor: c.border },
              isMe && { backgroundColor: c.activeCard },
              isLast && { borderBottomWidth: 0 },
            ]}
            onPress={() => router.push(`/team-roster/${p.teamId}` as never)}
            activeOpacity={0.6}
            accessibilityRole="button"
            accessibilityHint="View team roster"
            accessibilityLabel={`${name}, projected ${i + 1} of ${profiles.length}, ${p.avgFpts} fantasy points per game across ${p.playerCount} rated players`}
          >
            <ThemedText type="mono" style={[styles.rank, { color: c.secondaryText }]}>
              {i + 1}
            </ThemedText>
            <TeamLogo
              logoKey={meta?.logo_key}
              teamName={name}
              tricode={meta?.tricode ?? undefined}
              size="small"
            />
            <View style={styles.nameWrap}>
              <ThemedText
                style={[styles.teamName, { color: c.text }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {name}
              </ThemedText>
            </View>
            <ThemedText type="mono" style={[styles.value, { color: isMe ? c.gold : c.text }]}>
              {p.avgFpts.toFixed(1)}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
      {/* The basis matters here — a reader who doesn't know rookies are
          unrated would read a thin post-draft roster as a strong one. */}
      <ThemedText style={[styles.footnote, { color: c.secondaryText }]}>
        Per-game average across each team&apos;s active roster, from last season&apos;s
        numbers. Rookies without a pro season yet aren&apos;t rated.
      </ThemedText>
    </HomeListCard>
  );
}

const styles = StyleSheet.create({
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(9),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -s(4),
  },
  nameWrap: {
    flex: 1,
    marginLeft: s(8),
    minWidth: 0,
  },
  rank: {
    width: s(18),
    fontSize: ms(12),
    textAlign: 'left',
  },
  teamCol: {
    flex: 1,
    fontSize: ms(13),
    marginLeft: s(8),
  },
  teamName: {
    fontSize: ms(13),
    fontWeight: '500',
  },
  value: {
    width: s(52),
    textAlign: 'right',
    fontSize: ms(12),
  },
  footnote: {
    fontSize: ms(10),
    lineHeight: ms(14),
    paddingTop: s(9),
    paddingBottom: s(2),
  },
});
