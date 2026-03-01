import { PlayerCell, pStyles, RosterPlayer, DisplayMode, round1, buildStatLine } from '@/components/matchup/PlayerCell';
import { MatchupSkeleton } from '@/components/matchup/MatchupSkeleton';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { ThemedText } from '@/components/ThemedText';
import { PageHeader } from '@/components/ui/PageHeader';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLeagueRosterConfig, RosterConfigSlot } from '@/hooks/useLeagueRosterConfig';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { liveToGameLog, LivePlayerStats, useLivePlayerStats } from '@/utils/nbaLive';
import { toDateStr, parseLocalDate, addDays, formatDayLabel } from '@/utils/dates';
import { fetchNbaScheduleForDate } from '@/utils/nbaSchedule';
import { calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { slotLabel } from '@/utils/rosterSlots';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
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

// ─── Data fetching ──────────────────────────────────────────────────────────

async function fetchTeamData(
  teamId: string,
  leagueId: string,
  week: Week,
  selectedDate: string,
  scoring: ScoringWeight[],
): Promise<RosterPlayer[]> {
  const { data: leaguePlayers, error: lpErr } = await supabase
    .from('league_players')
    .select('player_id, roster_slot, players(name, position, nba_team, external_id_nba, status)')
    .eq('team_id', teamId)
    .eq('league_id', leagueId);
  if (lpErr) throw lpErr;
  if (!leaguePlayers || leaguePlayers.length === 0) return [];

  const playerIds = leaguePlayers.map((lp: any) => lp.player_id);
  const defaultSlotMap = new Map<string, string>(
    leaguePlayers.map((lp: any) => [lp.player_id, lp.roster_slot ?? 'BE']),
  );

  const { data: dailyEntries } = await supabase
    .from('daily_lineups')
    .select('player_id, roster_slot, lineup_date')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .lte('lineup_date', week.end_date)
    .order('lineup_date', { ascending: false });

  const dailyByPlayer = new Map<string, Array<{ lineup_date: string; roster_slot: string }>>();
  for (const entry of dailyEntries ?? []) {
    if (!dailyByPlayer.has(entry.player_id)) dailyByPlayer.set(entry.player_id, []);
    dailyByPlayer.get(entry.player_id)!.push(entry);
  }

  const resolveSlot = (playerId: string, day: string): string => {
    const entries = dailyByPlayer.get(playerId) ?? [];
    const entry = entries.find((e) => e.lineup_date <= day);
    return entry?.roster_slot ?? defaultSlotMap.get(playerId) ?? 'BE';
  };

  const today = toDateStr(new Date());
  const weekEndForQuery = selectedDate >= today ? addDays(today, -1) : week.end_date;

  const { data: gameLogs } = await supabase
    .from('player_games')
    .select('player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date, matchup')
    .in('player_id', playerIds)
    .gte('game_date', week.start_date)
    .lte('game_date', weekEndForQuery);

  const weekPointsMap = new Map<string, number>();
  const dayPointsMap = new Map<string, number>();
  const dayMatchupMap = new Map<string, string>();
  const dayStatsMap = new Map<string, Record<string, number>>();

  for (const game of gameLogs ?? []) {
    const slot = resolveSlot(game.player_id, game.game_date);
    if (slot === 'BE' || slot === 'IR') continue;
    const fp = calculateGameFantasyPoints(game as any, scoring);
    weekPointsMap.set(game.player_id, (weekPointsMap.get(game.player_id) ?? 0) + fp);
    if (game.game_date === selectedDate) {
      dayPointsMap.set(game.player_id, (dayPointsMap.get(game.player_id) ?? 0) + fp);
      if (game.matchup) dayMatchupMap.set(game.player_id, game.matchup);
      dayStatsMap.set(game.player_id, {
        pts: game.pts, reb: game.reb, ast: game.ast, stl: game.stl,
        blk: game.blk, tov: game.tov, fgm: game.fgm, fga: game.fga,
        '3pm': game['3pm'], ftm: game.ftm, fta: game.fta, pf: game.pf,
      });
    }
  }

  return leaguePlayers.map((lp: any) => ({
    player_id: lp.player_id,
    name: lp.players?.name ?? '—',
    position: lp.players?.position ?? '—',
    nba_team: lp.players?.nba_team ?? '—',
    external_id_nba: lp.players?.external_id_nba ?? null,
    status: lp.players?.status ?? 'active',
    nbaTricode: (() => {
      const t = lp.players?.nba_team ?? '';
      return t && t !== 'Active' && t !== 'Inactive' ? t : null;
    })(),
    roster_slot: resolveSlot(lp.player_id, selectedDate),
    weekPoints: round1(weekPointsMap.get(lp.player_id) ?? 0),
    dayPoints: round1(dayPointsMap.get(lp.player_id) ?? 0),
    dayMatchup: dayMatchupMap.get(lp.player_id) ?? null,
    dayStatLine: (() => {
      const ds = dayStatsMap.get(lp.player_id);
      return ds ? buildStatLine(ds, scoring) : null;
    })(),
  }));
}

// ─── Main screen ────────────────────────────────────────────────────────────

export default function MatchupDetailScreen() {
  const { id: matchupId } = useLocalSearchParams<{ id: string }>();
  const { leagueId } = useAppState();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: scoring } = useLeagueScoring(leagueId ?? '');
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId ?? '');

  const today = toDateStr(new Date());
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);

  // Fetch matchup + week info
  const { data: matchupInfo, isLoading: infoLoading } = useQuery({
    queryKey: ['matchupDetail', matchupId],
    queryFn: async () => {
      const { data: matchup, error: mErr } = await supabase
        .from('league_matchups')
        .select('id, home_team_id, away_team_id, home_score, away_score, schedule_id, playoff_round')
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

      const homePlayers = await fetchTeamData(matchup.home_team_id, leagueId, w, effectiveDate, scoring);
      const homeTeam: TeamMatchupData = {
        teamId: matchup.home_team_id,
        teamName: homeName,
        players: homePlayers,
        weekTotal: round1(homePlayers.reduce((s, p) => s + p.weekPoints, 0)),
        dayTotal: round1(homePlayers.reduce((s, p) => s + p.dayPoints, 0)),
      };

      let awayTeam: TeamMatchupData | null = null;
      if (matchup.away_team_id && awayName) {
        const awayPlayers = await fetchTeamData(matchup.away_team_id, leagueId, w, effectiveDate, scoring);
        awayTeam = {
          teamId: matchup.away_team_id,
          teamName: awayName,
          players: awayPlayers,
          weekTotal: round1(awayPlayers.reduce((s, p) => s + p.weekPoints, 0)),
          dayTotal: round1(awayPlayers.reduce((s, p) => s + p.dayPoints, 0)),
        };
      }

      return { homeTeam, awayTeam };
    },
    enabled: !!matchupInfo && !!leagueId && !!scoring && scoring.length > 0,
    staleTime: 1000 * 60 * 2,
  });

  // Live stats
  const allPlayerIds: string[] = teamData
    ? [
        ...teamData.homeTeam.players.map((p) => p.player_id),
        ...(teamData.awayTeam?.players.map((p) => p.player_id) ?? []),
      ]
    : [];
  const isToday = effectiveDate === today;
  const liveMap = useLivePlayerStats(allPlayerIds, isToday);

  // Future schedule
  const isFutureDate = effectiveDate > today;
  const { data: futureSchedule } = useQuery<Map<string, string>>({
    queryKey: ['futureSchedule', effectiveDate],
    queryFn: () => fetchNbaScheduleForDate(effectiveDate),
    enabled: isToday || isFutureDate,
    staleTime: 1000 * 60 * 60,
  });

  const mode: DisplayMode = effectiveDate < today ? 'past' : effectiveDate === today ? 'today' : 'future';

  function computeLiveBonus(players: RosterPlayer[]): number {
    if (!isToday) return 0;
    return round1(
      players.reduce((sum, p) => {
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

  const headerTitle = week ? `Week ${week.week_number}` : 'Matchup';

  if (infoLoading) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <PageHeader title="Matchup" />
        <ActivityIndicator style={{ marginTop: 40 }} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader
        title={headerTitle}
        rightAction={
          week ? (
            <ThemedText style={[styles.weekRange, { color: c.secondaryText }]}>
              {formatWeekRange(week.start_date, week.end_date)}
            </ThemedText>
          ) : undefined
        }
      />

      {/* Day navigation */}
      {week && (
        <View style={[styles.dayNav, { borderBottomColor: c.border }]}>
          <TouchableOpacity
            onPress={goBack}
            style={styles.navArrow}
            disabled={!canGoBack}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            accessibilityState={{ disabled: !canGoBack }}
          >
            <Text style={[styles.arrow, { color: canGoBack ? c.accent : c.buttonDisabled }]}>‹</Text>
          </TouchableOpacity>
          <View style={styles.dayInfo}>
            <ThemedText type="defaultSemiBold" style={styles.dayLabel}>
              {formatDayLabel(effectiveDate)}
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
            <Text style={[styles.arrow, { color: canGoForward ? c.accent : c.buttonDisabled }]}>›</Text>
          </TouchableOpacity>
        </View>
      )}

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {teamLoading ? (
          <MatchupSkeleton c={c} />
        ) : teamData ? (
          <View>
            {/* Score header */}
            <View style={colStyles.scoreHeader} accessibilityLabel={`${teamData.homeTeam.teamName} ${round1(teamData.homeTeam.weekTotal + homeLiveBonus).toFixed(1)} vs ${teamData.awayTeam?.teamName ?? 'BYE'} ${teamData.awayTeam ? round1(teamData.awayTeam.weekTotal + awayLiveBonus).toFixed(1) : '0.0'}`}>
              <View style={[colStyles.scoreCol, { alignItems: 'flex-start' }]}>
                <Text style={[colStyles.teamName, { color: c.text }]} numberOfLines={1}>
                  {teamData.homeTeam.teamName}
                </Text>
                <Text style={[colStyles.total, { color: c.accent }]}>
                  {round1(teamData.homeTeam.weekTotal + homeLiveBonus).toFixed(1)}
                </Text>
                {mode !== 'future' && (
                  <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>
                    {round1(teamData.homeTeam.dayTotal + homeLiveBonus).toFixed(1)} today
                  </Text>
                )}
              </View>
              <Text style={[colStyles.vsText, { color: c.secondaryText }]}>vs</Text>
              <View style={[colStyles.scoreCol, { alignItems: 'flex-end' }]}>
                <Text style={[colStyles.teamName, { color: c.text, textAlign: 'right' }]} numberOfLines={1}>
                  {teamData.awayTeam?.teamName ?? 'BYE'}
                </Text>
                <Text style={[colStyles.total, { color: c.accent }]}>
                  {teamData.awayTeam
                    ? round1(teamData.awayTeam.weekTotal + awayLiveBonus).toFixed(1)
                    : '0.0'}
                </Text>
                {mode !== 'future' && teamData.awayTeam && (
                  <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>
                    {round1(teamData.awayTeam.dayTotal + awayLiveBonus).toFixed(1)} today
                  </Text>
                )}
              </View>
            </View>

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
                  />
                </View>
              );
            })}
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
  weekRange: { fontSize: 11 },
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
  scoreHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  scoreCol: { flex: 1 },
  teamName: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  total: { fontSize: 22, fontWeight: '700' },
  dayTotal: { fontSize: 12, marginTop: 2 },
  vsText: { fontSize: 12, marginHorizontal: 8, marginTop: 2 },
});

export const options = { headerShown: false };
