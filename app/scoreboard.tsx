import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';
import { calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { useLeague } from '@/hooks/useLeague';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { toDateStr, parseLocalDate, addDays } from '@/utils/dates';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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

function round1(n: number) {
  return Math.round(n * 10) / 10;
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

// Compute running weekly totals for all teams (current week only)
async function computeAllTeamScores(
  leagueId: string,
  week: Week,
  scoring: ScoringWeight[],
): Promise<Record<string, number>> {
  const today = toDateStr(new Date());
  const endDate = addDays(today, -1); // through yesterday (today's games not finalized)

  // If the week hasn't started or no past days yet, return empty
  if (week.start_date > endDate) return {};

  // Fetch all rostered players
  const { data: leaguePlayers } = await supabase
    .from('league_players')
    .select('player_id, team_id, roster_slot')
    .eq('league_id', leagueId);

  if (!leaguePlayers || leaguePlayers.length === 0) return {};

  const playerIds = leaguePlayers.map((lp) => lp.player_id);
  const defaultSlotByPlayer = new Map<string, { teamId: string; slot: string }>();
  for (const lp of leaguePlayers) {
    defaultSlotByPlayer.set(lp.player_id, {
      teamId: lp.team_id,
      slot: lp.roster_slot ?? 'BE',
    });
  }

  // Fetch daily lineup overrides
  const { data: dailyEntries } = await supabase
    .from('daily_lineups')
    .select('player_id, team_id, roster_slot, lineup_date')
    .eq('league_id', leagueId)
    .lte('lineup_date', week.end_date)
    .order('lineup_date', { ascending: false });

  const dailyByPlayer = new Map<string, Array<{ lineup_date: string; roster_slot: string }>>();
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) {
      dailyByPlayer.set(entry.player_id, []);
    }
    dailyByPlayer.get(entry.player_id)!.push(entry);
  }

  const resolveSlot = (playerId: string, day: string): string => {
    const entries = dailyByPlayer.get(playerId) ?? [];
    const entry = entries.find((e) => e.lineup_date <= day);
    return entry?.roster_slot ?? defaultSlotByPlayer.get(playerId)?.slot ?? 'BE';
  };

  // Fetch game logs for all players in the week range
  const { data: gameLogs } = await supabase
    .from('player_games')
    .select(
      'player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date',
    )
    .in('player_id', playerIds)
    .gte('game_date', week.start_date)
    .lte('game_date', endDate);

  // Sum fantasy points per team
  const teamScores: Record<string, number> = {};
  for (const game of gameLogs ?? []) {
    const info = defaultSlotByPlayer.get(game.player_id);
    if (!info) continue;

    const slot = resolveSlot(game.player_id, game.game_date);
    if (slot === 'BE' || slot === 'IR') continue;

    const fp = calculateGameFantasyPoints(game as any, scoring);
    teamScores[info.teamId] = (teamScores[info.teamId] ?? 0) + fp;
  }

  // Round all values
  for (const k of Object.keys(teamScores)) teamScores[k] = round1(teamScores[k]);

  return teamScores;
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

function useWeeks(leagueId: string | null) {
  return useQuery({
    queryKey: ['leagueSchedule', leagueId],
    queryFn: () => fetchWeeks(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

function useScoreboardData(
  week: Week | null,
  leagueId: string | null,
  scoring: ScoringWeight[],
  weekState: WeekState,
  season: string,
) {
  // Matchups for the selected week
  const matchupsQuery = useQuery({
    queryKey: ['scoreboardMatchups', week?.id],
    queryFn: () => fetchMatchups(week!.id),
    enabled: !!week,
    staleTime: 1000 * 60 * 5,
  });

  // All teams in the league
  const teamsQuery = useQuery({
    queryKey: ['leagueTeamsRecord', leagueId],
    queryFn: () => fetchLeagueTeams(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });

  // Computed scores (current week only)
  const computedQuery = useQuery({
    queryKey: ['scoreboardComputed', leagueId, week?.id],
    queryFn: () => computeAllTeamScores(leagueId!, week!, scoring),
    enabled: !!leagueId && !!week && weekState === 'live' && scoring.length > 0,
    staleTime: 1000 * 60 * 5,
  });

  // Determine playoff round from matchups
  const playoffRound = week?.is_playoff
    ? matchupsQuery.data?.[0]?.playoff_round ?? null
    : null;

  // Playoff seeds for the current round
  const seedsQuery = useQuery({
    queryKey: ['playoffSeeds', leagueId, season, playoffRound],
    queryFn: () => fetchPlayoffSeeds(leagueId!, season, playoffRound!),
    enabled: !!leagueId && !!season && playoffRound !== null,
    staleTime: 1000 * 60 * 5,
  });

  return {
    matchups: matchupsQuery.data,
    teamMap: teamsQuery.data,
    computedScores: computedQuery.data,
    seedMap: seedsQuery.data ?? {},
    isPlayoff: week?.is_playoff ?? false,
    isLoading:
      matchupsQuery.isLoading || teamsQuery.isLoading || (weekState === 'live' && computedQuery.isLoading),
  };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function ScoreboardScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();

  const { data: league } = useLeague();
  const { data: weeks, isLoading: weeksLoading } = useWeeks(leagueId);
  const { data: scoring } = useLeagueScoring(leagueId ?? '');
  const season = league?.season ?? CURRENT_NBA_SEASON;

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

  const { matchups, teamMap, computedScores, seedMap, isPlayoff, isLoading } = useScoreboardData(
    selectedWeek,
    leagueId,
    scoring ?? [],
    weekState,
    season,
  );

  // Determine if a matchup involves the current user's team
  const isMyMatchup = (m: ScoreboardMatchup) =>
    m.home_team_id === teamId || m.away_team_id === teamId;

  const isCategories = league?.scoring_type === 'h2h_categories';

  // Get score for a team in a matchup
  const getScore = (m: ScoreboardMatchup, teamIdToCheck: string): number => {
    if (weekState === 'live' && computedScores) {
      return computedScores[teamIdToCheck] ?? 0;
    }
    // Past/finalized weeks use stored scores
    return teamIdToCheck === m.home_team_id ? m.home_score ?? 0 : m.away_score ?? 0;
  };

  // Get formatted score display string
  const getScoreDisplay = (m: ScoreboardMatchup, teamIdToCheck: string): string => {
    if (isCategories && weekState === 'past' && m.home_category_wins != null) {
      // Show category record for the matchup
      const catTies = m.category_ties ?? 0;
      const homeW = m.home_category_wins ?? 0;
      const awayW = m.away_category_wins ?? 0;
      const isHome = teamIdToCheck === m.home_team_id;
      const myW = isHome ? homeW : awayW;
      const oppW = isHome ? awayW : homeW;
      return catTies > 0 ? `${myW}-${oppW}-${catTies}` : `${myW}-${oppW}`;
    }
    return getScore(m, teamIdToCheck).toFixed(1);
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
            const homeWinning =
              weekState !== 'future' && !isBye && homeScore > awayScore;
            const awayWinning =
              weekState !== 'future' && !isBye && awayScore > homeScore;

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
                accessibilityLabel={`${homeTeam?.name ?? 'Unknown'} ${weekState !== 'future' ? homeScore.toFixed(1) : ''} vs ${isBye ? 'BYE' : `${awayTeam?.name ?? 'Unknown'} ${weekState !== 'future' ? awayScore.toFixed(1) : ''}`}${mine ? ', your matchup' : ''}`}
                accessibilityHint="View matchup details"
              >
                {/* Status badge */}
                {weekState === 'live' && (
                  <View style={styles.statusRow}>
                    <View style={styles.inProgressBadge}>
                      <Text style={styles.inProgressText}>IN PROGRESS</Text>
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
                        {matchup.away_team_id ? getScoreDisplay(matchup, matchup.away_team_id) : '0.0'}
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
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  arrowBtn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  arrow: {
    fontSize: 28,
    fontWeight: '300',
  },
  weekInfo: {
    alignItems: 'center',
  },
  weekLabel: {
    fontSize: 15,
  },
  weekRange: {
    fontSize: 11,
    marginTop: 2,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 40,
  },
  loader: {
    marginTop: 40,
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: 40,
  },
  matchupCard: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  myMatchupCard: {
    borderWidth: 1.5,
    marginBottom: 14,
    paddingVertical: 14,
  },
  statusRow: {
    marginBottom: 8,
  },
  inProgressBadge: {
    alignSelf: 'flex-start',
    backgroundColor: '#e03131',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  inProgressText: {
    color: '#fff',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  upcomingText: {
    fontSize: 11,
    fontWeight: '600',
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
  },
  teamInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginRight: 12,
  },
  teamName: {
    fontSize: 14,
    fontWeight: '600',
    flexShrink: 1,
  },
  record: {
    fontSize: 12,
  },
  score: {
    fontSize: 18,
    fontWeight: '700',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  seedBadge: {
    fontSize: 11,
    fontWeight: '700',
  },
  bracketBtn: {
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    marginTop: 12,
  },
  bracketBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
