import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ScoringWeight } from '@/types/player';
import { calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

interface Matchup {
  id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
}

interface RosterPlayer {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  roster_slot: string;
  weekPoints: number;
}

interface TeamMatchupData {
  teamId: string;
  teamName: string;
  players: RosterPlayer[];
  totalPoints: number;
}

// ─── Data fetching helpers ────────────────────────────────────────────────────

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0];
}

function parseLocalDate(str: string): Date {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatWeekRange(start: string, end: string): string {
  const s = parseLocalDate(start);
  const e = parseLocalDate(end);
  const fmt = (d: Date) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(s)} – ${fmt(e)}`;
}

async function fetchWeeks(leagueId: string): Promise<Week[]> {
  const { data, error } = await supabase
    .from('league_schedule')
    .select('id, week_number, start_date, end_date, is_playoff')
    .eq('league_id', leagueId)
    .order('week_number', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function findCurrentWeekIndex(weeks: Week[]): Promise<number> {
  const today = toDateStr(new Date());
  const idx = weeks.findIndex((w) => w.start_date <= today && today <= w.end_date);
  if (idx !== -1) return idx;
  // If before first week, show week 1; if after last week, show last
  if (today < weeks[0]?.start_date) return 0;
  return weeks.length - 1;
}

async function fetchMatchupForWeek(scheduleId: string, teamId: string): Promise<Matchup | null> {
  const { data, error } = await supabase
    .from('league_matchups')
    .select('id, home_team_id, away_team_id, home_score, away_score')
    .eq('schedule_id', scheduleId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchTeamName(teamId: string): Promise<string> {
  const { data } = await supabase.from('teams').select('name').eq('id', teamId).single();
  return data?.name ?? 'Unknown Team';
}

async function fetchRosterWithPoints(
  teamId: string,
  leagueId: string,
  startDate: string,
  endDate: string,
  scoring: ScoringWeight[]
): Promise<RosterPlayer[]> {
  // Get non-bench roster players
  const { data: leaguePlayers, error: lpErr } = await supabase
    .from('league_players')
    .select('player_id, roster_slot, players(name, position, nba_team)')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .neq('roster_slot', 'BE');

  if (lpErr) throw lpErr;
  if (!leaguePlayers || leaguePlayers.length === 0) return [];

  const playerIds = leaguePlayers.map((lp: any) => lp.player_id);

  // Fetch game logs for this week
  const { data: gameLogs } = await supabase
    .from('player_games')
    .select('player_id, pts, reb, ast, stl, blk, tov, fgm, fga, "3pm", "3pa", ftm, fta, pf, double_double, triple_double, game_date')
    .in('player_id', playerIds)
    .gte('game_date', startDate)
    .lte('game_date', endDate);

  // Sum up points per player
  const pointsMap = new Map<string, number>();
  for (const game of gameLogs ?? []) {
    const fp = calculateGameFantasyPoints(game as any, scoring);
    pointsMap.set(game.player_id, (pointsMap.get(game.player_id) ?? 0) + fp);
  }

  return leaguePlayers.map((lp: any) => ({
    player_id: lp.player_id,
    name: lp.players?.name ?? '—',
    position: lp.players?.position ?? '—',
    nba_team: lp.players?.nba_team ?? '—',
    roster_slot: lp.roster_slot,
    weekPoints: Math.round((pointsMap.get(lp.player_id) ?? 0) * 10) / 10,
  }));
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

function useWeeks(leagueId: string | null) {
  return useQuery({
    queryKey: ['leagueSchedule', leagueId],
    queryFn: () => fetchWeeks(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });
}

function useScoring(leagueId: string | null) {
  return useQuery<ScoringWeight[]>({
    queryKey: ['leagueScoring', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_scoring_settings')
        .select('stat_name, point_value')
        .eq('league_id', leagueId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 60,
  });
}

function useWeekMatchup(
  week: Week | undefined,
  teamId: string | null,
  leagueId: string | null,
  scoring: ScoringWeight[]
) {
  return useQuery({
    queryKey: ['weekMatchup', week?.id, teamId],
    queryFn: async (): Promise<{ myTeam: TeamMatchupData; opponentTeam: TeamMatchupData | null } | null> => {
      if (!week || !teamId || !leagueId) return null;

      const matchup = await fetchMatchupForWeek(week.id, teamId);
      if (!matchup) return null;

      const opponentId =
        matchup.home_team_id === teamId ? matchup.away_team_id : matchup.home_team_id;

      const [myPlayers, myName] = await Promise.all([
        fetchRosterWithPoints(teamId, leagueId, week.start_date, week.end_date, scoring),
        fetchTeamName(teamId),
      ]);

      const myTotal = myPlayers.reduce((s, p) => s + p.weekPoints, 0);

      let opponentTeam: TeamMatchupData | null = null;
      if (opponentId) {
        const [oppPlayers, oppName] = await Promise.all([
          fetchRosterWithPoints(opponentId, leagueId, week.start_date, week.end_date, scoring),
          fetchTeamName(opponentId),
        ]);
        opponentTeam = {
          teamId: opponentId,
          teamName: oppName,
          players: oppPlayers,
          totalPoints: Math.round(oppPlayers.reduce((s, p) => s + p.weekPoints, 0) * 10) / 10,
        };
      }

      return {
        myTeam: {
          teamId,
          teamName: myName,
          players: myPlayers,
          totalPoints: Math.round(myTotal * 10) / 10,
        },
        opponentTeam,
      };
    },
    enabled: !!week && !!teamId && !!leagueId && scoring.length > 0,
    staleTime: 1000 * 60 * 2,
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PlayerRow({ player, c }: { player: RosterPlayer; c: any }) {
  return (
    <View style={pStyles.row}>
      <View style={pStyles.slotBadge}>
        <Text style={[pStyles.slotText, { color: c.secondaryText }]}>{player.roster_slot}</Text>
      </View>
      <View style={pStyles.info}>
        <Text style={[pStyles.name, { color: c.text }]} numberOfLines={1}>{player.name}</Text>
        <Text style={[pStyles.meta, { color: c.secondaryText }]}>
          {player.position} · {player.nba_team}
        </Text>
      </View>
      <Text style={[pStyles.pts, { color: player.weekPoints > 0 ? c.text : c.secondaryText }]}>
        {player.weekPoints > 0 ? player.weekPoints.toFixed(1) : '—'}
      </Text>
    </View>
  );
}

function TeamColumn({ team, c, side }: { team: TeamMatchupData; c: any; side: 'left' | 'right' }) {
  return (
    <View style={[colStyles.col, side === 'right' && colStyles.rightCol]}>
      <Text style={[colStyles.teamName, { color: c.text }]} numberOfLines={1}>
        {team.teamName}
      </Text>
      <Text style={[colStyles.total, { color: c.accent }]}>
        {team.totalPoints.toFixed(1)} pts
      </Text>
      {team.players.map((p) => (
        <PlayerRow key={p.player_id} player={p} c={c} />
      ))}
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function MatchupScreen() {
  const { leagueId, teamId } = useAppState();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: weeks, isLoading: weeksLoading } = useWeeks(leagueId);
  const { data: scoring } = useScoring(leagueId);

  // selectedWeekIdx: null until weeks load
  const [selectedWeekIdx, setSelectedWeekIdx] = useState<number | null>(null);

  // Determine current week index on first load
  const resolvedIdx = (() => {
    if (selectedWeekIdx !== null) return selectedWeekIdx;
    if (!weeks || weeks.length === 0) return 0;
    const today = toDateStr(new Date());
    const idx = weeks.findIndex((w) => w.start_date <= today && today <= w.end_date);
    if (idx !== -1) return idx;
    return today < weeks[0].start_date ? 0 : weeks.length - 1;
  })();

  const currentWeek = weeks?.[resolvedIdx];

  const { data: matchupData, isLoading: matchupLoading } = useWeekMatchup(
    currentWeek,
    teamId,
    leagueId,
    scoring ?? []
  );

  const isBye = matchupData && matchupData.opponentTeam === null;
  const isPast = currentWeek ? toDateStr(new Date()) > currentWeek.end_date : false;
  const isFuture = currentWeek ? toDateStr(new Date()) < currentWeek.start_date : false;

  if (!leagueId) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText>Join or create a league to see matchups.</ThemedText>
      </ThemedView>
    );
  }

  if (weeksLoading) {
    return (
      <ThemedView style={styles.center}>
        <ActivityIndicator />
      </ThemedView>
    );
  }

  if (!weeks || weeks.length === 0) {
    return (
      <ThemedView style={styles.center}>
        <ThemedText type="defaultSemiBold">Season not started yet.</ThemedText>
        <ThemedText style={{ color: c.secondaryText, marginTop: 6, textAlign: 'center' }}>
          The commissioner needs to generate the schedule after the draft.
        </ThemedText>
      </ThemedView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      {/* Week navigation */}
      <View style={[styles.weekNav, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          disabled={resolvedIdx === 0}
          onPress={() => setSelectedWeekIdx(resolvedIdx - 1)}
          style={styles.navArrow}
        >
          <Text style={[styles.arrow, { color: resolvedIdx === 0 ? c.buttonDisabled : c.text }]}>
            ‹
          </Text>
        </TouchableOpacity>

        <View style={styles.weekInfo}>
          <ThemedText type="defaultSemiBold" style={styles.weekLabel}>
            {currentWeek?.is_playoff ? 'Playoffs — ' : ''}Week {currentWeek?.week_number}
          </ThemedText>
          {currentWeek && (
            <ThemedText style={[styles.weekRange, { color: c.secondaryText }]}>
              {formatWeekRange(currentWeek.start_date, currentWeek.end_date)}
            </ThemedText>
          )}
        </View>

        <TouchableOpacity
          disabled={resolvedIdx === weeks.length - 1}
          onPress={() => setSelectedWeekIdx(resolvedIdx + 1)}
          style={styles.navArrow}
        >
          <Text style={[styles.arrow, { color: resolvedIdx === weeks.length - 1 ? c.buttonDisabled : c.text }]}>
            ›
          </Text>
        </TouchableOpacity>
      </View>

      {/* Matchup body */}
      <ScrollView contentContainerStyle={styles.body}>
        {matchupLoading && <ActivityIndicator style={{ marginTop: 40 }} />}

        {!matchupLoading && !matchupData && (
          <View style={styles.center}>
            <ThemedText style={{ color: c.secondaryText }}>No matchup found for this week.</ThemedText>
          </View>
        )}

        {!matchupLoading && matchupData && (
          <>
            {isBye && (
              <View style={[styles.byeBanner, { backgroundColor: c.card }]}>
                <ThemedText type="defaultSemiBold">Bye Week</ThemedText>
              </View>
            )}

            {isFuture && (
              <View style={[styles.futureBanner, { backgroundColor: c.card }]}>
                <ThemedText style={{ color: c.secondaryText, fontSize: 13 }}>
                  Showing current lineups — points will accumulate when games are played.
                </ThemedText>
              </View>
            )}

            <View style={styles.matchupRow}>
              <TeamColumn team={matchupData.myTeam} c={c} side="left" />

              {matchupData.opponentTeam ? (
                <>
                  <View style={[styles.vsBar, { backgroundColor: c.border }]} />
                  <TeamColumn team={matchupData.opponentTeam} c={c} side="right" />
                </>
              ) : null}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  weekNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navArrow: { padding: 12 },
  arrow: { fontSize: 28, lineHeight: 32 },
  weekInfo: { flex: 1, alignItems: 'center' },
  weekLabel: { fontSize: 16 },
  weekRange: { fontSize: 12, marginTop: 2 },
  body: { padding: 12, flexGrow: 1 },
  byeBanner: { borderRadius: 8, padding: 16, alignItems: 'center', marginBottom: 12 },
  futureBanner: { borderRadius: 8, padding: 10, marginBottom: 12 },
  matchupRow: { flexDirection: 'row', flex: 1 },
  vsBar: { width: StyleSheet.hairlineWidth, marginHorizontal: 6 },
});

const colStyles = StyleSheet.create({
  col: { flex: 1 },
  rightCol: {},
  teamName: { fontWeight: '600', fontSize: 14, marginBottom: 2 },
  total: { fontSize: 18, fontWeight: '700', marginBottom: 10 },
});

const pStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, gap: 6 },
  slotBadge: { width: 36, alignItems: 'center' },
  slotText: { fontSize: 10, fontWeight: '600' },
  info: { flex: 1 },
  name: { fontSize: 12, fontWeight: '500' },
  meta: { fontSize: 10 },
  pts: { fontSize: 13, fontWeight: '700', minWidth: 36, textAlign: 'right' },
});
