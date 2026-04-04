import { ThemedText } from '@/components/ui/ThemedText';
import { PageHeader } from '@/components/ui/PageHeader';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { supabase } from '@/lib/supabase';
import { toDateStr, parseLocalDate } from '@/utils/dates';
import { formatScore } from '@/utils/fantasyPoints';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';

// ─── Types ───────────────────────────────────────────────────────────────────

interface Week {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

interface ScheduleMatchup {
  id: string;
  schedule_id: string;
  home_team_id: string;
  away_team_id: string | null;
  home_score: number;
  away_score: number;
  home_category_wins: number | null;
  away_category_wins: number | null;
  category_ties: number | null;
  is_finalized: boolean;
  playoff_round: number | null;
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

async function fetchTeamMatchups(
  leagueId: string,
  teamId: string,
): Promise<ScheduleMatchup[]> {
  const { data, error } = await supabase
    .from('league_matchups')
    .select(
      'id, schedule_id, home_team_id, away_team_id, home_score, away_score, home_category_wins, away_category_wins, category_ties, is_finalized, playoff_round',
    )
    .eq('league_id', leagueId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
  if (error) throw error;
  return data ?? [];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const ROW_HEIGHT = 72;

// ─── Component ───────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();
  const { data: league } = useLeague();
  const queryClient = useQueryClient();
  const listRef = useRef<FlatList>(null);

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [pickerVisible, setPickerVisible] = useState(false);

  // Use user's team as default
  const activeTeamId = selectedTeamId ?? teamId;

  const teams = league?.league_teams ?? [];
  const teamMap = useMemo(() => {
    const map: Record<string, { id: string; name: string; tricode: string }> = {};
    for (const t of teams) map[t.id] = t;
    return map;
  }, [teams]);

  const selectedTeamName = activeTeamId ? teamMap[activeTeamId]?.name ?? 'Select Team' : 'Select Team';

  const isCategories = league?.scoring_type === 'h2h_categories';

  // Refresh on focus
  useFocusEffect(
    useCallback(() => {
      queryClient.invalidateQueries({ queryKey: ['teamScheduleMatchups'] });
    }, [queryClient]),
  );

  // ─── Queries ─────────────────────────────────────────────────────────────

  const { data: weeks, isLoading: weeksLoading } = useQuery({
    queryKey: queryKeys.leagueSchedule(leagueId!),
    queryFn: () => fetchWeeks(leagueId!),
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 10,
  });

  const { data: matchups, isLoading: matchupsLoading } = useQuery({
    queryKey: queryKeys.teamScheduleMatchups(leagueId!, activeTeamId!),
    queryFn: () => fetchTeamMatchups(leagueId!, activeTeamId!),
    enabled: !!leagueId && !!activeTeamId,
    staleTime: 1000 * 60 * 5,
  });

  // ─── Derived data ───────────────────────────────────────────────────────

  const today = toDateStr(new Date());

  const matchupByScheduleId = useMemo(() => {
    const map = new Map<string, ScheduleMatchup>();
    for (const m of matchups ?? []) map.set(m.schedule_id, m);
    return map;
  }, [matchups]);

  const currentWeekIndex = useMemo(() => {
    if (!weeks) return 0;
    const idx = weeks.findIndex(
      (w) => w.start_date <= today && today <= w.end_date,
    );
    if (idx >= 0) return idx;
    // Fall back to last completed week
    const pastWeeks = weeks.filter((w) => w.end_date < today);
    return pastWeeks.length > 0 ? pastWeeks.length - 1 : 0;
  }, [weeks, today]);

  // Auto-scroll to current week once data loads
  const hasScrolled = useRef(false);
  const onListLayout = useCallback(() => {
    if (hasScrolled.current || !weeks || weeks.length === 0) return;
    hasScrolled.current = true;
    setTimeout(() => {
      listRef.current?.scrollToIndex({
        index: currentWeekIndex,
        animated: false,
        viewPosition: 0.3,
      });
    }, 100);
  }, [weeks, currentWeekIndex]);

  // Reset scroll flag when team changes
  useMemo(() => {
    hasScrolled.current = false;
  }, [activeTeamId]);

  // ─── Render helpers ─────────────────────────────────────────────────────

  function getResultLabel(matchup: ScheduleMatchup, weekState: WeekState): { text: string; color: string } | null {
    if (weekState === 'future') return null;

    const isHome = matchup.home_team_id === activeTeamId;

    if (isCategories && matchup.is_finalized && matchup.home_category_wins != null) {
      const myW = isHome ? matchup.home_category_wins ?? 0 : matchup.away_category_wins ?? 0;
      const oppW = isHome ? matchup.away_category_wins ?? 0 : matchup.home_category_wins ?? 0;
      const ties = matchup.category_ties ?? 0;
      const score = ties > 0 ? `${myW}-${oppW}-${ties}` : `${myW}-${oppW}`;
      if (myW > oppW) return { text: `W  ${score}`, color: c.success };
      if (myW < oppW) return { text: `L  ${score}`, color: c.danger };
      return { text: `T  ${score}`, color: c.secondaryText };
    }

    const myScore = isHome ? matchup.home_score : matchup.away_score;
    const oppScore = isHome ? matchup.away_score : matchup.home_score;

    if (matchup.is_finalized) {
      const scoreStr = `${formatScore(myScore)}-${formatScore(oppScore)}`;
      if (myScore > oppScore) return { text: `W  ${scoreStr}`, color: c.success };
      if (myScore < oppScore) return { text: `L  ${scoreStr}`, color: c.danger };
      return { text: `T  ${scoreStr}`, color: c.secondaryText };
    }

    if (weekState === 'live') {
      return { text: `${formatScore(myScore)}-${formatScore(oppScore)}`, color: c.accent };
    }

    return null;
  }

  function renderWeekRow({ item: week }: { item: Week }) {
    const matchup = matchupByScheduleId.get(week.id);
    const weekState = getWeekState(week, today);
    const isCurrent = weekState === 'live';
    const isBye = !matchup;

    // Resolve opponent
    let opponentName = '';
    let homeAway = '';
    if (matchup) {
      const isHome = matchup.home_team_id === activeTeamId;
      const opponentId = isHome ? matchup.away_team_id : matchup.home_team_id;
      if (!opponentId) {
        opponentName = 'BYE';
      } else {
        opponentName = teamMap[opponentId]?.name ?? 'Unknown';
        homeAway = isHome ? 'vs' : '@';
      }
    }

    const result = matchup ? getResultLabel(matchup, weekState) : null;
    const tappable = !!matchup && !!matchup.away_team_id;

    const rowContent = (
      <View
        style={[
          styles.weekRow,
          {
            backgroundColor: isCurrent ? c.activeCard : c.card,
            borderColor: isCurrent ? c.activeBorder : c.border,
          },
        ]}
      >
        {/* Left section: week info */}
        <View style={styles.weekInfo}>
          <View style={styles.weekLabelRow}>
            <ThemedText type="defaultSemiBold" style={styles.weekNumber}>
              Week {week.week_number}
            </ThemedText>
            {week.is_playoff && (
              <View style={styles.playoffBadge}>
                <Text style={[styles.playoffText, { color: c.statusText }]}>PLAYOFF</Text>
              </View>
            )}
            {isCurrent && (
              <View style={[styles.liveBadge, { backgroundColor: c.accent }]}>
                <Text style={[styles.liveText, { color: c.statusText }]}>LIVE</Text>
              </View>
            )}
          </View>
          <Text style={[styles.dateRange, { color: c.secondaryText }]}>
            {formatWeekRange(week.start_date, week.end_date)}
          </Text>
        </View>

        {/* Right section: opponent + result */}
        <View style={styles.matchupInfo}>
          {isBye ? (
            <Text style={[styles.byeLabel, { color: c.secondaryText }]}>BYE</Text>
          ) : (
            <>
              <ThemedText style={styles.opponentText} numberOfLines={1}>
                {homeAway ? `${homeAway} ` : ''}{opponentName}
              </ThemedText>
              {result ? (
                <Text style={[styles.resultText, { color: result.color }]}>
                  {result.text}
                </Text>
              ) : weekState === 'future' ? (
                <Text style={[styles.upcomingLabel, { color: c.secondaryText }]}>
                  Upcoming
                </Text>
              ) : null}
            </>
          )}
        </View>

        {/* Chevron for tappable rows */}
        {tappable && (
          <Ionicons
            name="chevron-forward"
            size={16}
            color={c.secondaryText}
            style={styles.chevron}
          />
        )}
      </View>
    );

    if (tappable) {
      return (
        <TouchableOpacity
          activeOpacity={0.7}
          onPress={() => router.push(`/matchup-detail/${matchup.id}` as any)}
          accessibilityRole="button"
          accessibilityLabel={`Week ${week.week_number}, ${homeAway} ${opponentName}${result ? `, ${result.text}` : ', Upcoming'}`}
          accessibilityHint="View matchup details"
        >
          {rowContent}
        </TouchableOpacity>
      );
    }

    return rowContent;
  }

  // ─── Main render ────────────────────────────────────────────────────────

  const isLoading = weeksLoading || matchupsLoading;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader title="Schedule" />

      {/* Team picker */}
      <TouchableOpacity
        style={[styles.pickerBtn, { backgroundColor: c.card, borderColor: c.border }]}
        onPress={() => setPickerVisible(true)}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={`Viewing schedule for ${selectedTeamName}. Tap to change team.`}
      >
        <ThemedText type="defaultSemiBold" style={styles.pickerLabel} numberOfLines={1}>
          {selectedTeamName}
        </ThemedText>
        <Ionicons name="chevron-down" size={18} color={c.secondaryText} />
      </TouchableOpacity>

      {/* Schedule list */}
      {isLoading ? (
        <ActivityIndicator style={styles.loader} />
      ) : !weeks || weeks.length === 0 ? (
        <View style={styles.emptyState}>
          <ThemedText style={{ color: c.secondaryText }}>
            Season schedule not generated yet
          </ThemedText>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={weeks}
          keyExtractor={(w) => w.id}
          renderItem={renderWeekRow}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
          onLayout={onListLayout}
          getItemLayout={(_, index) => ({
            length: ROW_HEIGHT + 10,
            offset: (ROW_HEIGHT + 10) * index,
            index,
          })}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
          }}
        />
      )}

      {/* Team picker modal */}
      <Modal
        visible={pickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPickerVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setPickerVisible(false)}
          accessibilityRole="button"
          accessibilityLabel="Close team picker"
        >
          <View style={[styles.modalSheet, { backgroundColor: c.card }]}>
            <ThemedText type="defaultSemiBold" style={styles.modalTitle}>
              Select Team
            </ThemedText>
            <FlatList
              data={teams}
              keyExtractor={(t) => t.id}
              renderItem={({ item: team }) => (
                <TouchableOpacity
                  style={[
                    styles.teamOption,
                    { borderBottomColor: c.border },
                    team.id === activeTeamId && { backgroundColor: c.activeCard },
                  ]}
                  onPress={() => {
                    setSelectedTeamId(team.id);
                    setPickerVisible(false);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={team.name}
                  accessibilityState={{ selected: team.id === activeTeamId }}
                >
                  <ThemedText style={styles.teamOptionName}>{team.name}</ThemedText>
                  <Text style={[styles.teamOptionTricode, { color: c.secondaryText }]}>
                    {team.tricode}
                  </Text>
                  {team.id === activeTeamId && (
                    <Ionicons name="checkmark" size={20} color={c.accent} />
                  )}
                </TouchableOpacity>
              )}
            />
          </View>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  pickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: s(16),
    marginTop: s(12),
    marginBottom: s(4),
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    borderRadius: 10,
    borderWidth: 1,
  },
  pickerLabel: {
    fontSize: ms(15),
    flex: 1,
    marginRight: s(8),
  },
  listContent: {
    paddingHorizontal: s(16),
    paddingTop: s(8),
    paddingBottom: s(40),
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    marginBottom: s(10),
    minHeight: s(ROW_HEIGHT),
  },
  weekInfo: {
    width: s(130),
    marginRight: s(12),
  },
  weekLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  weekNumber: {
    fontSize: ms(14),
  },
  playoffBadge: {
    backgroundColor: '#7c3aed',
    paddingHorizontal: s(5),
    paddingVertical: s(1),
    borderRadius: 4,
  },
  playoffText: {
    fontSize: ms(8),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  liveBadge: {
    paddingHorizontal: s(5),
    paddingVertical: s(1),
    borderRadius: 4,
  },
  liveText: {
    fontSize: ms(8),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  dateRange: {
    fontSize: ms(11),
    marginTop: s(2),
  },
  matchupInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  opponentText: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  resultText: {
    fontSize: ms(12),
    fontWeight: '700',
    marginTop: s(2),
  },
  upcomingLabel: {
    fontSize: ms(11),
    marginTop: s(2),
  },
  byeLabel: {
    fontSize: ms(13),
    fontStyle: 'italic',
    fontWeight: '600',
  },
  chevron: {
    marginLeft: s(8),
  },
  loader: {
    marginTop: s(40),
  },
  emptyState: {
    alignItems: 'center',
    paddingTop: s(40),
  },
  // Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSheet: {
    width: '85%',
    maxHeight: '60%',
    borderRadius: 14,
    paddingTop: s(16),
    paddingBottom: s(8),
  },
  modalTitle: {
    fontSize: ms(16),
    textAlign: 'center',
    marginBottom: s(12),
  },
  teamOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(16),
    paddingVertical: s(14),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(8),
  },
  teamOptionName: {
    fontSize: ms(15),
    flex: 1,
  },
  teamOptionTricode: {
    fontSize: ms(12),
    fontWeight: '600',
  },
});
