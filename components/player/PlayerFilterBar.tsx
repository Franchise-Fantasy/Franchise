import { Colors } from '@/constants/Colors';
import { POSITIONS, SortKey } from '@/hooks/usePlayerFilter';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ScrollView, StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '@/components/ThemedText';

const SORT_OPTIONS: SortKey[] = ['FPTS', 'PPG', 'RPG', 'APG', 'SPG', 'BPG', 'MPG'];

interface PlayerFilterBarProps {
  searchText: string;
  onSearchChange: (text: string) => void;
  selectedPosition: string;
  onPositionChange: (pos: string) => void;
  sortBy: string;
  onSortChange: (sort: string) => void;
}

export function PlayerFilterBar({
  searchText,
  onSearchChange,
  selectedPosition,
  onPositionChange,
  sortBy,
  onSortChange,
}: PlayerFilterBarProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={[styles.container, { backgroundColor: c.card, borderBottomColor: c.border }]}>
      <TextInput
        style={[styles.searchInput, { backgroundColor: c.input, color: c.text, borderColor: c.border }]}
        placeholder="Search players..."
        placeholderTextColor={c.secondaryText}
        value={searchText}
        onChangeText={onSearchChange}
        autoCorrect={false}
        returnKeyType="search"
      />
      <View style={styles.row}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.positionScroll}
        >
          {POSITIONS.map(pos => {
            const active = selectedPosition === pos;
            return (
              <TouchableOpacity
                key={pos}
                style={[
                  styles.chip,
                  { borderColor: c.border },
                  active && { backgroundColor: c.activeCard, borderColor: c.activeBorder },
                ]}
                onPress={() => onPositionChange(pos)}
              >
                <ThemedText
                  style={[
                    styles.chipText,
                    { color: c.secondaryText },
                    active && { color: c.activeText, fontWeight: '600' },
                  ]}
                >
                  {pos}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipRow}
          style={styles.sortScroll}
        >
          {SORT_OPTIONS.map(opt => {
            const active = sortBy === opt;
            return (
              <TouchableOpacity
                key={opt}
                style={[
                  styles.chip,
                  { borderColor: c.border },
                  active && { backgroundColor: c.activeCard, borderColor: c.activeBorder },
                ]}
                onPress={() => onSortChange(opt)}
              >
                <ThemedText
                  style={[
                    styles.chipText,
                    { color: c.secondaryText },
                    active && { color: c.activeText, fontWeight: '600' },
                  ]}
                >
                  {opt}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  searchInput: {
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    fontSize: 14,
    marginBottom: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 8,
  },
  positionScroll: {
    flexShrink: 0,
  },
  sortScroll: {
    flexShrink: 1,
  },
  chipRow: {
    gap: 4,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 14,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 12,
  },
});
