import { useQuery } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NewsCard } from '@/components/player/NewsCard';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { useTeamNews } from '@/hooks/useTeamNews';
import { supabase } from '@/lib/supabase';
import type { PlayerNewsArticle } from '@/types/news';
import { ms, s } from '@/utils/scale';

type FilterMode = 'team' | 'matchup' | 'all';

const FILTERS: { key: FilterMode; label: string }[] = [
  { key: 'team', label: 'My Team' },
  { key: 'matchup', label: 'Matchup' },
  { key: 'all', label: 'All Players' },
];

const FILTER_LABELS = FILTERS.map((f) => f.label);

const EMPTY_MESSAGES: Record<FilterMode, { title: string; sub: string }> = {
  team: { title: 'Quiet on your bench.', sub: 'NO ROSTER NEWS · CHECK BACK SOON' },
  matchup: { title: 'Quiet matchup.', sub: 'NO RECENT NEWS · BOTH SIDES' },
  all: { title: 'No news yet.', sub: 'CHECK BACK SOON' },
};

export default function NewsScreen() {
  const c = useColors();
  const { leagueId, teamId } = useAppState();
  const [filterIndex, setFilterIndex] = useState(0);
  const filter = FILTERS[filterIndex].key;
  const [searchText, setSearchText] = useState('');

  const { data: myPlayerIds = [] } = useQuery<string[]>({
    queryKey: queryKeys.newsRosterIds(leagueId!, teamId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId!)
        .eq('team_id', teamId!);
      if (error) throw error;
      return (data ?? []).map((r: any) => r.player_id);
    },
    enabled: !!leagueId && !!teamId,
    staleTime: 1000 * 60 * 5,
  });

  const { data: matchupPlayerIds = [] } = useQuery<string[]>({
    queryKey: queryKeys.newsMatchupIds(leagueId!, teamId!),
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);

      const { data: weeks } = await supabase
        .from('league_schedule')
        .select('id')
        .eq('league_id', leagueId!)
        .lte('start_date', today)
        .gte('end_date', today)
        .limit(1)
        .single();

      if (!weeks) return myPlayerIds;

      const { data: matchup } = await supabase
        .from('league_matchups')
        .select('home_team_id, away_team_id')
        .eq('schedule_id', weeks.id)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .maybeSingle();

      if (!matchup) return myPlayerIds;

      const opponentId =
        matchup.home_team_id === teamId
          ? matchup.away_team_id
          : matchup.home_team_id;

      const teamIds = opponentId ? [teamId!, opponentId] : [teamId!];

      const { data: players } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId!)
        .in('team_id', teamIds);

      return (players ?? []).map((r: any) => r.player_id);
    },
    enabled: !!leagueId && !!teamId && filter === 'matchup',
    staleTime: 1000 * 60 * 5,
  });

  const activePlayerIds = useMemo(() => {
    if (filter === 'team') return myPlayerIds;
    if (filter === 'matchup') return matchupPlayerIds;
    return [];
  }, [filter, myPlayerIds, matchupPlayerIds]);

  const { data: league } = useLeague();
  const newsMode = filter === 'all' ? ('all' as const) : ('filtered' as const);
  const newsQuery = useTeamNews(
    activePlayerIds,
    newsMode,
    league?.sport as 'nba' | 'wnba' | undefined,
  );

  const filteredNews = useMemo(() => {
    const articles = newsQuery.data ?? [];
    if (!searchText.trim()) return articles;
    const q = searchText.trim().toLowerCase();
    return articles.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.mentioned_players?.some((p) => p.name.toLowerCase().includes(q)),
    );
  }, [newsQuery.data, searchText]);

  const renderNews = useCallback(
    ({ item }: { item: PlayerNewsArticle }) => (
      <NewsCard article={item} showHeadshots />
    ),
    [],
  );
  const keyExtractor = useCallback((item: PlayerNewsArticle) => item.id, []);
  const handleRefresh = useCallback(() => {
    newsQuery.refetch();
  }, [newsQuery]);

  const empty = EMPTY_MESSAGES[filter];

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Player News" />

      <View style={styles.controls}>
        <BrandTextInput
          placeholder="Search player or team news..."
          value={searchText}
          onChangeText={setSearchText}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          accessibilityLabel="Search news"
        />
        <View style={styles.segmentWrap}>
          <SegmentedControl
            options={FILTER_LABELS}
            selectedIndex={filterIndex}
            onSelect={setFilterIndex}
            accessibilityLabel="Filter news"
          />
        </View>
      </View>

      {newsQuery.isLoading ? (
        <View style={styles.loader}>
          <LogoSpinner />
        </View>
      ) : (
        <FlatList
          data={filteredNews}
          keyExtractor={keyExtractor}
          renderItem={renderNews}
          ItemSeparatorComponent={ItemGap}
          refreshControl={
            <RefreshControl
              refreshing={newsQuery.isRefetching}
              onRefresh={handleRefresh}
              tintColor={c.accent}
            />
          }
          contentContainerStyle={styles.list}
          removeClippedSubviews
          initialNumToRender={8}
          maxToRenderPerBatch={6}
          windowSize={7}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="display"
                style={[styles.emptyTitle, { color: c.text }]}
              >
                {empty.title}
              </ThemedText>
              <ThemedText
                type="varsitySmall"
                style={[styles.emptySub, { color: c.secondaryText }]}
              >
                {empty.sub}
              </ThemedText>
            </View>
          }
        />
      )}
    </SafeAreaView>
  );
}

function ItemGap() {
  return <View style={styles.itemGap} />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  controls: {
    paddingHorizontal: s(16),
    paddingTop: s(10),
    paddingBottom: s(12),
    gap: s(10),
  },
  segmentWrap: {
    // SegmentedControl already owns its own border, no extra wrapping needed.
  },
  loader: {
    marginTop: s(40),
    alignItems: 'center',
  },
  list: {
    paddingHorizontal: s(16),
    paddingBottom: s(24),
    flexGrow: 1,
  },
  itemGap: {
    height: s(10),
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(10),
    paddingHorizontal: s(32),
    paddingTop: s(60),
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
});
