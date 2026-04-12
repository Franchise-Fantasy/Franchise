import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { SleeperPlayerMatch, SleeperUnmatched } from '@/hooks/useImportSleeper';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import { ms, s } from '@/utils/scale';
import {
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface PlayerMatchListProps {
  matched: SleeperPlayerMatch[];
  unmatched: SleeperUnmatched[];
  onResolve: (sleeperId: string, playerId: string, playerName: string, position: string) => void;
  onSkip: (sleeperId: string) => void;
}

export function PlayerMatchList({
  matched,
  unmatched,
  onResolve,
  onSkip,
}: PlayerMatchListProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      {/* Unmatched players (action needed) */}
      {unmatched.length > 0 && (
        <View>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Unmatched Players ({unmatched.length})
          </ThemedText>
          <ThemedText style={[styles.sectionDesc, { color: c.secondaryText }]}>
            Search for each player or skip them.
          </ThemedText>
          {unmatched.map((p) => (
            <UnmatchedRow
              key={p.sleeper_id}
              player={p}
              onResolve={onResolve}
              onSkip={onSkip}
            />
          ))}
        </View>
      )}

      {/* Matched players (info only) */}
      <View>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
          Matched Players ({matched.length})
        </ThemedText>
        <ThemedText style={[styles.sectionDesc, { color: c.secondaryText }]}>
          Green = exact name and team match. Orange = name matched but team differs (e.g. recent trade).
        </ThemedText>
        <FlatList
          data={matched}
          scrollEnabled={false}
          keyExtractor={(item) => item.sleeper_id}
          renderItem={({ item, index }) => (
            <MatchedRow match={item} isLast={index === matched.length - 1} />
          )}
        />
      </View>
    </View>
  );
}

// --- Matched player row ---

function MatchedRow({ match, isLast }: { match: SleeperPlayerMatch; isLast: boolean }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const confColor = match.confidence === 'high' ? c.success : c.warning;
  const confIcon = match.confidence === 'high' ? 'checkmark-circle' : 'alert-circle';

  return (
    <View
      style={[styles.row, { borderBottomColor: c.border }, isLast && { borderBottomWidth: 0 }]}
      accessibilityLabel={`${match.sleeper_name} matched to ${match.matched_name}, ${match.confidence} confidence`}
    >
      <Ionicons name={confIcon as any} size={18} color={confColor} accessible={false} />
      <View style={styles.rowText}>
        <ThemedText style={styles.playerName} numberOfLines={1}>
          {match.sleeper_name}
        </ThemedText>
        <Text style={[styles.matchedTo, { color: c.secondaryText }]}>
          → {match.matched_name}
        </Text>
      </View>
      <Text style={[styles.confBadge, { color: confColor }]}>
        {match.confidence}
      </Text>
    </View>
  );
}

// --- Unmatched player row with search ---

function UnmatchedRow({
  player,
  onResolve,
  onSkip,
}: {
  player: SleeperUnmatched;
  onResolve: (sleeperId: string, playerId: string, playerName: string, position: string) => void;
  onSkip: (sleeperId: string) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ id: string; name: string; nba_team: string; position: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [resolved, setResolved] = useState(false);

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    if (text.length < 2) {
      setResults([]);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('players')
      .select('id, name, nba_team, position')
      .ilike('name', `%${text}%`)
      .limit(10);
    setResults(data ?? []);
    setLoading(false);
  }, []);

  if (resolved) return null;

  return (
    <View style={[styles.unmatchedCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.unmatchedHeader}>
        <Ionicons name="alert-circle" size={18} color={c.warning} accessible={false} />
        <ThemedText style={styles.playerName} numberOfLines={1}>
          {player.name}
        </ThemedText>
        {player.team && (
          <Text style={[styles.teamBadge, { color: c.secondaryText }]}>
            {player.team}
          </Text>
        )}
      </View>

      {!searching ? (
        <View style={styles.unmatchedActions}>
          <TouchableOpacity
            onPress={() => setSearching(true)}
            style={[styles.actionBtn, { backgroundColor: c.accent }]}
            accessibilityRole="button"
            accessibilityLabel={`Search for ${player.name}`}
          >
            <Text style={[styles.actionBtnText, { color: c.accentText }]}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              onSkip(player.sleeper_id);
              setResolved(true);
            }}
            style={[styles.actionBtn, { borderColor: c.border, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`Skip ${player.name}`}
          >
            <Text style={[styles.actionBtnText, { color: c.text }]}>Skip</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.searchArea}>
          <TextInput
            style={[styles.searchInput, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            placeholder="Search player name..."
            placeholderTextColor={c.secondaryText}
            value={query}
            onChangeText={handleSearch}
            autoFocus
            accessibilityLabel="Search for player"
          />
          {loading && <View style={styles.searchLoading}><LogoSpinner size={18} /></View>}
          {results.map((r, idx) => (
            <TouchableOpacity
              key={r.id}
              style={[styles.searchResult, { borderBottomColor: c.border }, idx === results.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => {
                onResolve(player.sleeper_id, r.id, r.name, r.position);
                setResolved(true);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Select ${r.name}, ${r.nba_team}`}
            >
              <ThemedText style={styles.resultName}>{r.name}</ThemedText>
              <Text style={[styles.resultTeam, { color: c.secondaryText }]}>
                {r.nba_team} · {r.position}
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            onPress={() => {
              setSearching(false);
              setQuery('');
              setResults([]);
            }}
            style={styles.cancelSearch}
            accessibilityRole="button"
            accessibilityLabel="Cancel search"
          >
            <Text style={[styles.cancelText, { color: c.accent }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: s(20),
  },
  sectionTitle: {
    fontSize: ms(16),
    marginBottom: s(4),
  },
  sectionDesc: {
    fontSize: ms(13),
    marginBottom: s(12),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    gap: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  playerName: {
    fontSize: ms(14),
    fontWeight: '500',
    flexShrink: 1,
  },
  matchedTo: {
    fontSize: ms(13),
    flexShrink: 1,
  },
  confBadge: {
    fontSize: ms(12),
    fontWeight: '600',
    textTransform: 'capitalize',
  },
  unmatchedCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: s(12),
    marginBottom: s(8),
  },
  unmatchedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  teamBadge: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  unmatchedActions: {
    flexDirection: 'row',
    gap: s(8),
    marginTop: s(10),
  },
  actionBtn: {
    paddingVertical: s(8),
    paddingHorizontal: s(16),
    borderRadius: 6,
  },
  actionBtnText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  searchArea: {
    marginTop: s(10),
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    fontSize: ms(14),
  },
  searchLoading: {
    marginTop: s(8),
  },
  searchResult: {
    paddingVertical: s(10),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultName: {
    fontSize: ms(14),
    fontWeight: '500',
  },
  resultTeam: {
    fontSize: ms(12),
    marginTop: s(2),
  },
  cancelSearch: {
    paddingVertical: s(10),
    alignItems: 'center',
  },
  cancelText: {
    fontSize: ms(14),
    fontWeight: '500',
  },
});
