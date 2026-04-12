import { NewsCard } from '@/components/player/NewsCard';
import { ms, s } from "@/utils/scale";
import { ThemedText } from '@/components/ui/ThemedText';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useTeamNews } from '@/hooks/useTeamNews';
import { supabase } from '@/lib/supabase';
import type { PlayerNewsArticle } from '@/types/news';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

type FilterMode = 'team' | 'matchup' | 'all';

const FILTERS: { key: FilterMode; label: string }[] = [
  { key: 'team', label: 'My Team' },
  { key: 'matchup', label: 'Matchup' },
  { key: 'all', label: 'All Players' },
];

export default function NewsScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId, teamId } = useAppState();
  const [filter, setFilter] = useState<FilterMode>('team');
  const [searchText, setSearchText] = useState('');

  // Fetch player IDs for user's team
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

  // Fetch opponent player IDs for matchup filter
  const { data: matchupPlayerIds = [] } = useQuery<string[]>({
    queryKey: queryKeys.newsMatchupIds(leagueId!, teamId!),
    queryFn: async () => {
      // Get current date for week lookup
      const today = new Date().toISOString().slice(0, 10);

      // Find current week
      const { data: weeks } = await supabase
        .from('league_schedule')
        .select('id')
        .eq('league_id', leagueId!)
        .lte('start_date', today)
        .gte('end_date', today)
        .limit(1)
        .single();

      if (!weeks) return myPlayerIds;

      // Find matchup
      const { data: matchup } = await supabase
        .from('league_matchups')
        .select('home_team_id, away_team_id')
        .eq('schedule_id', weeks.id)
        .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
        .maybeSingle();

      if (!matchup) return myPlayerIds;

      const opponentId = matchup.home_team_id === teamId
        ? matchup.away_team_id
        : matchup.home_team_id;

      // Fetch both teams' player IDs
      const { data: players } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId!)
        .in('team_id', [teamId!, opponentId]);

      return (players ?? []).map((r: any) => r.player_id);
    },
    enabled: !!leagueId && !!teamId && filter === 'matchup',
    staleTime: 1000 * 60 * 5,
  });

  // Determine which player IDs to use
  const activePlayerIds = useMemo(() => {
    if (filter === 'team') return myPlayerIds;
    if (filter === 'matchup') return matchupPlayerIds;
    return [];
  }, [filter, myPlayerIds, matchupPlayerIds]);

  const newsMode = filter === 'all' ? 'all' as const : 'filtered' as const;
  const newsQuery = useTeamNews(activePlayerIds, newsMode);

  // Client-side text search across article titles and mentioned player names
  const filteredNews = useMemo(() => {
    const articles = newsQuery.data ?? [];
    if (!searchText.trim()) return articles;
    const q = searchText.trim().toLowerCase();
    return articles.filter(a =>
      a.title.toLowerCase().includes(q) ||
      a.mentioned_players?.some(p => p.name.toLowerCase().includes(q)),
    );
  }, [newsQuery.data, searchText]);

  const emptyMessages: Record<FilterMode, string> = {
    team: 'No recent news for your rostered players',
    matchup: 'No recent news for matchup players',
    all: 'No recent news available',
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Player News" />

      {/* Search bar */}
      <View style={[styles.searchRow, { borderColor: c.border }]}>
        <TextInput
          style={[styles.searchInput, { color: c.text, borderColor: c.border, backgroundColor: c.card }]}
          placeholder="Search player or team news..."
          placeholderTextColor={c.secondaryText}
          value={searchText}
          onChangeText={setSearchText}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
          accessibilityLabel="Search news"
        />
      </View>

      {/* Filter chips */}
      <View style={styles.filterRow}>
        {FILTERS.map(({ key, label }) => {
          const active = filter === key;
          return (
            <TouchableOpacity
              key={key}
              onPress={() => setFilter(key)}
              style={[styles.chip, { borderColor: c.border }, active && { backgroundColor: c.accent }]}
              accessibilityRole="button"
              accessibilityLabel={`Filter: ${label}`}
              accessibilityState={{ selected: active }}
            >
              <ThemedText style={[styles.chipText, active && { color: c.statusText }]}>
                {label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* News list */}
      {newsQuery.isLoading ? (
        <View style={styles.loader}><LogoSpinner /></View>
      ) : (
        <FlatList
          data={filteredNews}
          keyExtractor={(item: PlayerNewsArticle) => item.id}
          renderItem={({ item }) => <NewsCard article={item} showHeadshots />}
          refreshControl={
            <RefreshControl
              refreshing={newsQuery.isRefetching}
              onRefresh={() => newsQuery.refetch()}
              tintColor={c.accent}
            />
          }
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
              {emptyMessages[filter]}
            </ThemedText>
          }
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchRow: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  searchInput: {
    fontSize: ms(14),
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1,
  },
  chipText: { fontSize: ms(13) },
  loader: { marginTop: 40 },
  list: { padding: 16, gap: 12 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: ms(14), opacity: 0.6 },
});
