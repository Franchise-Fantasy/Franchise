import { CategoryScoreboard } from '@/components/matchup/CategoryScoreboard';
import { PlayerCell, pStyles, RosterPlayer, DisplayMode, round1, buildStatLine } from '@/components/matchup/PlayerCell';
import { MatchupSkeleton } from '@/components/matchup/MatchupSkeleton';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { ThemedText } from '@/components/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLeagueRosterConfig, RosterConfigSlot } from '@/hooks/useLeagueRosterConfig';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { aggregateTeamStats, computeCategoryResults, TeamStatTotals } from '@/utils/categoryScoring';
import { fetchTeamData } from '@/utils/fetchTeamData';
import { liveToGameLog, LivePlayerStats, useLivePlayerStats } from '@/utils/nbaLive';
import { parseLocalDate, addDays, formatDayLabel, useToday } from '@/utils/dates';
import { fetchNbaScheduleForDate } from '@/utils/nbaSchedule';
import { calculateGameFantasyPoints, formatScore } from '@/utils/fantasyPoints';
import { slotLabel } from '@/utils/rosterSlots';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

interface TeamMatchupData {
  teamId: string;
  teamName: string;
  players: RosterPlayer[];
  weekTotal: number;
  dayTotal: number;
  teamStats: TeamStatTotals;
}

interface MatchupSlotEntry {
  slotPosition: string;
  slotIndex: number;
  player: RosterPlayer | null;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatWeekRange(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

function buildMatchupSlots(players: RosterPlayer[], config: RosterConfigSlot[]): MatchupSlotEntry[] {
  const activeConfigs = config.filter((c) => c.position !== 'BE' && c.position !== 'IR');
  const slots: MatchupSlotEntry[] = [];
  for (const cfg of activeConfigs) {
    if (cfg.position === 'UTIL') {
      for (let i = 0; i < cfg.slot_count; i++) {
        const numberedSlot = `UTIL${i + 1}`;
        const player = players.find((p) => p.roster_slot === numberedSlot) ?? null;
        slots.push({ slotPosition: numberedSlot, slotIndex: i, player });
      }
    } else {
      const inSlot = players.filter((p) => p.roster_slot === cfg.position);
      for (let i = 0; i < cfg.slot_count; i++) {
        slots.push({ slotPosition: cfg.position, slotIndex: i, player: inSlot[i] ?? null });
      }
    }
  }
  return slots;
}

// ─── Build RosterPlayer[] from stored finalized JSONB ───────────────────────

interface StoredPlayerScore {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  external_id_nba: number | null;
  roster_slot: string;
  week_points: number;
  games: Array<{
    date: string;
    slot: string;
    fpts: number;
    stats: Record<string, any>;
    matchup: string | null;
  }>;
}

function buildFromStored(
  stored: StoredPlayerScore[],
  selectedDate: string,
  scoring: ScoringWeight[],
): { players: RosterPlayer[]; teamStats: TeamStatTotals } {
  const activeGames: Record<string, any>[] = [];

  const players: RosterPlayer[] = stored.map((p) => {
    const dayGame = p.games.find((g) => g.date === selectedDate);

    // Resolve slot using rollover: most recent game slot <= selectedDate, else default
    const sorted = [...p.games].sort((a, b) => b.date.localeCompare(a.date));
    const closestEntry = sorted.find((g) => g.date <= selectedDate);
    const daySlot = closestEntry?.slot ?? p.roster_slot;
    const isDayActive = daySlot !== 'BE' && daySlot !== 'IR' && daySlot !== 'DROPPED';

    // Collect active-slot games for category stat aggregation
    for (const g of p.games) {
      if (g.slot !== 'BE' && g.slot !== 'IR' && g.slot !== 'DROPPED') {
        activeGames.push(g.stats);
      }
    }

    const t = p.nba_team ?? '';
    return {
      player_id: p.player_id,
      name: p.name,
      position: p.position,
      nba_team: t,
      nbaTricode: t && t !== 'Active' && t !== 'Inactive' ? t : null,
      external_id_nba: p.external_id_nba,
      status: 'active',
      roster_slot: daySlot,
      weekPoints: round1(p.week_points),
      dayPoints: isDayActive && dayGame ? round1(dayGame.fpts) : 0,
      dayMatchup: isDayActive && dayGame ? dayGame.matchup : null,
      dayStatLine: isDayActive && dayGame ? buildStatLine(dayGame.stats, scoring) : null,
      projectedFpts: 0,
    };
  });

  return { players, teamStats: aggregateTeamStats(activeGames) };
}

// ─── Main screen ────────────────────────────────────────────────────────────

export default function MatchupDetailScreen() {
  const { id: matchupId } = useLocalSearchParams<{ id: string }>();
  const { leagueId } = useAppState();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: league } = useLeague();
  const { data: scoring } = useLeagueScoring(leagueId ?? '');
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId ?? '');
  const isCategories = league?.scoring_type === 'h2h_categories';

  const today = useToday();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);

  // Fetch matchup + week info
  const { data: matchupInfo, isLoading: infoLoading } = useQuery({
    queryKey: ['matchupDetail', matchupId],
    queryFn: async () => {
      const { data: matchup, error: mErr } = await supabase
        .from('league_matchups')
        .select('id, home_team_id, away_team_id, home_score, away_score, schedule_id, playoff_round, is_finalized, home_player_scores, away_player_scores')
        .eq('id', matchupId!)
        .single();
      if (mErr) throw mErr;

      const { data: week, error: wErr } = await supabase
        .from('league_schedule')
        .select('id, week_number, start_date, end_date, is_playoff')
        .eq('id', matchup.schedule_id)
        .single();
      if (wErr) throw wErr;

      const { data: teams } = await supabase
        .from('teams')
        .select('id, name')
        .in('id', [matchup.home_team_id, matchup.away_team_id].filter(Boolean));

      const teamMap = new Map((teams ?? []).map((t: any) => [t.id, t.name]));

      return {
        matchup,
        week: week as Week,
        homeName: teamMap.get(matchup.home_team_id) ?? 'Unknown',
        awayName: matchup.away_team_id ? (teamMap.get(matchup.away_team_id) ?? 'Unknown') : null,
      };
    },
    enabled: !!matchupId,
    staleTime: 1000 * 60 * 5,
  });

  const week = matchupInfo?.week ?? null;

  // Clamp selected date within week range
  const effectiveDate = week
    ? selectedDate < week.start_date
      ? week.start_date
      : selectedDate > week.end_date
        ? week.end_date
        : selectedDate
    : selectedDate;

  // Fetch both teams' rosters
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ['matchupTeams', matchupId, effectiveDate],
    queryFn: async () => {
      if (!matchupInfo || !leagueId || !scoring) return null;
      const { matchup, week: w, homeName, awayName } = matchupInfo;

      // For finalized matchups with stored player scores, read directly
      const useStored = matchup.is_finalized && matchup.home_player_scores;

      if (useStored) {
        const homeResult = buildFromStored(matchup.home_player_scores, effectiveDate, scoring);
        const homeTeam: TeamMatchupData = {
          teamId: matchup.home_team_id,
          teamName: homeName,
          players: homeResult.players,
          weekTotal: round1(homeResult.players.reduce((s, p) => s + p.weekPoints, 0)),
          dayTotal: round1(homeResult.players.reduce((s, p) => s + p.dayPoints, 0)),
          teamStats: homeResult.teamStats,
        };

        let awayTeam: TeamMatchupData | null = null;
        if (matchup.away_team_id && awayName && matchup.away_player_scores) {
          const awayResult = buildFromStored(matchup.away_player_scores, effectiveDate, scoring);
          awayTeam = {
            teamId: matchup.away_team_id,
            teamName: awayName,
            players: awayResult.players,
            weekTotal: round1(awayResult.players.reduce((s, p) => s + p.weekPoints, 0)),
            dayTotal: round1(awayResult.players.reduce((s, p) => s + p.dayPoints, 0)),
            teamStats: awayResult.teamStats,
          };
        }

        return { homeTeam, awayTeam };
      }

      // Live reconstruction for current/unfinalized weeks
      const homeResult = await fetchTeamData(matchup.home_team_id, leagueId, w, effectiveDate, scoring);
      const homeTeam: TeamMatchupData = {
        teamId: matchup.home_team_id,
        teamName: homeName,
        players: homeResult.players,
        weekTotal: round1(homeResult.players.reduce((s, p) => s + p.weekPoints, 0)),
        dayTotal: round1(homeResult.players.reduce((s, p) => s + p.dayPoints, 0)),
        teamStats: homeResult.teamStats,
      };

      let awayTeam: TeamMatchupData | null = null;
      if (matchup.away_team_id && awayName) {
        const awayResult = await fetchTeamData(matchup.away_team_id, leagueId, w, effectiveDate, scoring);
        awayTeam = {
          teamId: matchup.away_team_id,
          teamName: awayName,
          players: awayResult.players,
          weekTotal: round1(awayResult.players.reduce((s, p) => s + p.weekPoints, 0)),
          dayTotal: round1(awayResult.players.reduce((s, p) => s + p.dayPoints, 0)),
          teamStats: awayResult.teamStats,
        };
      }

      return { homeTeam, awayTeam };
    },
    enabled: !!matchupInfo && !!leagueId && !!scoring && scoring.length > 0,
    staleTime: matchupInfo?.matchup?.is_finalized && matchupInfo?.matchup?.home_player_scores
      ? Infinity
      : 1000 * 60 * 2,
  });

  // Live stats
  const allPlayerIds: string[] = teamData
    ? [
        ...teamData.homeTeam.players.map((p) => p.player_id),
        ...(teamData.awayTeam?.players.map((p) => p.player_id) ?? []),
      ]
    : [];
  const isToday = effectiveDate === today;
  const yesterday = addDays(today, -1);
  const isYesterday = effectiveDate === yesterday;
  const rawLiveMap = useLivePlayerStats(allPlayerIds, isToday || isYesterday);

  // Filter live stats to only include games matching the selected date
  const liveMap = new Map(
    [...rawLiveMap].filter(([, stats]) => stats.game_date === effectiveDate)
  );

  // Future schedule
  const isFutureDate = effectiveDate > today;
  const { data: futureSchedule } = useQuery<Map<string, string>>({
    queryKey: ['futureSchedule', effectiveDate],
    queryFn: () => fetchNbaScheduleForDate(effectiveDate),
    enabled: isToday || isFutureDate,
    staleTime: 1000 * 60 * 60,
  });

  const mode: DisplayMode = effectiveDate < today ? 'past' : effectiveDate === today ? 'today' : 'future';

  // For future mode, compute projected day total from active players' season averages
  const computeProjectedDay = (players: RosterPlayer[], schedule?: Map<string, string>) => {
    if (!schedule) return 0;
    return round1(players.reduce((sum, p) => {
      if (p.roster_slot === 'BE' || p.roster_slot === 'IR' || p.roster_slot === 'DROPPED') return sum;
      if (!p.nbaTricode || !schedule.has(p.nbaTricode)) return sum;
      return sum + (p.projectedFpts ?? 0);
    }, 0));
  };

  function computeLiveBonus(players: RosterPlayer[]): number {
    if (liveMap.size === 0) return 0;
    return round1(
      players.reduce((sum, p) => {
        if (p.roster_slot === 'BE' || p.roster_slot === 'IR' || p.roster_slot === 'DROPPED') return sum;
        const live = liveMap.get(p.player_id);
        if (!live) return sum;
        return sum + calculateGameFantasyPoints(liveToGameLog(live) as any, scoring ?? []);
      }, 0),
    );
  }

  const handlePlayerPress = async (playerId: string) => {
    const { data } = await supabase
      .from('player_season_stats')
      .select('*')
      .eq('player_id', playerId)
      .maybeSingle();
    if (data) setSelectedPlayer(data as PlayerSeasonStats);
  };

  // Day navigation
  const canGoBack = week ? effectiveDate > week.start_date : false;
  const canGoForward = week ? effectiveDate < week.end_date : false;

  const goBack = () => {
    if (canGoBack) setSelectedDate(addDays(effectiveDate, -1));
  };
  const goForward = () => {
    if (canGoForward) setSelectedDate(addDays(effectiveDate, 1));
  };

  // Build slots
  const homeSlots = teamData?.homeTeam && rosterConfig
    ? buildMatchupSlots(teamData.homeTeam.players, rosterConfig)
    : [];
  const awaySlots = teamData?.awayTeam && rosterConfig
    ? buildMatchupSlots(teamData.awayTeam.players, rosterConfig)
    : [];

  const homeLiveBonus = teamData?.homeTeam ? computeLiveBonus(teamData.homeTeam.players) : 0;
  const awayLiveBonus = teamData?.awayTeam ? computeLiveBonus(teamData.awayTeam.players) : 0;

  const router = useRouter();

  if (infoLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
            <Ionicons name="chevron-back" size={22} color={c.accent} />
          </TouchableOpacity>
          <View style={styles.dayInfo}>
            <ThemedText type="defaultSemiBold" style={styles.dayLabel}>Matchup</ThemedText>
          </View>
          <View style={styles.navArrow} />
        </View>
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      {/* Day navigation with integrated back button */}
      <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} hitSlop={8} accessibilityRole="button" accessibilityLabel="Go back">
          <Ionicons name="chevron-back" size={22} color={c.accent} />
        </TouchableOpacity>

        {week ? (
          <>
            <TouchableOpacity
              onPress={goBack}
              style={styles.navArrow}
              disabled={!canGoBack}
              accessibilityRole="button"
              accessibilityLabel="Previous day"
              accessibilityState={{ disabled: !canGoBack }}
            >
              <Text style={[styles.arrow, { color: canGoBack ? c.text : c.buttonDisabled }]}>‹</Text>
            </TouchableOpacity>
            <View style={styles.dayInfo}>
              <ThemedText type="defaultSemiBold" style={styles.dayLabel}>
                {formatDayLabel(effectiveDate)}
              </ThemedText>
              <ThemedText style={[styles.weekMeta, { color: c.secondaryText }]}>
                {week.is_playoff ? 'Playoffs · ' : ''}Week {week.week_number} · {formatWeekRange(week.start_date, week.end_date)}
              </ThemedText>
            </View>
            <TouchableOpacity
              onPress={goForward}
              style={styles.navArrow}
              disabled={!canGoForward}
              accessibilityRole="button"
              accessibilityLabel="Next day"
              accessibilityState={{ disabled: !canGoForward }}
            >
              <Text style={[styles.arrow, { color: canGoForward ? c.text : c.buttonDisabled }]}>›</Text>
            </TouchableOpacity>
          </>
        ) : (
          <View style={styles.dayInfo}>
            <ThemedText type="defaultSemiBold" style={styles.dayLabel}>Matchup</ThemedText>
          </View>
        )}

        {/* Spacer to balance the back button */}
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 12, paddingBottom: 56 }} showsVerticalScrollIndicator={false}>
        {teamLoading ? (
          <MatchupSkeleton c={c} />
        ) : teamData ? (
          <View>
            {/* Score header */}
            {(() => {
              const homeWeek = round1(teamData.homeTeam.weekTotal + homeLiveBonus);
              const awayWeek = teamData.awayTeam ? round1(teamData.awayTeam.weekTotal + awayLiveBonus) : 0;
              const homeDay = mode === 'future'
                ? computeProjectedDay(teamData.homeTeam.players, futureSchedule)
                : round1(teamData.homeTeam.dayTotal + homeLiveBonus);
              const awayDay = mode === 'future' && teamData.awayTeam
                ? computeProjectedDay(teamData.awayTeam.players, futureSchedule)
                : (teamData.awayTeam ? round1(teamData.awayTeam.dayTotal + awayLiveBonus) : 0);

              if (isCategories && teamData.awayTeam) {
                const catComparison = computeCategoryResults(
                  teamData.homeTeam.teamStats,
                  teamData.awayTeam.teamStats,
                  (scoring as any[] ?? []).filter((s) => s.is_enabled).map((s) => ({ stat_name: s.stat_name, inverse: !!s.inverse })),
                );
                return (
                  <View style={{ marginBottom: 14 }}>
                    <CategoryScoreboard
                      results={catComparison.results}
                      homeWins={catComparison.homeWins}
                      awayWins={catComparison.awayWins}
                      ties={catComparison.ties}
                      homeTeamName={teamData.homeTeam.teamName}
                      awayTeamName={teamData.awayTeam.teamName}
                    />
                  </View>
                );
              }

              return (
                <View
                  style={colStyles.scoreHeader}
                  accessibilityRole="summary"
                  accessibilityLabel={`${teamData.homeTeam.teamName} ${formatScore(homeWeek)} versus ${teamData.awayTeam ? `${teamData.awayTeam.teamName} ${formatScore(awayWeek)}` : 'BYE'}`}
                >
                  <View style={[colStyles.scoreCol, { alignItems: 'flex-start' }]}>
                    <Text style={[colStyles.teamName, { color: c.text }]} numberOfLines={1} accessibilityRole="header">
                      {teamData.homeTeam.teamName}
                    </Text>
                    <Text style={[colStyles.total, { color: c.accent }]}>
                      {formatScore(homeWeek)}
                    </Text>
                    {mode === 'future' ? (
                      <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{homeDay.toFixed(1)} proj</Text>
                    ) : (
                      <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{formatScore(homeDay)} today</Text>
                    )}
                  </View>
                  <Text style={[colStyles.vsText, { color: c.secondaryText }]} accessible={false}>vs</Text>
                  <View style={[colStyles.scoreCol, { alignItems: 'flex-end' }]}>
                    <Text style={[colStyles.teamName, { color: c.text, textAlign: 'right' }]} numberOfLines={1} accessibilityRole="header">
                      {teamData.awayTeam?.teamName ?? 'BYE'}
                    </Text>
                    <Text style={[colStyles.total, { color: c.accent }]}>
                      {teamData.awayTeam ? formatScore(awayWeek) : '0.0'}
                    </Text>
                    {mode === 'future' ? (
                      teamData.awayTeam && <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{awayDay.toFixed(1)} proj</Text>
                    ) : (
                      teamData.awayTeam && <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{formatScore(awayDay)} today</Text>
                    )}
                  </View>
                </View>
              );
            })()}

            {/* Slot rows */}
            {Array.from({ length: Math.max(homeSlots.length, awaySlots.length) }).map((_, i) => {
              const homeSlot = homeSlots[i] ?? null;
              const awaySlot = awaySlots[i] ?? null;
              const slotPos = homeSlot?.slotPosition ?? awaySlot?.slotPosition ?? '';

              return (
                <View key={`slot-${i}`} style={[pStyles.slotRow, { borderBottomColor: c.border }]}>
                  <PlayerCell
                    player={homeSlot?.player ?? null}
                    c={c}
                    side="left"
                    mode={mode}
                    liveStats={homeSlot?.player ? (liveMap.get(homeSlot.player.player_id) ?? null) : null}
                    scoring={scoring ?? []}
                    futureSchedule={futureSchedule}
                    onPress={handlePlayerPress}
                    isCategories={isCategories}
                  />
                  <View style={pStyles.slotCenter}>
                    <Text style={[pStyles.slotText, { color: c.secondaryText }]}>
                      {slotLabel(slotPos)}
                    </Text>
                  </View>
                  <PlayerCell
                    player={awaySlot?.player ?? null}
                    c={c}
                    side="right"
                    mode={mode}
                    liveStats={awaySlot?.player ? (liveMap.get(awaySlot.player.player_id) ?? null) : null}
                    scoring={scoring ?? []}
                    futureSchedule={futureSchedule}
                    onPress={handlePlayerPress}
                    isCategories={isCategories}
                  />
                </View>
              );
            })}

            {/* Bench section */}
            {(() => {
              const homeBench = teamData.homeTeam.players.filter((p) => p.roster_slot === 'BE');
              const awayBench = teamData.awayTeam?.players.filter((p) => p.roster_slot === 'BE') ?? [];
              if (homeBench.length === 0 && awayBench.length === 0) return null;
              const maxBench = Math.max(homeBench.length, awayBench.length);
              return (
                <View style={{ marginTop: 12 }}>
                  <View style={{ alignItems: 'center', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }}>
                    <Text style={{ color: c.secondaryText, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}>BENCH</Text>
                  </View>
                  {Array.from({ length: maxBench }).map((_, i) => (
                    <View key={`bench-${i}`} style={[pStyles.slotRow, { borderBottomColor: c.border, opacity: 0.7 }]}>
                      <PlayerCell
                        player={homeBench[i] ?? null}
                        c={c}
                        side="left"
                        mode={mode}
                        liveStats={homeBench[i] ? (liveMap.get(homeBench[i].player_id) ?? null) : null}
                        scoring={scoring ?? []}
                        futureSchedule={futureSchedule}
                        onPress={handlePlayerPress}
                        isCategories={isCategories}
                      />
                      <View style={pStyles.slotCenter}>
                        <Text style={[pStyles.slotText, { color: c.secondaryText }]}>BE</Text>
                      </View>
                      <PlayerCell
                        player={awayBench[i] ?? null}
                        c={c}
                        side="right"
                        mode={mode}
                        liveStats={awayBench[i] ? (liveMap.get(awayBench[i].player_id) ?? null) : null}
                        scoring={scoring ?? []}
                        futureSchedule={futureSchedule}
                        onPress={handlePlayerPress}
                        isCategories={isCategories}
                      />
                    </View>
                  ))}
                </View>
              );
            })()}
          </View>
        ) : (
          <View style={styles.empty}>
            <ThemedText style={{ color: c.secondaryText }}>No matchup data available</ThemedText>
          </View>
        )}
      </ScrollView>

      {selectedPlayer && leagueId && (
        <PlayerDetailModal
          player={selectedPlayer}
          leagueId={leagueId}
          onClose={() => setSelectedPlayer(null)}
        />
      )}
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: { width: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  weekMeta: { fontSize: 11, marginTop: 2 },
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navArrow: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrow: { fontSize: 28, fontWeight: '300' },
  dayInfo: { flex: 1, alignItems: 'center' },
  dayLabel: { fontSize: 15 },
  scroll: { flex: 1 },
  empty: { paddingVertical: 60, alignItems: 'center' },
});

const colStyles = StyleSheet.create({
  scoreHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  scoreCol: { flex: 1 },
  vsText: { fontSize: 12, fontWeight: '600', marginHorizontal: 10 },
  teamName: { fontWeight: '600', fontSize: 14, marginBottom: 2 },
  total: { fontSize: 20, fontWeight: '700' },
  dayTotal: { fontSize: 11, fontWeight: '500', marginTop: 2 },
});

export const options = { headerShown: false };
