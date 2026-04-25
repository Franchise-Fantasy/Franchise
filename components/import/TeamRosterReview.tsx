import { Badge } from '@/components/ui/Badge';
import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { Section } from '@/components/ui/Section';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import type { ScreenshotPlayerMatch, ScreenshotUnmatched } from '@/hooks/useImportScreenshot';
import { useSearchOrCreatePlayer } from '@/hooks/useImportScreenshot';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useCallback, useState } from 'react';
import {
  FlatList,
  StyleSheet,
  Text,
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
      {unmatched.length > 0 && (
        <Section title={`Unmatched Players (${unmatched.length})`}>
          <ThemedText style={[styles.sectionDesc, { color: c.secondaryText }]}>
            Search for each player, add as new, or skip them.
          </ThemedText>
          <View style={styles.unmatchedList}>
            {unmatched.map((p) => (
              <UnmatchedRow
                key={`unmatched-${p.index}`}
                player={p}
                onResolve={onResolve}
                onSkip={onSkip}
              />
            ))}
          </View>
        </Section>
      )}

      {matched.length > 0 && (
        <Section
          title={`Matched (${matched.length} of ${totalExtracted})`}
          cardStyle={styles.matchedCard}
        >
          <FlatList
            data={matched}
            scrollEnabled={false}
            keyExtractor={(item) => `matched-${item.index}`}
            renderItem={({ item, index }) => (
              <MatchedRow match={item} isLast={index === matched.length - 1} />
            )}
          />
        </Section>
      )}
    </View>
  );
}

// ─── Matched player row ─────────────────────────────────────────────

function MatchedRow({ match, isLast }: { match: ScreenshotPlayerMatch; isLast: boolean }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const isHigh = match.confidence === 'high';

  return (
    <View
      style={[
        styles.matchedRow,
        { borderBottomColor: c.border },
        isLast && { borderBottomWidth: 0 },
      ]}
      accessibilityLabel={`${match.extracted_name} matched to ${match.matched_name}, ${match.confidence} confidence`}
    >
      <Ionicons
        name={isHigh ? 'checkmark-circle' : 'alert-circle'}
        size={ms(16)}
        color={isHigh ? c.success : c.warning}
        accessible={false}
      />
      <View style={styles.matchedBody}>
        <ThemedText style={[styles.playerName, { color: c.text }]} numberOfLines={1}>
          {match.extracted_name}
        </ThemedText>
        <ThemedText
          style={[styles.matchedTo, { color: c.secondaryText }]}
          numberOfLines={1}
        >
          → {match.matched_name} ({match.matched_team})
        </ThemedText>
      </View>
      {match.roster_slot && (
        <Badge label={match.roster_slot} variant="neutral" size="small" />
      )}
    </View>
  );
}

// ─── Unmatched player row (search / add / skip) ────────────────────

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
  const [mode, setMode] = useState<'idle' | 'search' | 'add'>('idle');
  const [query, setQuery] = useState('');
  const [addName, setAddName] = useState('');
  const [addPosition, setAddPosition] = useState<string>(player.position ?? 'PG');
  const [results, setResults] = useState<
    Array<{ id: string; name: string; pro_team: string | null; position: string | null }>
  >([]);
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
      .select('id, name, pro_team, position')
      .ilike('name', `%${text}%`)
      .limit(10);
    setResults(data ?? []);
    setHasSearched(true);
    setLoading(false);
  }, []);

  const handleAddPlayer = useCallback(() => {
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
            // Server found existing matches — surface them as search results
            setResults(result.players as any);
            setMode('search');
            setQuery(addName);
            setHasSearched(true);
          }
        },
      },
    );
  }, [addName, addPosition, player.index, onResolve, searchOrCreate]);

  if (resolved) return null;

  return (
    <View style={[styles.unmatchedCard, { backgroundColor: c.input, borderColor: c.border }]}>
      <View style={styles.unmatchedHeader}>
        <Ionicons name="alert-circle-outline" size={ms(16)} color={c.warning} accessible={false} />
        <ThemedText style={[styles.playerName, { color: c.text }]} numberOfLines={1}>
          {player.extracted_name}
        </ThemedText>
        {player.roster_slot && <Badge label={player.roster_slot} variant="neutral" size="small" />}
      </View>

      {mode === 'idle' && (
        <View style={styles.unmatchedActions}>
          <BrandButton
            label="Search"
            variant="primary"
            size="small"
            onPress={() => setMode('search')}
            accessibilityLabel={`Search for ${player.extracted_name}`}
          />
          <BrandButton
            label="Add Player"
            variant="secondary"
            size="small"
            onPress={() => {
              setAddName(player.extracted_name);
              setMode('add');
            }}
            accessibilityLabel={`Add ${player.extracted_name} as new player`}
          />
          <BrandButton
            label="Skip"
            variant="ghost"
            size="small"
            onPress={() => {
              onSkip(player.index);
              setResolved(true);
            }}
            accessibilityLabel={`Skip ${player.extracted_name}`}
          />
        </View>
      )}

      {mode === 'add' && (
        <View style={styles.searchArea}>
          <BrandTextInput
            placeholder="Player full name"
            value={addName}
            onChangeText={setAddName}
            autoFocus
            accessibilityLabel="Player name"
          />
          <SegmentedControl
            options={POSITIONS}
            selectedIndex={POSITIONS.indexOf(addPosition)}
            onSelect={(i) => setAddPosition(POSITIONS[i])}
            accessibilityLabel="Player position"
          />
          <View style={styles.addActionsRow}>
            <BrandButton
              label="Create Player"
              variant="primary"
              size="small"
              onPress={handleAddPlayer}
              disabled={!addName.trim()}
              loading={searchOrCreate.isPending}
              accessibilityLabel="Create player"
            />
            <BrandButton
              label="Cancel"
              variant="ghost"
              size="small"
              onPress={() => setMode('idle')}
            />
          </View>
          {searchOrCreate.isError && (
            <Text style={[styles.errorText, { color: c.danger }]}>
              {searchOrCreate.error.message}
            </Text>
          )}
        </View>
      )}

      {mode === 'search' && (
        <View style={styles.searchArea}>
          <BrandTextInput
            placeholder="Search player name…"
            value={query}
            onChangeText={handleSearch}
            autoFocus
            accessibilityLabel="Search for player"
          />
          {loading && (
            <View style={styles.searchLoading}>
              <LogoSpinner size={18} />
            </View>
          )}
          {results.length > 0 && (
            <View style={styles.resultsList}>
              {results.map((r, idx) => (
                <TouchableOpacity
                  key={r.id}
                  style={[
                    styles.searchResult,
                    { borderBottomColor: c.border },
                    idx === results.length - 1 && { borderBottomWidth: 0 },
                  ]}
                  onPress={() => {
                    onResolve(player.index, r.id, r.name, r.position ?? '');
                    setResolved(true);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Select ${r.name}, ${r.pro_team ?? ''}`}
                >
                  <ThemedText style={[styles.resultName, { color: c.text }]}>
                    {r.name}
                  </ThemedText>
                  <Text style={[styles.resultMeta, { color: c.secondaryText }]}>
                    {[r.pro_team, r.position].filter(Boolean).join(' · ')}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {hasSearched && !loading && results.length === 0 && (
            <View style={styles.notFoundWrap}>
              <ThemedText style={[styles.notFoundText, { color: c.secondaryText }]}>
                No matches found.
              </ThemedText>
              <BrandButton
                label="Add as new player"
                variant="secondary"
                size="small"
                icon="person-add-outline"
                onPress={() => {
                  setAddName(query || player.extracted_name);
                  setMode('add');
                }}
                accessibilityLabel="Add as new player"
              />
            </View>
          )}
          <View style={styles.cancelRow}>
            <BrandButton
              label="Cancel"
              variant="ghost"
              size="small"
              onPress={() => {
                setMode('idle');
                setQuery('');
                setResults([]);
                setHasSearched(false);
              }}
              accessibilityLabel="Cancel search"
            />
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: s(16),
  },
  sectionDesc: {
    fontSize: ms(12),
    lineHeight: ms(17),
    marginBottom: s(4),
  },

  // ─── Unmatched ─────────────────────────────────────────────
  unmatchedList: {
    gap: s(8),
  },
  unmatchedCard: {
    borderRadius: 10,
    borderWidth: 1,
    padding: s(12),
    gap: s(10),
  },
  unmatchedHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  unmatchedActions: {
    flexDirection: 'row',
    gap: s(8),
    flexWrap: 'wrap',
  },
  searchArea: {
    gap: s(8),
  },
  searchLoading: {
    alignItems: 'center',
    paddingVertical: s(4),
  },
  resultsList: {
    borderRadius: 8,
  },
  searchResult: {
    paddingVertical: s(10),
    paddingHorizontal: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  resultName: {
    fontSize: ms(14),
    fontWeight: '500',
  },
  resultMeta: {
    fontSize: ms(12),
    marginTop: s(2),
  },
  notFoundWrap: {
    alignItems: 'center',
    gap: s(6),
    paddingVertical: s(6),
  },
  notFoundText: {
    fontSize: ms(12),
    fontStyle: 'italic',
  },
  cancelRow: {
    alignItems: 'center',
  },
  addActionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    flexWrap: 'wrap',
  },
  errorText: {
    fontSize: ms(12),
  },

  // ─── Matched ───────────────────────────────────────────────
  matchedCard: {
    paddingHorizontal: 0,
  },
  matchedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(9),
    paddingHorizontal: s(14),
    gap: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  matchedBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    minWidth: 0,
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
});
