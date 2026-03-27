import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { ScreenshotPlayerMatch, ScreenshotUnmatched } from '@/hooks/useImportScreenshot';
import { useSearchOrCreatePlayer } from '@/hooks/useImportScreenshot';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface TeamRosterReviewProps {
  teamName: string;
  matched: ScreenshotPlayerMatch[];
  unmatched: ScreenshotUnmatched[];
  resolvedCount: number;
  skippedCount: number;
  onResolve: (index: number, playerId: string, name: string, position: string) => void;
  onSkip: (index: number) => void;
}

export function TeamRosterReview({
  teamName,
  matched,
  unmatched,
  resolvedCount,
  skippedCount,
  onResolve,
  onSkip,
}: TeamRosterReviewProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const totalExtracted = matched.length + unmatched.length + resolvedCount + skippedCount;

  return (
    <View style={styles.container}>
      <ThemedText type="defaultSemiBold" style={styles.teamHeader} accessibilityRole="header">
        {teamName} — {totalExtracted} players extracted
      </ThemedText>

      {/* Unmatched (action needed) */}
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
              key={`unmatched-${p.index}`}
              player={p}
              onResolve={onResolve}
              onSkip={onSkip}
            />
          ))}
        </View>
      )}

      {/* Matched (info only) */}
      {matched.length > 0 && (
        <View>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">
            Matched Players ({matched.length})
          </ThemedText>
          <FlatList
            data={matched}
            scrollEnabled={false}
            keyExtractor={(item) => `matched-${item.index}`}
            renderItem={({ item, index }) => <MatchedRow match={item} isLast={index === matched.length - 1} />}
          />
        </View>
      )}
    </View>
  );
}

function MatchedRow({ match, isLast }: { match: ScreenshotPlayerMatch; isLast: boolean }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const confColor = match.confidence === 'high' ? c.success : c.warning;
  const confIcon = match.confidence === 'high' ? 'checkmark-circle' : 'alert-circle';

  return (
    <View
      style={[styles.row, { borderBottomColor: c.border }, isLast && { borderBottomWidth: 0 }]}
      accessibilityLabel={`${match.extracted_name} matched to ${match.matched_name}, ${match.confidence} confidence`}
    >
      <Ionicons name={confIcon as any} size={18} color={confColor} accessible={false} />
      <View style={styles.rowText}>
        <ThemedText style={styles.playerName} numberOfLines={1}>
          {match.extracted_name}
        </ThemedText>
        <Text style={[styles.matchedTo, { color: c.secondaryText }]}>
          → {match.matched_name} ({match.matched_team})
        </Text>
      </View>
      {match.roster_slot && (
        <Text style={[styles.slotBadge, { color: c.secondaryText }]}>
          {match.roster_slot}
        </Text>
      )}
    </View>
  );
}

const POSITIONS = ['PG', 'SG', 'SF', 'PF', 'C'];

function UnmatchedRow({
  player,
  onResolve,
  onSkip,
}: {
  player: ScreenshotUnmatched;
  onResolve: (index: number, playerId: string, name: string, position: string) => void;
  onSkip: (index: number) => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [searching, setSearching] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [addName, setAddName] = useState('');
  const [addPosition, setAddPosition] = useState<string>(player.position ?? 'PG');
  const [results, setResults] = useState<Array<{ id: string; name: string; nba_team: string; position: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [resolved, setResolved] = useState(false);
  const searchOrCreate = useSearchOrCreatePlayer();

  const handleSearch = useCallback(async (text: string) => {
    setQuery(text);
    if (text.length < 2) {
      setResults([]);
      setHasSearched(false);
      return;
    }
    setLoading(true);
    const { data } = await supabase
      .from('players')
      .select('id, name, nba_team, position')
      .ilike('name', `%${text}%`)
      .limit(10);
    setResults(data ?? []);
    setHasSearched(true);
    setLoading(false);
  }, []);

  const handleAddPlayer = useCallback(async () => {
    if (!addName.trim()) return;
    searchOrCreate.mutate(
      { name: addName.trim(), position: addPosition },
      {
        onSuccess: (result) => {
          if (result.players.length === 1) {
            const p = result.players[0];
            onResolve(player.index, p.id, p.name, p.position ?? addPosition);
            setResolved(true);
          } else if (result.players.length > 1) {
            // Server found existing matches — show them as search results
            setResults(result.players as any);
            setAdding(false);
            setSearching(true);
            setQuery(addName);
            setHasSearched(true);
          }
        },
      },
    );
  }, [addName, addPosition, player.index, onResolve, searchOrCreate]);

  if (resolved) return null;

  return (
    <View style={[styles.unmatchedCard, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.unmatchedHeader}>
        <Ionicons name="alert-circle" size={18} color={c.warning} accessible={false} />
        <ThemedText style={styles.playerName} numberOfLines={1}>
          {player.extracted_name}
        </ThemedText>
        {player.roster_slot && (
          <Text style={[styles.slotBadge, { color: c.secondaryText }]}>
            {player.roster_slot}
          </Text>
        )}
      </View>

      {!searching && !adding ? (
        <View style={styles.unmatchedActions}>
          <TouchableOpacity
            onPress={() => setSearching(true)}
            style={[styles.actionBtn, { backgroundColor: c.accent }]}
            accessibilityRole="button"
            accessibilityLabel={`Search for ${player.extracted_name}`}
          >
            <Text style={[styles.actionBtnText, { color: c.accentText }]}>Search</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              setAddName(player.extracted_name);
              setAdding(true);
            }}
            style={[styles.actionBtn, { borderColor: c.accent, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`Add ${player.extracted_name} as new player`}
          >
            <Text style={[styles.actionBtnText, { color: c.accent }]}>Add Player</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => {
              onSkip(player.index);
              setResolved(true);
            }}
            style={[styles.actionBtn, { borderColor: c.border, borderWidth: 1 }]}
            accessibilityRole="button"
            accessibilityLabel={`Skip ${player.extracted_name}`}
          >
            <Text style={[styles.actionBtnText, { color: c.text }]}>Skip</Text>
          </TouchableOpacity>
        </View>
      ) : adding ? (
        <View style={styles.searchArea}>
          <TextInput
            style={[styles.searchInput, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
            placeholder="Player full name"
            placeholderTextColor={c.secondaryText}
            value={addName}
            onChangeText={setAddName}
            autoFocus
            accessibilityLabel="Player name"
          />
          <View style={styles.positionRow}>
            {POSITIONS.map((pos) => (
              <TouchableOpacity
                key={pos}
                onPress={() => setAddPosition(pos)}
                style={[
                  styles.positionChip,
                  {
                    backgroundColor: addPosition === pos ? c.accent : 'transparent',
                    borderColor: addPosition === pos ? c.accent : c.border,
                  },
                ]}
                accessibilityRole="button"
                accessibilityState={{ selected: addPosition === pos }}
                accessibilityLabel={pos}
              >
                <Text
                  style={[
                    styles.positionChipText,
                    { color: addPosition === pos ? c.accentText : c.text },
                  ]}
                >
                  {pos}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <View style={styles.addActions}>
            <TouchableOpacity
              onPress={handleAddPlayer}
              disabled={!addName.trim() || searchOrCreate.isPending}
              style={[styles.actionBtn, { backgroundColor: c.accent, opacity: !addName.trim() || searchOrCreate.isPending ? 0.5 : 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Create player"
            >
              {searchOrCreate.isPending ? (
                <ActivityIndicator size="small" color={c.accentText} />
              ) : (
                <Text style={[styles.actionBtnText, { color: c.accentText }]}>Create Player</Text>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setAdding(false)}
              style={styles.cancelSearch}
              accessibilityRole="button"
              accessibilityLabel="Cancel"
            >
              <Text style={[styles.cancelText, { color: c.accent }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
          {searchOrCreate.isError && (
            <Text style={[styles.errorText, { color: c.danger }]}>{searchOrCreate.error.message}</Text>
          )}
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
          {loading && <ActivityIndicator size="small" style={styles.searchLoading} />}
          {results.map((r, idx) => (
            <TouchableOpacity
              key={r.id}
              style={[styles.searchResult, { borderBottomColor: c.border }, idx === results.length - 1 && { borderBottomWidth: 0 }]}
              onPress={() => {
                onResolve(player.index, r.id, r.name, r.position);
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
          {hasSearched && !loading && results.length === 0 && (
            <TouchableOpacity
              onPress={() => {
                setAddName(query || player.extracted_name);
                setSearching(false);
                setAdding(true);
              }}
              style={[styles.addPlayerBtn, { borderColor: c.accent }]}
              accessibilityRole="button"
              accessibilityLabel="Player not found, add new player"
            >
              <Ionicons name="person-add-outline" size={16} color={c.accent} accessible={false} />
              <Text style={[styles.addPlayerBtnText, { color: c.accent }]}>
                Not found? Add player
              </Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => {
              setSearching(false);
              setQuery('');
              setResults([]);
              setHasSearched(false);
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
    gap: 16,
  },
  teamHeader: {
    fontSize: 16,
  },
  sectionTitle: {
    fontSize: 15,
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 13,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  playerName: {
    fontSize: 14,
    fontWeight: '500',
    flexShrink: 1,
  },
  matchedTo: {
    fontSize: 13,
    flexShrink: 1,
  },
  slotBadge: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  unmatchedCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginBottom: 8,
  },
  unmatchedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  unmatchedActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 6,
  },
  actionBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  searchArea: {
    marginTop: 10,
  },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  searchLoading: {
    marginTop: 8,
  },
  searchResult: {
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '500',
  },
  resultTeam: {
    fontSize: 12,
    marginTop: 2,
  },
  cancelSearch: {
    paddingVertical: 10,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 14,
    fontWeight: '500',
  },
  positionRow: {
    flexDirection: 'row',
    gap: 6,
    marginTop: 10,
  },
  positionChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    borderWidth: 1,
  },
  positionChipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  addActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
  addPlayerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderRadius: 8,
    marginTop: 8,
  },
  addPlayerBtnText: {
    fontSize: 14,
    fontWeight: '500',
  },
  errorText: {
    fontSize: 13,
    marginTop: 8,
  },
});
