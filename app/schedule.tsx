import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter , useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Badge } from '@/components/ui/Badge';
import { ListRow } from '@/components/ui/ListRow';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors, Fonts } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { supabase } from '@/lib/supabase';
import { toDateStr, parseLocalDate } from '@/utils/dates';
import { calcRounds, getPlayoffRoundLabel } from '@/utils/league/playoff';
import { ms, s } from '@/utils/scale';
import { formatScore } from '@/utils/scoring/fantasyPoints';




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
  playoff_bracket: { is_third_place: boolean }[] | null;
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
      'id, schedule_id, home_team_id, away_team_id, home_score, away_score, home_category_wins, away_category_wins, category_ties, is_finalized, playoff_round, playoff_bracket(is_third_place)',
    )
    .eq('league_id', leagueId)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`);
  if (error) throw error;
  return data ?? [];
}

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

  const activeTeamId = selectedTeamId ?? teamId;

  const teams = league?.league_teams ?? [];
  const teamMap = useMemo(() => {
    const map: Record<string, { id: string; name: string; tricode: string | null }> = {};
    for (const t of teams) map[t.id] = t;
    return map;
  }, [teams]);

  const selectedTeamName = activeTeamId ? teamMap[activeTeamId]?.name ?? 'Select Team' : 'Select Team';

  const isCategories = league?.scoring_type === 'h2h_categories';
  const isOffseason = !!league?.offseason_step;

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

  // Fallback round numbering for playoff weeks where the viewed team has no
  // matchup (eliminated or never qualified). The Nth playoff week, ordered
  // by week_number, is round N.
  const playoffRoundByWeekId = useMemo(() => {
    const map = new Map<string, number>();
    if (!weeks) return map;
    let round = 0;
    for (const w of weeks) {
      if (w.is_playoff) {
        round += 1;
        map.set(w.id, round);
      }
    }
    return map;
  }, [weeks]);

  const currentWeekIndex = useMemo(() => {
    if (!weeks) return 0;
    const idx = weeks.findIndex(
      (w) => w.start_date <= today && today <= w.end_date,
    );
    if (idx >= 0) return idx;
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

  function getResultLabel(
    matchup: ScheduleMatchup,
    weekState: WeekState,
  ): { text: string; color: string; status: 'win' | 'loss' | 'tie' | 'live' } | null {
    if (weekState === 'future') return null;

    const isHome = matchup.home_team_id === activeTeamId;

    if (isCategories && matchup.is_finalized && matchup.home_category_wins != null) {
      const myW = isHome ? matchup.home_category_wins ?? 0 : matchup.away_category_wins ?? 0;
      const oppW = isHome ? matchup.away_category_wins ?? 0 : matchup.home_category_wins ?? 0;
      const ties = matchup.category_ties ?? 0;
      const score = ties > 0 ? `${myW}-${oppW}-${ties}` : `${myW}-${oppW}`;
      if (myW > oppW) return { text: `W · ${score}`, color: c.success, status: 'win' };
      if (myW < oppW) return { text: `L · ${score}`, color: c.danger, status: 'loss' };
      return { text: `T · ${score}`, color: c.secondaryText, status: 'tie' };
    }

    const myScore = isHome ? matchup.home_score : matchup.away_score;
    const oppScore = isHome ? matchup.away_score : matchup.home_score;

    if (matchup.is_finalized) {
      const scoreStr = `${formatScore(myScore)}-${formatScore(oppScore)}`;
      if (myScore > oppScore) return { text: `W · ${scoreStr}`, color: c.success, status: 'win' };
      if (myScore < oppScore) return { text: `L · ${scoreStr}`, color: c.danger, status: 'loss' };
      return { text: `T · ${scoreStr}`, color: c.secondaryText, status: 'tie' };
    }

    if (weekState === 'live') {
      return {
        text: `${formatScore(myScore)}-${formatScore(oppScore)}`,
        color: c.gold,
        status: 'live',
      };
    }

    return null;
  }

  function renderWeekRow({ item: week, index }: { item: Week; index: number }) {
    const matchup = matchupByScheduleId.get(week.id);
    const weekState = getWeekState(week, today);
    const isCurrent = weekState === 'live';
    const isBye = !matchup;

    // Resolve opponent
    let opponentName = '';
    if (matchup) {
      const isHome = matchup.home_team_id === activeTeamId;
      const opponentId = isHome ? matchup.away_team_id : matchup.home_team_id;
      if (!opponentId) {
        opponentName = 'Bye';
      } else {
        opponentName = teamMap[opponentId]?.name ?? 'Unknown';
      }
    }

    const result = matchup ? getResultLabel(matchup, weekState) : null;
    const tappable = !!matchup && !!matchup.away_team_id;

    // Prefer a round label ("Finals", "Semifinals", etc.) for playoff weeks.
    // If this team has no matchup (eliminated/missed playoffs), fall back to the
    // playoff week's ordinal so the label still reads as a round.
    let weekLabel = `Week ${week.week_number}`;
    if (week.is_playoff) {
      const totalRounds = calcRounds(league?.playoff_teams ?? 8);
      const isThirdPlace = matchup?.playoff_bracket?.[0]?.is_third_place ?? false;
      const round = matchup?.playoff_round ?? playoffRoundByWeekId.get(week.id);
      weekLabel = round
        ? getPlayoffRoundLabel(round, totalRounds, isThirdPlace)
        : 'Playoffs';
    }

    return (
      <ListRow
        index={index}
        total={weeks?.length ?? 0}
        isActive={isCurrent}
        onPress={tappable ? () => router.push(`/matchup-detail/${matchup.id}` as never) : undefined}
        accessibilityLabel={
          tappable
            ? `${weekLabel}, vs ${opponentName}${result ? `, ${result.text}` : ', Upcoming'}`
            : undefined
        }
        accessibilityHint={tappable ? 'View matchup details' : undefined}
        style={styles.weekRowOverride}
      >
        {/* Gold left-bar accent for the current week — signals "this is now". */}
        <View
          style={[
            styles.leftBar,
            { backgroundColor: isCurrent ? Brand.vintageGold : 'transparent' },
          ]}
        />

        <View style={styles.rowContent}>
          <View style={styles.weekInfo}>
            <View style={styles.weekLabelRow}>
              <ThemedText
                type="varsitySmall"
                style={[styles.weekNumber, { color: isCurrent ? c.text : c.secondaryText }]}
              >
                {weekLabel}
              </ThemedText>
              {week.is_playoff && <Badge label="Playoff" variant="turf" size="small" />}
              {isCurrent && <Badge label="Live" variant="gold" size="small" />}
            </View>
            <ThemedText type="mono" style={[styles.dateRange, { color: c.secondaryText }]}>
              {formatWeekRange(week.start_date, week.end_date)}
            </ThemedText>
          </View>

          <View style={styles.matchupInfo}>
            {isBye ? (
              <ThemedText type="varsitySmall" style={[styles.byeLabel, { color: c.secondaryText }]}>
                Bye
              </ThemedText>
            ) : (
              <>
                <ThemedText style={[styles.opponentText, { color: c.text }]} numberOfLines={1}>
                  vs {opponentName}
                </ThemedText>
                {result ? (
                  <ThemedText type="mono" style={[styles.resultText, { color: result.color }]}>
                    {result.text}
                  </ThemedText>
                ) : weekState === 'future' ? (
                  <ThemedText type="varsitySmall" style={[styles.upcomingLabel, { color: c.secondaryText }]}>
                    Upcoming
                  </ThemedText>
                ) : null}
              </>
            )}
          </View>

          {tappable && (
            <Ionicons
              name="chevron-forward"
              size={14}
              color={c.secondaryText}
              style={styles.chevron}
            />
          )}
        </View>
      </ListRow>
    );
  }

  // ─── Main render ────────────────────────────────────────────────────────

  const isLoading = weeksLoading || matchupsLoading;

  if (isOffseason) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <PageHeader title="Schedule" />
        <View
          style={styles.offseason}
          accessible
          accessibilityRole="text"
          accessibilityLabel="It's the offseason. The schedule will return next season."
        >
          <View style={[styles.offseasonRule, { backgroundColor: c.gold }]} />
          <Ionicons
            name="sunny-outline"
            size={ms(40)}
            color={c.secondaryText}
            accessible={false}
          />
          <ThemedText
            type="display"
            style={[styles.offseasonTitle, { color: c.text }]}
          >
            Offseason.
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.offseasonSub, { color: c.secondaryText }]}
          >
            SCHEDULE RETURNS NEXT SEASON
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Schedule" />

      <View style={styles.pickerRow}>
        <View style={styles.pickerLeft}>
          <View style={[styles.pickerRule, { backgroundColor: c.gold }]} />
          <ThemedText type="varsitySmall" style={{ color: c.secondaryText }}>
            Viewing
          </ThemedText>
        </View>
        <TouchableOpacity
          style={[styles.pickerPill, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => setPickerVisible(true)}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel={`Viewing schedule for ${selectedTeamName}. Tap to change team.`}
        >
          <ThemedText style={[styles.pickerName, { color: c.text }]} numberOfLines={1}>
            {selectedTeamName}
          </ThemedText>
          <Ionicons name="chevron-down" size={14} color={c.secondaryText} />
        </TouchableOpacity>
      </View>

      {/* Schedule list */}
      {isLoading ? (
        <View style={styles.loader}>
          <LogoSpinner />
        </View>
      ) : !weeks || weeks.length === 0 ? (
        <View style={styles.emptyState}>
          <ThemedText style={{ color: c.secondaryText }}>
            Season schedule not generated yet
          </ThemedText>
        </View>
      ) : (
        // Outer view is just flex + margins; the bordered card surface
        // lives on the FlatList's contentContainer so it hugs the row
        // stack. A short schedule now ends where the rows end instead
        // of stretching a mostly-empty card down to the tab bar.
        <View style={styles.listWrap}>
          <FlatList
            ref={listRef}
            data={weeks}
            keyExtractor={(w) => w.id}
            renderItem={renderWeekRow}
            showsVerticalScrollIndicator={false}
            onLayout={onListLayout}
            contentContainerStyle={[
              styles.listCard,
              { backgroundColor: c.card, borderColor: c.border },
            ]}
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
            }}
          />
        </View>
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
          <View style={[styles.modalSheet, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.modalHeader}>
              <View style={[styles.modalHeaderRule, { backgroundColor: c.gold }]} />
              <ThemedText type="sectionLabel" style={{ color: c.text }}>
                Select Team
              </ThemedText>
            </View>
            <FlatList
              data={teams}
              keyExtractor={(t) => t.id}
              renderItem={({ item: team, index }) => {
                const isSelected = team.id === activeTeamId;
                return (
                  <ListRow
                    index={index}
                    total={teams.length}
                    isActive={isSelected}
                    onPress={() => {
                      setSelectedTeamId(team.id);
                      setPickerVisible(false);
                    }}
                    accessibilityLabel={team.name}
                    style={styles.teamOption}
                  >
                    <ThemedText style={[styles.teamOptionName, { color: c.text }]}>
                      {team.name}
                    </ThemedText>
                    <ThemedText
                      type="mono"
                      style={[styles.teamOptionTricode, { color: c.secondaryText }]}
                    >
                      {team.tricode ?? ''}
                    </ThemedText>
                    {isSelected && (
                      <Ionicons name="checkmark" size={18} color={c.heritageGold} />
                    )}
                  </ListRow>
                );
              }}
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
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(20),
    paddingTop: s(14),
    paddingBottom: s(10),
    gap: s(12),
  },
  pickerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  pickerRule: {
    height: 2,
    width: s(18),
  },
  pickerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(12),
    paddingVertical: s(7),
    borderRadius: 8,
    borderWidth: 1,
    maxWidth: '60%',
  },
  pickerName: {
    fontSize: ms(13),
    fontWeight: '600',
    flexShrink: 1,
  },
  listWrap: {
    flex: 1,
    paddingHorizontal: s(20),
    paddingTop: s(4),
    paddingBottom: s(24),
  },
  listCard: {
    borderWidth: 1,
    borderRadius: 14,
    overflow: 'hidden',
  },
  // Row owns its own padding so the gold leftBar can span the full
  // row height. ListRow's horizontal padding is dropped and shifted
  // onto rowContent.
  weekRowOverride: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    alignItems: 'stretch',
    minHeight: s(64),
  },
  leftBar: {
    width: 3,
  },
  rowContent: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(14),
    paddingVertical: s(12),
  },
  weekInfo: {
    width: s(130),
    marginRight: s(8),
  },
  weekLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  weekNumber: {
    fontSize: ms(11),
  },
  dateRange: {
    fontSize: ms(11),
    marginTop: s(3),
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
    marginTop: s(3),
  },
  upcomingLabel: {
    fontSize: ms(10),
    marginTop: s(3),
  },
  byeLabel: {
    fontSize: ms(11),
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
  offseason: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(32),
    gap: s(10),
  },
  offseasonRule: {
    height: 2,
    width: s(48),
    marginBottom: s(8),
  },
  offseasonTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  offseasonSub: {
    fontSize: ms(11),
    letterSpacing: 1.3,
    textAlign: 'center',
  },
  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: s(24),
  },
  modalSheet: {
    width: '100%',
    maxHeight: '60%',
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: s(14),
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(16),
    paddingBottom: s(10),
  },
  modalHeaderRule: {
    height: 2,
    width: s(18),
  },
  teamOption: {
    paddingHorizontal: s(16),
    paddingVertical: s(14),
    gap: s(10),
  },
  teamOptionName: {
    fontSize: ms(14),
    flex: 1,
  },
  teamOptionTricode: {
    fontSize: ms(11),
  },
});
