import { CategoryScoreboard } from '@/components/matchup/CategoryScoreboard';
import { ms, s } from "@/utils/scale";
import { PlayerCell, pStyles, RosterPlayer, DisplayMode, round1, buildStatLine } from '@/components/matchup/PlayerCell';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { WeeklySummaryModal } from '@/components/matchup/WeeklySummaryModal';
import { TeamLogo } from '@/components/team/TeamLogo';
import { FptsBreakdownModal } from '@/components/player/FptsBreakdownModal';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { InfoModal } from '@/components/ui/InfoModal';
import { ThemedText } from '@/components/ui/ThemedText';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLeagueRosterConfig, RosterConfigSlot } from '@/hooks/useLeagueRosterConfig';
import { useWeekScores } from '@/hooks/useWeekScores';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { aggregateTeamStats, computeCategoryResults, TeamStatTotals } from '@/utils/categoryScoring';
import { fetchTeamData } from '@/utils/fetchTeamData';
import { liveToGameLog, LivePlayerStats, useLivePlayerStats } from '@/utils/nbaLive';
import { parseLocalDate, addDays, formatDayLabel, useToday } from '@/utils/dates';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { fetchNbaScheduleForDate } from '@/utils/nbaSchedule';
import { calculateGameFantasyPoints, formatScore } from '@/utils/fantasyPoints';
import { calcRounds } from '@/utils/playoff';
import { slotLabel } from '@/utils/rosterSlots';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useRosterChanges } from '@/hooks/useRosterChanges';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

async function fetchWeeklyAdds(leagueId: string, teamId: string): Promise<number> {
  const now = new Date();
  const day = now.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset);
  const weekStart = monday.toISOString().split('T')[0];

  const { count, error } = await supabase
    .from('league_transactions')
    .select('id, league_transaction_items!inner(team_to_id)', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .eq('type', 'waiver')
    .not('league_transaction_items.team_to_id', 'is', null)
    .gte('created_at', weekStart + 'T00:00:00');
  if (error) throw error;
  return count ?? 0;
}
import { SafeAreaView } from 'react-native-safe-area-context';

function getPlayoffRoundLabel(round: number, totalRounds: number, isThirdPlace: boolean): string {
  if (isThirdPlace) return '3rd Place Game';
  if (round === totalRounds) return 'Championship';
  if (round === totalRounds - 1) return 'Semifinals';
  if (round === totalRounds - 2) return 'Quarterfinals';
  return `Playoff Round ${round}`;
}

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
  logoKey: string | null;
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
  pro_team: string;
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
  const weekStatsPerPlayer = new Map<string, Record<string, number>>();

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
        // Accumulate per-player weekly stat totals
        const existing = weekStatsPerPlayer.get(p.player_id) ?? {};
        for (const [key, val] of Object.entries(g.stats)) {
          if (val != null) {
            const numVal = typeof val === 'boolean' ? (val ? 1 : 0) : Number(val);
            existing[key] = (existing[key] ?? 0) + numVal;
          }
        }
        weekStatsPerPlayer.set(p.player_id, existing);
      }
    }

    const t = p.pro_team ?? '';
    return {
      player_id: p.player_id,
      name: p.name,
      position: p.position,
      pro_team: t,
      nbaTricode: t && t !== 'Active' && t !== 'Inactive' ? t : null,
      external_id_nba: p.external_id_nba,
      status: 'active',
      roster_slot: daySlot,
      weekPoints: round1(p.week_points),
      dayPoints: isDayActive && dayGame ? round1(dayGame.fpts) : 0,
      dayMatchup: isDayActive && dayGame ? dayGame.matchup : null,
      dayStatLine: isDayActive && dayGame ? buildStatLine(dayGame.stats, scoring) : null,
      dayGameStats: isDayActive && dayGame ? dayGame.stats : null,
      projectedFpts: 0,
      weekGameStats: weekStatsPerPlayer.get(p.player_id) ?? null,
    };
  });

  return { players, teamStats: aggregateTeamStats(activeGames) };
}

// ─── Main screen ────────────────────────────────────────────────────────────

export default function MatchupDetailScreen() {
  const { id: matchupId } = useLocalSearchParams<{ id: string }>();
  const { leagueId, teamId } = useAppState();
  const sport = useActiveLeagueSport();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: league } = useLeague();
  const { data: scoring } = useLeagueScoring(leagueId ?? '');
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId ?? '');
  const isCategories = league?.scoring_type === 'h2h_categories';
  useRosterChanges(leagueId);

  const today = useToday();
  const [selectedDate, setSelectedDate] = useState<string>(today);
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);
  const [fptsBreakdown, setFptsBreakdown] = useState<{ stats: Record<string, number | boolean>; playerName: string; gameLabel: string } | null>(null);
  const [weeklySummaryVisible, setWeeklySummaryVisible] = useState(false);
  const [acqInfoVisible, setAcqInfoVisible] = useState(false);

  // Fetch matchup + week info
  const { data: matchupInfo, isLoading: infoLoading, isError: isInfoError } = useQuery({
    queryKey: queryKeys.matchupDetail(matchupId!),
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
        .select('id, name, logo_key')
        .in('id', [matchup.home_team_id, matchup.away_team_id].filter((id): id is string => id != null));

      const teamMap = new Map((teams ?? []).map((t: any) => [t.id, { name: t.name, logoKey: t.logo_key ?? null }]));

      // Check if this is a 3rd place game (for playoff matchups)
      let isThirdPlace = false;
      if (matchup.playoff_round != null) {
        const { data: bracketRow } = await supabase
          .from('playoff_bracket')
          .select('is_third_place')
          .eq('matchup_id', matchup.id)
          .maybeSingle();
        isThirdPlace = bracketRow?.is_third_place ?? false;
      }

      return {
        matchup,
        week: week as Week,
        homeName: teamMap.get(matchup.home_team_id)?.name ?? 'Unknown',
        homeLogoKey: teamMap.get(matchup.home_team_id)?.logoKey ?? null,
        awayName: matchup.away_team_id ? (teamMap.get(matchup.away_team_id)?.name ?? 'Unknown') : null,
        awayLogoKey: matchup.away_team_id ? (teamMap.get(matchup.away_team_id)?.logoKey ?? null) : null,
        isThirdPlace,
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
    queryKey: queryKeys.matchupTeams(matchupId!, effectiveDate),
    queryFn: async () => {
      if (!matchupInfo || !leagueId || !scoring) return null;
      const { matchup, week: w, homeName, awayName, homeLogoKey, awayLogoKey } = matchupInfo;

      // For finalized matchups with stored player scores, read directly
      const useStored = matchup.is_finalized && matchup.home_player_scores;

      if (useStored) {
        const homeResult = buildFromStored(matchup.home_player_scores as unknown as StoredPlayerScore[], effectiveDate, scoring);
        const homeTeam: TeamMatchupData = {
          teamId: matchup.home_team_id,
          teamName: homeName,
          logoKey: homeLogoKey,
          players: homeResult.players,
          weekTotal: round1(homeResult.players.reduce((s, p) => s + p.weekPoints, 0)),
          dayTotal: round1(homeResult.players.reduce((s, p) => s + p.dayPoints, 0)),
          teamStats: homeResult.teamStats,
        };

        let awayTeam: TeamMatchupData | null = null;
        if (matchup.away_team_id && awayName && matchup.away_player_scores) {
          const awayResult = buildFromStored(matchup.away_player_scores as unknown as StoredPlayerScore[], effectiveDate, scoring);
          awayTeam = {
            teamId: matchup.away_team_id,
            teamName: awayName,
            logoKey: awayLogoKey,
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
        logoKey: homeLogoKey,
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
          logoKey: awayLogoKey,
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
  const weekIsLive = !!week && week.start_date <= today && today <= week.end_date;
  const rawLiveMap = useLivePlayerStats(allPlayerIds, isToday || isYesterday);

  // Filter live stats to only include games matching the selected date.
  // For past dates, exclude final games (status 3) — already in player_games.
  const liveMap = new Map(
    [...rawLiveMap].filter(([, stats]) => {
      if (stats.game_date !== effectiveDate) return false;
      if (stats.game_date < today && stats.game_status === 3) return false;
      return true;
    })
  );

  // Server-authoritative week scores
  const { data: weekScores } = useWeekScores({
    leagueId,
    scheduleId: week?.id ?? null,
    weekIsLive,
  });

  // Future schedule
  const isFutureDate = effectiveDate > today;
  const { data: futureSchedule } = useQuery<Map<string, any>>({
    queryKey: [...queryKeys.futureSchedule(effectiveDate), sport],
    queryFn: () => fetchNbaScheduleForDate(effectiveDate, sport),
    enabled: isToday || isFutureDate,
    staleTime: 1000 * 60 * 60,
  });

  // Weekly acquisition limit
  const weeklyLimit = (league?.weekly_acquisition_limit as number | null) ?? null;
  const homeTeamId = teamData?.homeTeam.teamId ?? null;
  const awayTeamId = teamData?.awayTeam?.teamId ?? null;

  const { data: homeAdds } = useQuery({
    queryKey: queryKeys.weeklyAdds(leagueId!, homeTeamId!),
    queryFn: () => fetchWeeklyAdds(leagueId!, homeTeamId!),
    enabled: !!leagueId && !!homeTeamId && weeklyLimit != null,
    staleTime: 1000 * 60 * 2,
  });

  const { data: awayAdds } = useQuery({
    queryKey: queryKeys.weeklyAdds(leagueId!, awayTeamId!),
    queryFn: () => fetchWeeklyAdds(leagueId!, awayTeamId!),
    enabled: !!leagueId && !!awayTeamId && weeklyLimit != null,
    staleTime: 1000 * 60 * 2,
  });

  const mode: DisplayMode = effectiveDate < today ? 'past' : effectiveDate === today ? 'today' : 'future';

  // For future mode, compute projected day total from active players' season averages
  const computeProjectedDay = (players: RosterPlayer[], schedule?: Map<string, any>) => {
    if (!schedule) return 0;
    return round1(players.reduce((sum, p) => {
      if (p.roster_slot === 'BE' || p.roster_slot === 'IR' || p.roster_slot === 'DROPPED') return sum;
      if (!p.nbaTricode || !schedule.has(p.nbaTricode)) return sum;
      return sum + (p.projectedFpts ?? 0);
    }, 0));
  };

  // Day live bonus uses date-filtered liveMap
  function computeDayLiveBonus(players: RosterPlayer[]): number {
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

  const homeDayLiveBonus = teamData?.homeTeam ? computeDayLiveBonus(teamData.homeTeam.players) : 0;
  const awayDayLiveBonus = teamData?.awayTeam ? computeDayLiveBonus(teamData.awayTeam.players) : 0;

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
        <View style={{ marginTop: 40 }}><LogoSpinner /></View>
      </SafeAreaView>
    );
  }

  if (isInfoError || !matchupInfo) {
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
        <ThemedText style={{ textAlign: 'center', marginTop: 40, fontSize: ms(15), color: c.secondaryText }}>
          Matchup not found
        </ThemedText>
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
                {week.is_playoff && matchupInfo?.matchup.playoff_round != null && league
                  ? `${getPlayoffRoundLabel(matchupInfo.matchup.playoff_round, calcRounds(league.playoff_teams ?? 8), matchupInfo.isThirdPlace)} · `
                  : week.is_playoff ? 'Playoffs · ' : ''}
                Week {week.week_number} · {formatWeekRange(week.start_date, week.end_date)}
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

      <ScrollView style={styles.scroll} contentContainerStyle={{ padding: 6, paddingBottom: 56 }} showsVerticalScrollIndicator={false}>
        {teamLoading ? (
          <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', paddingVertical: 48 }}>
            <LogoSpinner />
          </View>
        ) : teamData ? (
          <View>
            {/* Playoff round badge */}
            {matchupInfo?.matchup.playoff_round != null && league && (
              <>
                <View style={[playoffStyles.accentLine, { backgroundColor: c.gold }]} />
                <View
                  style={[playoffStyles.badge, { backgroundColor: c.goldMuted }]}
                  accessibilityRole="header"
                  accessibilityLabel={getPlayoffRoundLabel(matchupInfo.matchup.playoff_round, calcRounds(league.playoff_teams ?? 8), matchupInfo.isThirdPlace)}
                >
                  <Ionicons
                    name={matchupInfo.isThirdPlace ? 'medal-outline' : 'trophy'}
                    size={14}
                    color={c.gold}
                  />
                  <Text style={[playoffStyles.badgeText, { color: c.gold }]}>
                    {getPlayoffRoundLabel(matchupInfo.matchup.playoff_round, calcRounds(league.playoff_teams ?? 8), matchupInfo.isThirdPlace)}
                  </Text>
                </View>
              </>
            )}

            {/* Score header */}
            {(() => {
              const homeWeek = weekScores?.[teamData.homeTeam.teamId] ?? teamData.homeTeam.weekTotal;
              const awayWeek = teamData.awayTeam
                ? (weekScores?.[teamData.awayTeam.teamId] ?? teamData.awayTeam.weekTotal)
                : 0;
              const homeDay = mode === 'future'
                ? computeProjectedDay(teamData.homeTeam.players, futureSchedule)
                : round1(teamData.homeTeam.dayTotal + homeDayLiveBonus);
              const awayDay = mode === 'future' && teamData.awayTeam
                ? computeProjectedDay(teamData.awayTeam.players, futureSchedule)
                : (teamData.awayTeam ? round1(teamData.awayTeam.dayTotal + awayDayLiveBonus) : 0);

              if (isCategories && teamData.awayTeam) {
                // Merge live in-progress game stats into DB-based teamStats
                const mergeWithLive = (team: TeamMatchupData): TeamStatTotals => {
                  if (liveMap.size === 0) return team.teamStats;
                  const merged = { ...team.teamStats };
                  for (const p of team.players) {
                    if (p.roster_slot === 'BE' || p.roster_slot === 'IR' || p.roster_slot === 'DROPPED') continue;
                    const live = liveMap.get(p.player_id);
                    if (!live) continue;
                    const gameLog = liveToGameLog(live);
                    for (const [key, val] of Object.entries(gameLog)) {
                      if (val == null) continue;
                      const numVal = typeof val === 'boolean' ? (val ? 1 : 0) : Number(val);
                      merged[key] = (merged[key] ?? 0) + numVal;
                    }
                  }
                  return merged;
                };

                const catComparison = computeCategoryResults(
                  mergeWithLive(teamData.homeTeam),
                  mergeWithLive(teamData.awayTeam),
                  (scoring ?? []).map((s) => ({ stat_name: s.stat_name, inverse: !!s.inverse })),
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
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                      onPress={() => {
                        if (teamData.homeTeam.teamId === teamId) router.push('/(tabs)/roster');
                        else router.push(`/team-roster/${teamData.homeTeam.teamId}` as any);
                      }}
                      activeOpacity={0.6}
                      accessibilityRole="link"
                      accessibilityLabel={`View ${teamData.homeTeam.teamName} roster`}
                    >
                      <TeamLogo logoKey={teamData.homeTeam.logoKey} teamName={teamData.homeTeam.teamName} size="small" />
                      <Text style={[colStyles.teamName, { color: c.text }]} numberOfLines={1} accessibilityRole="header">
                        {teamData.homeTeam.teamName}
                      </Text>
                    </TouchableOpacity>
                    <Text style={[colStyles.total, { color: c.accent }]}>
                      {formatScore(homeWeek)}
                    </Text>
                    {mode !== 'future' && (
                      <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{formatScore(homeDay)} today</Text>
                    )}
                  </View>
                  <TouchableOpacity
                    style={colStyles.vsCol}
                    onPress={() => setWeeklySummaryVisible(true)}
                    accessibilityRole="button"
                    accessibilityLabel="View weekly summary"
                  >
                    <Text style={[colStyles.vsText, { color: c.secondaryText }]} accessible={false}>vs</Text>
                    <Text style={[colStyles.summaryBtnText, { color: c.accent }]}>Summary</Text>
                  </TouchableOpacity>
                  <View style={[colStyles.scoreCol, { alignItems: 'flex-end' }]}>
                    <TouchableOpacity
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
                      onPress={() => {
                        if (!teamData.awayTeam) return;
                        if (teamData.awayTeam.teamId === teamId) router.push('/(tabs)/roster');
                        else router.push(`/team-roster/${teamData.awayTeam.teamId}` as any);
                      }}
                      disabled={!teamData.awayTeam}
                      activeOpacity={0.6}
                      accessibilityRole="link"
                      accessibilityLabel={teamData.awayTeam ? `View ${teamData.awayTeam.teamName} roster` : 'BYE'}
                    >
                      <Text style={[colStyles.teamName, { color: c.text, textAlign: 'right' }]} numberOfLines={1} accessibilityRole="header">
                        {teamData.awayTeam?.teamName ?? 'BYE'}
                      </Text>
                      {teamData.awayTeam && <TeamLogo logoKey={teamData.awayTeam.logoKey} teamName={teamData.awayTeam.teamName} size="small" />}
                    </TouchableOpacity>
                    <Text style={[colStyles.total, { color: c.accent }]}>
                      {teamData.awayTeam ? formatScore(awayWeek) : '0.0'}
                    </Text>
                    {mode !== 'future' && (
                      teamData.awayTeam && <Text style={[colStyles.dayTotal, { color: c.secondaryText }]}>{formatScore(awayDay)} today</Text>
                    )}
                  </View>
                </View>
              );
            })()}

            {/* Slot rows */}
            {Array.from({ length: Math.max(homeSlots.length, awaySlots.length) }).map((_, i, arr) => {
              const homeSlot = homeSlots[i] ?? null;
              const awaySlot = awaySlots[i] ?? null;
              const slotPos = homeSlot?.slotPosition ?? awaySlot?.slotPosition ?? '';

              return (
                <View key={`slot-${i}`} style={[pStyles.slotRow, { borderBottomColor: c.border }, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
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
                    onFptsPress={(stats, name, label) => setFptsBreakdown({ stats, playerName: name, gameLabel: label })}
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
                    onFptsPress={(stats, name, label) => setFptsBreakdown({ stats, playerName: name, gameLabel: label })}
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
                    <Text style={{ color: c.secondaryText, fontSize: ms(11), fontWeight: '700', letterSpacing: 1 }}>BENCH</Text>
                  </View>
                  {Array.from({ length: maxBench }).map((_, i) => (
                    <View key={`bench-${i}`} style={[pStyles.slotRow, { borderBottomColor: c.border, opacity: 0.7 }, i === maxBench - 1 && { borderBottomWidth: 0 }]}>
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

            {/* Weekly acquisition limits */}
            {weeklyLimit != null && (
              <View
                style={[colStyles.acqRow, { borderTopColor: c.border }]}
                accessibilityLabel={`Weekly acquisitions: ${teamData.homeTeam.teamName} ${homeAdds ?? 0} of ${weeklyLimit}, ${teamData.awayTeam?.teamName ?? 'BYE'} ${awayAdds ?? 0} of ${weeklyLimit}`}
              >
                <TouchableOpacity
                  style={colStyles.acqPill}
                  onPress={() => setAcqInfoVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Acquisition info"
                >
                  <Text
                    style={[colStyles.acqText, {
                      color: (homeAdds ?? 0) >= weeklyLimit ? c.danger : c.secondaryText,
                    }]}
                  >
                    Acq: {homeAdds ?? 0}/{weeklyLimit}
                  </Text>
                </TouchableOpacity>
                {teamData.awayTeam && (
                  <View style={colStyles.acqPill}>
                    <Text
                      style={[colStyles.acqText, {
                        color: (awayAdds ?? 0) >= weeklyLimit ? c.danger : c.secondaryText,
                      }]}
                    >
                      Acq: {awayAdds ?? 0}/{weeklyLimit}
                    </Text>
                  </View>
                )}
              </View>
            )}
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

      {scoring && fptsBreakdown && (
        <FptsBreakdownModal
          visible
          onClose={() => setFptsBreakdown(null)}
          playerName={fptsBreakdown.playerName}
          gameLabel={fptsBreakdown.gameLabel}
          gameStats={fptsBreakdown.stats}
          scoringWeights={scoring}
        />
      )}

      {scoring && teamData && week && (
        <WeeklySummaryModal
          visible={weeklySummaryVisible}
          onClose={() => setWeeklySummaryVisible(false)}
          homeTeam={{ teamName: teamData.homeTeam.teamName, players: teamData.homeTeam.players }}
          awayTeam={
            teamData.awayTeam
              ? { teamName: teamData.awayTeam.teamName, players: teamData.awayTeam.players }
              : null
          }
          scoring={scoring}
          weekLabel={`Week ${week.week_number} · ${formatWeekRange(week.start_date, week.end_date)}`}
          liveMap={rawLiveMap}
        />
      )}

      <InfoModal
        visible={acqInfoVisible}
        onClose={() => setAcqInfoVisible(false)}
        title="Weekly Acquisitions"
        message="Player pickups used this matchup week. Once the limit is reached, no more free agent adds are allowed until next week."
      />
    </SafeAreaView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const playoffStyles = StyleSheet.create({
  accentLine: {
    height: 2,
    marginHorizontal: 6,
    borderRadius: 1,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 4,
  },
  badgeText: {
    fontSize: ms(13),
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  backBtn: { width: 36, alignItems: 'center' as const, justifyContent: 'center' as const },
  weekMeta: { fontSize: ms(11), marginTop: 2 },
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
  arrow: { fontSize: ms(28), fontWeight: '300' },
  dayInfo: { flex: 1, alignItems: 'center' },
  dayLabel: { fontSize: ms(15) },
  scroll: { flex: 1 },
  empty: { paddingVertical: 60, alignItems: 'center' },
});

const colStyles = StyleSheet.create({
  scoreHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  scoreCol: { flex: 1 },
  vsCol: { alignItems: 'center' as const, justifyContent: 'center' as const, marginHorizontal: 6, marginTop: 14 },
  vsText: { fontSize: ms(12), fontWeight: '600' },
  teamName: { fontWeight: '600', fontSize: ms(14), marginBottom: 2 },
  total: { fontSize: ms(20), fontWeight: '700' },
  dayTotal: { fontSize: ms(11), fontWeight: '500', marginTop: 2 },
  acqRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  acqPill: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  acqText: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  summaryBtnText: {
    fontSize: ms(10),
    fontWeight: '600' as const,
    marginTop: 2,
  },
});

export const options = { headerShown: false };
