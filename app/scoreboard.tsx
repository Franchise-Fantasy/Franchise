import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useWeekScores } from '@/hooks/useWeekScores';
import { supabase } from '@/lib/supabase';
import { formatScore } from '@/utils/fantasyPoints';
import { ms, s } from '@/utils/scale';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { useLeague } from '@/hooks/useLeague';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { toDateStr, parseLocalDate } from '@/utils/dates';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/ui/PageHeader';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

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
}

interface LeagueTeam {
  id: string;
  name: string;
  wins: number;
  losses: number;
  ties: number;
}

type WeekState = 'past' | 'live' | 'future';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatWeekRange(start: string, end: string): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(parseLocalDate(start))} – ${fmt(parseLocalDate(end))}`;
}

function getWeekState(week: Week, today: string): WeekState {
  if (week.start_date > today) return 'future';
  if (week.end_date < today) return 'past';
  return 'live';
}

// ─── Data fetching ───────────────────────────────────────────────────────────

async function fetchWeeks(leagueId: string): Promise<Week[]> {
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
    .select('id, home_team_id, away_team_id, home_score, away_score, playoff_round, home_category_wins, away_category_wins, category_ties')
    .eq('schedule_id', scheduleId);
  if (error) throw error;
  return data ?? [];
}

// Fetch seeds for playoff week (team_id → seed number)
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

async function fetchLeagueTeams(leagueId: string): Promise<Record<string, LeagueTeam>> {
  const { data, error } = await supabase
    .from('teams')
    .select('id, name, wins, losses, ties')
    .eq('league_id', leagueId);
  if (error) throw error;
  const map: Record<string, LeagueTeam> = {};
  for (const t of data ?? []) map[t.id] = t;
  return map;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useWeeks(leagueId: string | null) {
  return useQuery({
    queryKey: queryKeys.leagueSchedule(leagueId!),
    queryFn: () => fetchWeeks(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

function useScoreboardData(
  week: Week | null,
  leagueId: string | null,
  weekState: WeekState,
  season: string,
) {
  // Matchups for the selected week
  const matchupsQuery = useQuery({
    queryKey: queryKeys.scoreboardMatchups(week?.id ?? ''),
    queryFn: () => fetchMatchups(week!.id),
    enabled: !!week,
    staleTime: 1000 * 60 * 5,
    refetchInterval: weekState === 'live' ? 150_000 : false,
  });

  // All teams in the league
  const teamsQuery = useQuery({
    queryKey: queryKeys.leagueTeamsRecord(leagueId!),
    queryFn: () => fetchLeagueTeams(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });

  // Determine playoff round from matchups
  const playoffRound = week?.is_playoff
    ? matchupsQuery.data?.[0]?.playoff_round ?? null
    : null;

  // Playoff seeds for the current round
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function ScoreboardScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();

  const queryClient = useQueryClient();
  const { data: league } = useLeague();
  const { data: weeks, isLoading: weeksLoading } = useWeeks(leagueId);
  const season = league?.season ?? CURRENT_NBA_SEASON;

  // Refresh scoreboard data every time the screen is focused
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['scoreboardMatchups'] });
      queryClient.invalidateQueries({ queryKey: ['weekScores'] });
      queryClient.invalidateQueries({ queryKey: ['leagueTeamsRecord'] });
    }, [queryClient])
  );

  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number | null>(null);

  // Auto-select current week on load
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

  const selectedWeek = weeks && selectedWeekIndex !== null ? weeks[selectedWeekIndex] : null;
  const today = toDateStr(new Date());
  const weekState: WeekState = selectedWeek ? getWeekState(selectedWeek, today) : 'past';

  const { matchups, teamMap, seedMap, isPlayoff, isLoading } = useScoreboardData(
    selectedWeek,
    leagueId,
    weekState,
    season,
  );

  // Server-authoritative week scores
  const weekIsLive = weekState === 'live';
  const { data: weekScores } = useWeekScores({
    leagueId,
    scheduleId: selectedWeek?.id ?? null,
    weekIsLive,
  });

  // Determine if a matchup involves the current user's team
  const isMyMatchup = (m: ScoreboardMatchup) =>
    m.home_team_id === teamId || m.away_team_id === teamId;

  const isCategories = league?.scoring_type === 'h2h_categories';

  // Get score for a team — from server-computed scores, fallback to stored matchup scores
  const getScore = (m: ScoreboardMatchup, teamIdToCheck: string): number => {
    if (weekScores && weekState !== 'future') {
      return weekScores[teamIdToCheck] ?? 0;
    }
    return teamIdToCheck === m.home_team_id ? m.home_score ?? 0 : m.away_score ?? 0;
  };

  // Get formatted score display string
  const getScoreDisplay = (m: ScoreboardMatchup, teamIdToCheck: string): string => {
    if (isCategories) {
      if (m.home_category_wins != null) {
        const catTies = m.category_ties ?? 0;
        const homeW = m.home_category_wins ?? 0;
        const awayW = m.away_category_wins ?? 0;
        const isHome = teamIdToCheck === m.home_team_id;
        const myW = isHome ? homeW : awayW;
        const oppW = isHome ? awayW : homeW;
        return catTies > 0 ? `${myW}-${oppW}-${catTies}` : `${myW}-${oppW}`;
      }
      return '—';
    }
    return formatScore(getScore(m, teamIdToCheck));
  };

  // Sort matchups: user's matchup first
  const sortedMatchups = matchups
    ? [...matchups].sort((a, b) => {
        if (isMyMatchup(a) && !isMyMatchup(b)) return -1;
        if (!isMyMatchup(a) && isMyMatchup(b)) return 1;
        return 0;
      })
    : [];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader title="Scoreboard" />

      {/* Week Selector */}
      {weeks && weeks.length > 0 && selectedWeek && (
        <View style={[styles.weekNav, { borderBottomColor: c.border }]}>
          <TouchableOpacity
            onPress={() => setSelectedWeekIndex((i) => Math.max(0, (i ?? 0) - 1))}
            disabled={selectedWeekIndex === 0}
            style={styles.arrowBtn}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
            accessibilityState={{ disabled: selectedWeekIndex === 0 }}
          >
            <Text
              style={[
                styles.arrow,
                { color: selectedWeekIndex === 0 ? c.buttonDisabled : c.text },
              ]}
            >
              {'‹'}
            </Text>
          </TouchableOpacity>
          <View style={styles.weekInfo}>
            <ThemedText type="defaultSemiBold" style={styles.weekLabel}>
              {selectedWeek.is_playoff ? 'Playoffs · ' : ''}Week{' '}
              {selectedWeek.week_number}
            </ThemedText>
            <Text style={[styles.weekRange, { color: c.secondaryText }]}>
              {formatWeekRange(selectedWeek.start_date, selectedWeek.end_date)}
            </Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              setSelectedWeekIndex((i) =>
                Math.min(weeks.length - 1, (i ?? 0) + 1),
              )
            }
            disabled={selectedWeekIndex === weeks.length - 1}
            style={styles.arrowBtn}
            accessibilityRole="button"
            accessibilityLabel="Next week"
            accessibilityState={{ disabled: selectedWeekIndex === weeks.length - 1 }}
          >
            <Text
              style={[
                styles.arrow,
                {
                  color:
                    selectedWeekIndex === weeks.length - 1
                      ? c.buttonDisabled
                      : c.text,
                },
              ]}
            >
              {'›'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Content */}
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
      >
        {weeksLoading || isLoading ? (
          <ActivityIndicator style={styles.loader} />
        ) : !weeks || weeks.length === 0 ? (
          <View style={styles.emptyState}>
            <ThemedText style={{ color: c.secondaryText }}>
              Season schedule not generated yet
            </ThemedText>
          </View>
        ) : sortedMatchups.length === 0 ? (
          <View style={styles.emptyState}>
            <ThemedText style={{ color: c.secondaryText }}>
              {isPlayoff
                ? 'Bye round — top seeds advance automatically.'
                : 'No matchups this week'}
            </ThemedText>
            {isPlayoff && (
              <TouchableOpacity
                style={[styles.bracketBtn, { backgroundColor: c.accent }]}
                onPress={() => router.push('/playoff-bracket' as any)}
                accessibilityRole="button"
                accessibilityLabel="View Full Bracket"
              >
                <Text style={[styles.bracketBtnText, { color: c.accentText }]}>
                  View Full Bracket
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          sortedMatchups.map((matchup) => {
            const mine = isMyMatchup(matchup);
            const homeTeam = teamMap?.[matchup.home_team_id];
            const awayTeam = matchup.away_team_id
              ? teamMap?.[matchup.away_team_id]
              : null;
            const isBye = !matchup.away_team_id;
            const homeScore = getScore(matchup, matchup.home_team_id);
            const awayScore = matchup.away_team_id
              ? getScore(matchup, matchup.away_team_id)
              : 0;
            // For category leagues, use category wins to determine who's leading
            const homeWinning =
              weekState !== 'future' && !isBye && (
                isCategories
                  ? (matchup.home_category_wins ?? 0) > (matchup.away_category_wins ?? 0)
                  : homeScore > awayScore
              );
            const awayWinning =
              weekState !== 'future' && !isBye && (
                isCategories
                  ? (matchup.away_category_wins ?? 0) > (matchup.home_category_wins ?? 0)
                  : awayScore > homeScore
              );

            return (
              <TouchableOpacity
                key={matchup.id}
                style={[
                  styles.matchupCard,
                  {
                    backgroundColor: mine ? c.activeCard : c.card,
                    borderColor: mine ? c.activeBorder : c.border,
                  },
                  mine && styles.myMatchupCard,
                ]}
                activeOpacity={0.7}
                onPress={() => router.push(`/matchup-detail/${matchup.id}` as any)}
                accessibilityRole="button"
                accessibilityLabel={`${homeTeam?.name ?? 'Unknown'} ${weekState !== 'future' ? formatScore(homeScore) : ''} vs ${isBye ? 'BYE' : `${awayTeam?.name ?? 'Unknown'} ${weekState !== 'future' ? formatScore(awayScore) : ''}`}${mine ? ', your matchup' : ''}`}
                accessibilityHint="View matchup details"
              >
                {/* Status badge */}
                {weekState === 'live' && (
                  <View style={styles.statusRow}>
                    <View style={[styles.inProgressBadge, { backgroundColor: c.danger }]}>
                      <Text style={[styles.inProgressText, { color: c.statusText }]}>IN PROGRESS</Text>
                    </View>
                  </View>
                )}
                {weekState === 'future' && (
                  <View style={styles.statusRow}>
                    <Text style={[styles.upcomingText, { color: c.secondaryText }]}>
                      Upcoming
                    </Text>
                  </View>
                )}

                {/* Home team row */}
                <View style={styles.teamRow}>
                  <View style={styles.teamInfo}>
                    {isPlayoff && seedMap?.[matchup.home_team_id] && (
                      <Text style={[styles.seedBadge, { color: c.secondaryText }]}>
                        #{seedMap[matchup.home_team_id]}
                      </Text>
                    )}
                    <ThemedText style={styles.teamName} numberOfLines={1}>
                      {homeTeam?.name ?? 'Unknown'}
                    </ThemedText>
                    <Text style={[styles.record, { color: c.secondaryText }]}>
                      {homeTeam
                        ? `${homeTeam.wins}-${homeTeam.losses}${homeTeam.ties > 0 ? `-${homeTeam.ties}` : ''}`
                        : ''}
                    </Text>
                  </View>
                  {weekState !== 'future' && (
                    <ThemedText
                      style={[
                        styles.score,
                        homeWinning && { color: c.accent },
                      ]}
                    >
                      {getScoreDisplay(matchup, matchup.home_team_id)}
                    </ThemedText>
                  )}
                </View>

                {/* Divider */}
                <View
                  style={[styles.divider, { backgroundColor: c.border }]}
                />

                {/* Away team row */}
                {isBye ? (
                  <View style={styles.teamRow}>
                    <ThemedText
                      style={[
                        styles.teamName,
                        { color: c.secondaryText, fontStyle: 'italic' },
                      ]}
                    >
                      BYE
                    </ThemedText>
                  </View>
                ) : (
                  <View style={styles.teamRow}>
                    <View style={styles.teamInfo}>
                      {isPlayoff && matchup.away_team_id && seedMap?.[matchup.away_team_id] && (
                        <Text style={[styles.seedBadge, { color: c.secondaryText }]}>
                          #{seedMap[matchup.away_team_id]}
                        </Text>
                      )}
                      <ThemedText style={styles.teamName} numberOfLines={1}>
                        {awayTeam?.name ?? 'Unknown'}
                      </ThemedText>
                      <Text style={[styles.record, { color: c.secondaryText }]}>
                        {awayTeam
                          ? `${awayTeam.wins}-${awayTeam.losses}${awayTeam.ties > 0 ? `-${awayTeam.ties}` : ''}`
                          : ''}
                      </Text>
                    </View>
                    {weekState !== 'future' && (
                      <ThemedText
                        style={[
                          styles.score,
                          awayWinning && { color: c.accent },
                        ]}
                      >
                        {matchup.away_team_id ? getScoreDisplay(matchup, matchup.away_team_id) : '0.00'}
                      </ThemedText>
                    )}
                  </View>
                )}
              </TouchableOpacity>
            );
          })
        )}

        {/* Bracket link on playoff weeks */}
        {isPlayoff && sortedMatchups.length > 0 && (
          <TouchableOpacity
            style={[styles.bracketBtn, { backgroundColor: c.accent }]}
            onPress={() => router.push('/playoff-bracket' as any)}
            accessibilityRole="button"
            accessibilityLabel="View Full Bracket"
          >
            <Text style={[styles.bracketBtnText, { color: c.accentText }]}>
              View Full Bracket
            </Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(8),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  arrowBtn: {
    width: s(44),
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(4),
  },
  arrow: {
    fontSize: ms(28),
    fontWeight: '300',
  },
  weekInfo: {
    alignItems: 'center',
  },
  weekLabel: {
    fontSize: ms(15),
  },
  weekRange: {
    fontSize: ms(11),
    marginTop: s(2),
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(40),
  },
  loader: {
    marginTop: s(40),
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: s(40),
  },
  matchupCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    marginBottom: s(10),
  },
  myMatchupCard: {
    borderWidth: 1.5,
    marginBottom: s(14),
    paddingVertical: s(14),
  },
  statusRow: {
    marginBottom: s(8),
  },
  inProgressBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 4,
  },
  inProgressText: {
    fontSize: ms(9),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  upcomingText: {
    fontSize: ms(11),
    fontWeight: '600',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
  },
  teamInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginRight: s(12),
  },
  teamName: {
    fontSize: ms(14),
    fontWeight: '600',
    flexShrink: 1,
  },
  record: {
    fontSize: ms(12),
  },
  score: {
    fontSize: ms(18),
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  seedBadge: {
    fontSize: ms(11),
    fontWeight: '700',
  },
  bracketBtn: {
    alignSelf: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(20),
    borderRadius: 8,
    marginTop: s(12),
  },
  bracketBtnText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
});
