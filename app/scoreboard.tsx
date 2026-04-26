import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  MatchupCard,
  type MatchupCardStatus,
  type MatchupCardTeam,
} from '@/components/scoreboard/MatchupCard';
import { WeekRail, type RailWeek, type WeekStatus } from '@/components/scoreboard/WeekRail';
import { BrandButton } from '@/components/ui/BrandButton';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { useWeekScores } from '@/hooks/useWeekScores';
import { supabase } from '@/lib/supabase';
import { toDateStr } from '@/utils/dates';
import { calcRounds, getPlayoffRoundLabel } from '@/utils/league/playoff';
import { ms, s } from '@/utils/scale';
import { formatScore } from '@/utils/scoring/fantasyPoints';

interface ScoreboardMatchup {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  playoff_round: number | null;
  home_category_wins: number | null;
  away_category_wins: number | null;
  category_ties: number | null;
  playoff_bracket: { is_third_place: boolean }[] | null;
}

interface LeagueTeam {
  id: string;
  name: string;
  logo_key: string | null;
  wins: number;
  losses: number;
  ties: number;
}

function getWeekStatus(week: RailWeek, today: string): WeekStatus {
  if (week.start_date > today) return 'future';
  if (week.end_date < today) return 'past';
  return 'live';
}

async function fetchWeeks(leagueId: string): Promise<RailWeek[]> {
  const { data, error } = await supabase
    .from('league_schedule')
    .select('id, week_number, start_date, end_date, is_playoff')
    .eq('league_id', leagueId)
    .order('week_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function fetchMatchups(scheduleId: string): Promise<ScoreboardMatchup[]> {
  const { data, error } = await supabase
    .from('league_matchups')
    .select(
      'id, home_team_id, away_team_id, home_score, away_score, playoff_round, home_category_wins, away_category_wins, category_ties, playoff_bracket(is_third_place)',
    )
    .eq('schedule_id', scheduleId);
  if (error) throw error;
  return data ?? [];
}

async function fetchPlayoffSeeds(
  leagueId: string,
  season: string,
  round: number,
): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('playoff_bracket')
    .select('team_a_id, team_a_seed, team_b_id, team_b_seed')
    .eq('league_id', leagueId)
    .eq('season', season)
    .eq('round', round);
  if (error) throw error;
  const map: Record<string, number> = {};
  for (const row of data ?? []) {
    if (row.team_a_id && row.team_a_seed) map[row.team_a_id] = row.team_a_seed;
    if (row.team_b_id && row.team_b_seed) map[row.team_b_id] = row.team_b_seed;
  }
  return map;
}

async function fetchLeagueTeams(
  leagueId: string,
): Promise<Record<string, LeagueTeam>> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, logo_key, wins, losses, ties')
    .eq('league_id', leagueId);
  if (error) throw error;
  const map: Record<string, LeagueTeam> = {};
  for (const t of data ?? []) {
    map[t.id] = {
      id: t.id,
      name: t.name,
      logo_key: t.logo_key ?? null,
      wins: t.wins ?? 0,
      losses: t.losses ?? 0,
      ties: t.ties ?? 0,
    };
  }
  return map;
}

function useWeeks(leagueId: string | null) {
  return useQuery({
    queryKey: queryKeys.leagueSchedule(leagueId!),
    queryFn: () => fetchWeeks(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

function useScoreboardData(
  week: RailWeek | null,
  leagueId: string | null,
  weekStatus: WeekStatus,
  season: string,
) {
  const matchupsQuery = useQuery({
    queryKey: queryKeys.scoreboardMatchups(week?.id ?? ''),
    queryFn: () => fetchMatchups(week!.id),
    enabled: !!week,
    staleTime: 1000 * 60 * 5,
    refetchInterval: weekStatus === 'live' ? 150_000 : false,
  });

  const teamsQuery = useQuery({
    queryKey: queryKeys.leagueTeamsRecord(leagueId!),
    queryFn: () => fetchLeagueTeams(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });

  const playoffRound = week?.is_playoff
    ? (matchupsQuery.data?.[0]?.playoff_round ?? null)
    : null;

  const seedsQuery = useQuery({
    queryKey: queryKeys.playoffSeeds(leagueId!, season, playoffRound!),
    queryFn: () => fetchPlayoffSeeds(leagueId!, season, playoffRound!),
    enabled: !!leagueId && !!season && playoffRound !== null,
    staleTime: 1000 * 60 * 5,
  });

  return {
    matchups: matchupsQuery.data,
    teamMap: teamsQuery.data,
    seedMap: seedsQuery.data ?? {},
    isPlayoff: week?.is_playoff ?? false,
    isLoading: matchupsQuery.isLoading || teamsQuery.isLoading,
  };
}

export default function ScoreboardScreen() {
  const router = useRouter();
  const c = useColors();
  const { leagueId, teamId } = useAppState();

  const queryClient = useQueryClient();
  const { data: league } = useLeague();
  const { data: weeks, isLoading: weeksLoading } = useWeeks(leagueId);
  const season = league?.season ?? CURRENT_NBA_SEASON;

  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['scoreboardMatchups'] });
      queryClient.invalidateQueries({ queryKey: ['weekScores'] });
      queryClient.invalidateQueries({ queryKey: ['leagueTeamsRecord'] });
    }, [queryClient]),
  );

  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number | null>(null);

  // Auto-select current week (or most recent past week) on first load.
  useEffect(() => {
    if (!weeks || weeks.length === 0 || selectedWeekIndex !== null) return;
    const today = toDateStr(new Date());
    const currentIdx = weeks.findIndex(
      (w) => w.start_date <= today && today <= w.end_date,
    );
    if (currentIdx >= 0) {
      setSelectedWeekIndex(currentIdx);
    } else {
      const pastWeeks = weeks.filter((w) => w.end_date < today);
      setSelectedWeekIndex(pastWeeks.length > 0 ? pastWeeks.length - 1 : 0);
    }
  }, [weeks, selectedWeekIndex]);

  const selectedWeek =
    weeks && selectedWeekIndex !== null ? weeks[selectedWeekIndex] : null;
  const today = toDateStr(new Date());
  const weekStatus: WeekStatus = selectedWeek
    ? getWeekStatus(selectedWeek, today)
    : 'past';

  const { matchups, teamMap, seedMap, isPlayoff, isLoading } = useScoreboardData(
    selectedWeek,
    leagueId,
    weekStatus,
    season,
  );

  const weekIsLive = weekStatus === 'live';
  const { data: weekScores } = useWeekScores({
    leagueId,
    scheduleId: selectedWeek?.id ?? null,
    weekIsLive,
  });

  const isCategories = league?.scoring_type === 'h2h_categories';
  const isOffseason = !!league?.offseason_step;

  // Sort: user's matchup floats to the top.
  const sortedMatchups = useMemo(() => {
    if (!matchups) return [];
    const isMine = (m: ScoreboardMatchup) =>
      m.home_team_id === teamId || m.away_team_id === teamId;
    return [...matchups].sort((a, b) => {
      if (isMine(a) && !isMine(b)) return -1;
      if (!isMine(a) && isMine(b)) return 1;
      return 0;
    });
  }, [matchups, teamId]);

  const cardStatus: MatchupCardStatus =
    weekStatus === 'live' ? 'live' : weekStatus === 'past' ? 'final' : 'upcoming';

  // For playoff weeks, derive a per-matchup round label
  // ("Finals", "Semifinals", "Quarterfinals", "3rd Place Game", "Round N").
  const totalPlayoffRounds = calcRounds(league?.playoff_teams ?? 8);
  const labelFor = (m: ScoreboardMatchup): string | null => {
    if (!isPlayoff || m.playoff_round == null) return null;
    const isThirdPlace = m.playoff_bracket?.[0]?.is_third_place ?? false;
    return getPlayoffRoundLabel(m.playoff_round, totalPlayoffRounds, isThirdPlace);
  };

  const buildTeam = (
    matchup: ScoreboardMatchup,
    sideTeamId: string,
  ): MatchupCardTeam | null => {
    const team = teamMap?.[sideTeamId];
    if (!team) return null;

    const score =
      weekScores && weekStatus !== 'future'
        ? (weekScores[sideTeamId] ?? 0)
        : sideTeamId === matchup.home_team_id
          ? (matchup.home_score ?? 0)
          : (matchup.away_score ?? 0);

    let display: string;
    if (isCategories) {
      if (matchup.home_category_wins != null) {
        const ties = matchup.category_ties ?? 0;
        const homeW = matchup.home_category_wins ?? 0;
        const awayW = matchup.away_category_wins ?? 0;
        const isHome = sideTeamId === matchup.home_team_id;
        const myW = isHome ? homeW : awayW;
        const oppW = isHome ? awayW : homeW;
        display = ties > 0 ? `${myW}-${oppW}-${ties}` : `${myW}-${oppW}`;
      } else {
        display = '—';
      }
    } else {
      display = formatScore(score);
    }

    return {
      id: team.id,
      name: team.name,
      logoKey: team.logo_key,
      record: `${team.wins}-${team.losses}${
        team.ties > 0 ? `-${team.ties}` : ''
      }`,
      score,
      display,
      seed: isPlayoff ? (seedMap[sideTeamId] ?? null) : null,
    };
  };

  if (isOffseason) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <PageHeader title="Scoreboard" />
        <View
          style={styles.offseason}
          accessible
          accessibilityRole="text"
          accessibilityLabel="It's the offseason. Games will return next season."
        >
          <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
          <Ionicons
            name="sunny-outline"
            size={ms(40)}
            color={c.secondaryText}
            accessible={false}
          />
          <ThemedText
            type="display"
            style={[styles.emptyTitle, { color: c.text }]}
          >
            Offseason.
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.emptySub, { color: c.secondaryText }]}
          >
            GAMES RETURN NEXT SEASON
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Scoreboard" />

      {weeks && weeks.length > 0 && selectedWeekIndex !== null && selectedWeek && (
        <WeekRail
          weeks={weeks}
          selectedIndex={selectedWeekIndex}
          onSelect={setSelectedWeekIndex}
          status={weekStatus}
        />
      )}

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {weeksLoading || isLoading ? (
          <View style={styles.loader}>
            <LogoSpinner />
          </View>
        ) : !weeks || weeks.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText style={{ color: c.secondaryText }}>
              Season schedule not generated yet.
            </ThemedText>
          </View>
        ) : sortedMatchups.length === 0 ? (
          <View style={styles.empty}>
            <ThemedText style={{ color: c.secondaryText, textAlign: 'center' }}>
              {isPlayoff
                ? 'Bye round — top seeds advance automatically.'
                : 'No matchups this week.'}
            </ThemedText>
            {isPlayoff && (
              <BrandButton
                label="View Full Bracket"
                onPress={() => router.push('/playoff-bracket' as any)}
                variant="secondary"
                style={styles.bracketBtnSpacing}
              />
            )}
          </View>
        ) : (
          <>
            {sortedMatchups.map((matchup) => {
              const home = buildTeam(matchup, matchup.home_team_id);
              const away = matchup.away_team_id
                ? buildTeam(matchup, matchup.away_team_id)
                : null;

              if (!home) return null;

              const isMine =
                matchup.home_team_id === teamId ||
                matchup.away_team_id === teamId;

              // Winning side calculation. Categories use category-win counts;
              // points leagues use the live score.
              let winningSide: 'home' | 'away' | null = null;
              if (away && weekStatus !== 'future') {
                if (isCategories) {
                  const hWins = matchup.home_category_wins ?? 0;
                  const aWins = matchup.away_category_wins ?? 0;
                  if (hWins > aWins) winningSide = 'home';
                  else if (aWins > hWins) winningSide = 'away';
                } else {
                  if (home.score > away.score) winningSide = 'home';
                  else if (away.score > home.score) winningSide = 'away';
                }
              }

              return (
                <MatchupCard
                  key={matchup.id}
                  home={home}
                  away={away}
                  status={cardStatus}
                  isMine={isMine}
                  hideScores={weekStatus === 'future'}
                  isCategories={isCategories}
                  winningSide={winningSide}
                  roundLabel={labelFor(matchup)}
                  onPress={() =>
                    router.push(`/matchup-detail/${matchup.id}` as any)
                  }
                />
              );
            })}

            {isPlayoff && (
              <View style={styles.bracketBtnWrap}>
                <BrandButton
                  label="View Full Bracket"
                  onPress={() => router.push('/playoff-bracket' as any)}
                  variant="secondary"
                />
              </View>
            )}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(40),
  },
  loader: {
    marginTop: s(40),
    alignItems: 'center',
  },
  empty: {
    alignItems: 'center',
    paddingTop: s(40),
    gap: s(16),
  },
  offseason: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(32),
    gap: s(10),
  },
  emptyRule: {
    height: 2,
    width: s(48),
    marginBottom: s(8),
  },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: ms(11),
    letterSpacing: 1.3,
    textAlign: 'center',
  },
  bracketBtnWrap: {
    alignItems: 'center',
    marginTop: s(8),
  },
  bracketBtnSpacing: {
    marginTop: s(8),
  },
});
