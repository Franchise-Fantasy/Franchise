import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { CompareColumn } from '@/components/player/CompareColumn';
import { SectionEyebrow } from '@/components/roster/SectionEyebrow';
import { ThemedText } from '@/components/ui/ThemedText';
import { type Sport } from '@/constants/LeagueDefaults';
import type { CompareCandidate } from '@/context/CompareSelectionProvider';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';
import type { CompareGroup, CompareRow } from '@/utils/scoring/compareStats';

const LABEL_W = s(92);
const COL_W = s(116);
// Tall enough to hold portrait + name + position/injury row + the category
// "Wins N" badge without clipping (fonts scale slower than heights on small
// screens, so the bottom badge needs slack).
const HEADER_H = s(144);
const EYEBROW_H = s(40);
const ROW_H = s(36);

interface CompareStatTableProps {
  candidates: CompareCandidate[];
  groups: CompareGroup[];
  sport: Sport;
  /** Category-league 9-cat win tally per column (null for points leagues). */
  winTally: number[] | null;
  onRemove: (playerId: string) => void;
}

type Line =
  | { kind: 'eyebrow'; key: string; label: string }
  | { kind: 'row'; key: string; row: CompareRow; stripe: boolean };

function flattenGroups(groups: CompareGroup[]): Line[] {
  const lines: Line[] = [];
  let rowIdx = 0;
  for (const g of groups) {
    lines.push({ kind: 'eyebrow', key: `eyebrow:${g.key}`, label: g.label });
    for (const row of g.rows) {
      lines.push({ kind: 'row', key: `${g.key}:${row.key}`, row, stripe: rowIdx % 2 === 1 });
      rowIdx += 1;
    }
  }
  return lines;
}

/**
 * Side-by-side comparison matrix: a frozen left rail of stat labels plus a
 * horizontally-scrolling band of player columns. Both sides render the same
 * flattened line sequence at identical row heights so they stay aligned while
 * the band scrolls. The winning value per row gets a gold-tinted cell.
 */
export function CompareStatTable({
  candidates,
  groups,
  sport,
  winTally,
  onRemove,
}: CompareStatTableProps) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const lines = flattenGroups(groups);

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{ paddingBottom: insets.bottom + s(16) }}
    >
      <View style={styles.tableRow}>
        {/* Frozen label rail */}
        <View style={{ width: LABEL_W }}>
          <View style={[styles.railHeader, { height: HEADER_H, borderBottomColor: c.border }]}>
            <ThemedText type="varsitySmall" style={[styles.railHeaderText, { color: c.secondaryText }]}>
              Stat
            </ThemedText>
          </View>
          {lines.map((line) =>
            line.kind === 'eyebrow' ? (
              <View key={line.key} style={[styles.railEyebrow, { height: EYEBROW_H }]}>
                <SectionEyebrow label={line.label} />
              </View>
            ) : (
              <View
                key={line.key}
                style={[
                  styles.railLabel,
                  { height: ROW_H },
                  line.stripe && { backgroundColor: c.cardAlt },
                ]}
              >
                <ThemedText style={[styles.railLabelText, { color: c.secondaryText }]} numberOfLines={1}>
                  {line.row.label}
                </ThemedText>
              </View>
            ),
          )}
        </View>

        {/* Scrollable player columns */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.band}>
          <View>
            <View style={[styles.headerRow, { height: HEADER_H, borderBottomColor: c.border }]}>
              {candidates.map((cand, i) => (
                <CompareColumn
                  key={cand.player_id}
                  candidate={cand}
                  sport={sport}
                  width={COL_W}
                  height={HEADER_H}
                  winsLabel={winTally ? `Wins ${winTally[i]}` : null}
                  onRemove={() => onRemove(cand.player_id)}
                />
              ))}
            </View>

            {lines.map((line) =>
              line.kind === 'eyebrow' ? (
                <View key={line.key} style={{ height: EYEBROW_H }} />
              ) : (
                <View
                  key={line.key}
                  style={[
                    styles.valueRow,
                    { height: ROW_H },
                    line.stripe && { backgroundColor: c.cardAlt },
                  ]}
                >
                  {line.row.cells.map((cell, i) => {
                    const best = line.row.best.has(i);
                    return (
                      <View
                        key={candidates[i]?.player_id ?? i}
                        style={[
                          styles.valueCell,
                          { width: COL_W },
                          best && { backgroundColor: c.goldMuted },
                        ]}
                      >
                        <ThemedText
                          type="mono"
                          style={[
                            styles.valueText,
                            { color: cell.value == null ? c.secondaryText : best ? c.gold : c.text },
                          ]}
                          accessibilityLabel={`${line.row.label}, ${candidates[i]?.name ?? ''}, ${cell.display}${best ? ', best' : ''}`}
                        >
                          {cell.display}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>
              ),
            )}
          </View>
        </ScrollView>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  tableRow: { flexDirection: 'row' },
  band: { flex: 1 },
  railHeader: {
    justifyContent: 'flex-end',
    paddingHorizontal: s(8),
    paddingBottom: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  railHeaderText: { fontSize: ms(10), letterSpacing: 1.2 },
  railEyebrow: { justifyContent: 'flex-end', paddingBottom: s(4) },
  railLabel: { justifyContent: 'center', paddingHorizontal: s(8) },
  railLabelText: { fontSize: ms(12) },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  valueRow: { flexDirection: 'row' },
  valueCell: { justifyContent: 'center', alignItems: 'center' },
  valueText: { fontSize: ms(13) },
});
