import { Badge } from '@/components/ui/Badge';
import { BrandButton } from '@/components/ui/BrandButton';
import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { Section } from '@/components/ui/Section';
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
      {/* Unmatched players — each row expands inline with its own
          BrandTextInput search + results when the user taps Search. */}
      {unmatched.length > 0 && (
        <Section title={`Unmatched Players (${unmatched.length})`}>
          <ThemedText style={[styles.sectionDesc, { color: c.secondaryText }]}>
            Search for each player or skip them.
          </ThemedText>
          <View style={styles.unmatchedList}>
            {unmatched.map((p) => (
              <UnmatchedRow
                key={p.sleeper_id}
                player={p}
                onResolve={onResolve}
                onSkip={onSkip}
              />
            ))}
          </View>
        </Section>
      )}

      {/* Matched players — read-only summary with a confidence Badge
          per row. Green = high confidence, warning = name matched but
          team differs (e.g. recent trade). */}
      <Section title={`Matched Players (${matched.length})`} cardStyle={styles.matchedCard}>
        <ThemedText style={[styles.sectionDesc, styles.matchedDesc, { color: c.secondaryText }]}>
          Green = exact name + team match. Gold = name matched but team differs (e.g. recent trade).
        </ThemedText>
        <FlatList
          data={matched}
          scrollEnabled={false}
          keyExtractor={(item) => item.sleeper_id}
          renderItem={({ item, index }) => (
            <MatchedRow match={item} isLast={index === matched.length - 1} />
          )}
        />
      </Section>
    </View>
  );
}

// ─── Matched player row ─────────────────────────────────────────────

function MatchedRow({ match, isLast }: { match: SleeperPlayerMatch; isLast: boolean }) {
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
      accessibilityLabel={`${match.sleeper_name} matched to ${match.matched_name}, ${match.confidence} confidence`}
    >
      <Ionicons
        name={isHigh ? 'checkmark-circle' : 'alert-circle'}
        size={ms(16)}
        color={isHigh ? c.success : c.warning}
        accessible={false}
      />
      <View style={styles.matchedBody}>
        <ThemedText style={[styles.playerName, { color: c.text }]} numberOfLines={1}>
          {match.sleeper_name}
        </ThemedText>
        <ThemedText
          style={[styles.matchedTo, { color: c.secondaryText }]}
          numberOfLines={1}
        >
          → {match.matched_name}
        </ThemedText>
      </View>
      <Badge
        label={match.confidence}
        variant={isHigh ? 'success' : 'warning'}
        size="small"
      />
    </View>
  );
}

// ─── Unmatched player row (with inline search) ──────────────────────

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
  const [results, setResults] = useState<
    Array<{ id: string; name: string; pro_team: string | null; position: string | null }>
  >([]);
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
      .select('id, name, pro_team, position')
      .ilike('name', `%${text}%`)
      .limit(10);
    setResults(data ?? []);
    setLoading(false);
  }, []);

  if (resolved) return null;

  return (
    <View style={[styles.unmatchedCard, { backgroundColor: c.input, borderColor: c.border }]}>
      <View style={styles.unmatchedHeader}>
        <Ionicons name="alert-circle-outline" size={ms(16)} color={c.warning} accessible={false} />
        <ThemedText style={[styles.playerName, { color: c.text }]} numberOfLines={1}>
          {player.name}
        </ThemedText>
        {player.team && <Badge label={player.team} variant="neutral" size="small" />}
      </View>

      {!searching ? (
        <View style={styles.unmatchedActions}>
          <BrandButton
            label="Search"
            variant="primary"
            size="small"
            onPress={() => setSearching(true)}
            accessibilityLabel={`Search for ${player.name}`}
          />
          <BrandButton
            label="Skip"
            variant="secondary"
            size="small"
            onPress={() => {
              onSkip(player.sleeper_id);
              setResolved(true);
            }}
            accessibilityLabel={`Skip ${player.name}`}
          />
        </View>
      ) : (
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
            <View style={styles.searchResults}>
              {results.map((r, idx) => (
                <TouchableOpacity
                  key={r.id}
                  style={[
                    styles.searchResult,
                    { borderBottomColor: c.border },
                    idx === results.length - 1 && { borderBottomWidth: 0 },
                  ]}
                  onPress={() => {
                    onResolve(
                      player.sleeper_id,
                      r.id,
                      r.name,
                      r.position ?? '',
                    );
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
          <View style={styles.cancelWrap}>
            <BrandButton
              label="Cancel"
              variant="ghost"
              size="small"
              onPress={() => {
                setSearching(false);
                setQuery('');
                setResults([]);
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

  // ─── Unmatched list ───────────────────────────────────────
  unmatchedList: {
    gap: s(8),
  },
  // The unmatched "row" is a mini-card that expands on Search. Using
  // c.input as surface so it reads as a "field-like" interactive
  // element nested inside the parent Section's card.
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
  },
  searchArea: {
    gap: s(8),
  },
  searchLoading: {
    alignItems: 'center',
    paddingVertical: s(4),
  },
  searchResults: {
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
  cancelWrap: {
    alignItems: 'center',
  },

  // ─── Matched list ─────────────────────────────────────────
  // Drop horizontal card padding so rows + their hairline dividers
  // span the card edge-to-edge.
  matchedCard: {
    paddingHorizontal: 0,
  },
  // The description for the matched section lives inside a horizontal-
  // padding-zero card, so re-add its own inset.
  matchedDesc: {
    paddingHorizontal: s(14),
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
