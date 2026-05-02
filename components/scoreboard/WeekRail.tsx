import { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { parseLocalDate } from '@/utils/dates';
import { ms, s } from '@/utils/scale';

export interface RailWeek {
  id: string;
  week_number: number;
  start_date: string;
  end_date: string;
  is_playoff: boolean;
}

export type WeekStatus = 'past' | 'live' | 'future';

interface WeekRailProps {
  weeks: RailWeek[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  /** Drives the banner-row status badge (LIVE / FINAL / UPCOMING). */
  status: WeekStatus;
}

function formatRange(start: string, end: string): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${fmt(parseLocalDate(start))} – ${fmt(parseLocalDate(end))}`;
}

function bannerLabel(week: RailWeek, playoffOrdinal: number | null): string {
  if (week.is_playoff && playoffOrdinal != null) {
    return `PLAYOFFS · R${playoffOrdinal}`;
  }
  return `WEEK ${week.week_number}`;
}

function chipLabel(week: RailWeek, playoffOrdinal: number | null): string {
  if (week.is_playoff && playoffOrdinal != null) return `R${playoffOrdinal}`;
  return `W${week.week_number}`;
}

/**
 * Vintage broadcast scoreboard week selector. Top row: bold Alfa Slab
 * banner naming the week + a status pill. Bottom row: horizontal chip
 * rail of every week in the season. Tapping a chip jumps the screen to
 * that week. Selected chip auto-centers on mount + on prop change.
 */
export function WeekRail({
  weeks,
  selectedIndex,
  onSelect,
  status,
}: WeekRailProps) {
  const c = useColors();
  const scrollRef = useRef<ScrollView>(null);
  const chipLayouts = useRef<Map<number, { x: number; w: number }>>(new Map());
  const railWidth = useRef(0);

  const selectedWeek = weeks[selectedIndex] ?? null;

  // Compute per-playoff ordinals so chip labels read R1/R2/R3 instead of
  // raw week numbers — feels more like a real bracket round indicator.
  const playoffOrdinals = (() => {
    const map = new Map<string, number>();
    let counter = 0;
    for (const w of weeks) {
      if (w.is_playoff) {
        counter += 1;
        map.set(w.id, counter);
      }
    }
    return map;
  })();

  // Auto-center the selected chip whenever the index changes.
  useEffect(() => {
    const layout = chipLayouts.current.get(selectedIndex);
    if (!layout || !railWidth.current) return;
    const target = layout.x - railWidth.current / 2 + layout.w / 2;
    scrollRef.current?.scrollTo({ x: Math.max(0, target), animated: true });
  }, [selectedIndex]);

  if (!selectedWeek) return null;

  const statusBadge =
    status === 'live' ? (
      <Badge label="LIVE" variant="merlot" size="small" />
    ) : status === 'future' ? (
      <Badge label="UPCOMING" variant="neutral" size="small" />
    ) : (
      <Badge label="FINAL" variant="turf" size="small" />
    );

  return (
    <View
      style={[
        styles.wrap,
        { backgroundColor: c.primary, borderBottomColor: c.border },
      ]}
    >
      {/* Top gold rule */}
      <View style={[styles.bannerRule, { backgroundColor: c.gold }]} />

      {/* Banner row */}
      <View style={styles.bannerRow}>
        <View style={styles.bannerText}>
          <ThemedText
            type="display"
            style={[styles.bannerTitle, { color: Brand.ecru }]}
            accessibilityRole="header"
          >
            {bannerLabel(
              selectedWeek,
              playoffOrdinals.get(selectedWeek.id) ?? null,
            )}
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.bannerRange, { color: Brand.ecruMuted }]}
          >
            {formatRange(selectedWeek.start_date, selectedWeek.end_date)}
          </ThemedText>
        </View>
        {statusBadge}
      </View>

      {/* Chip rail — same turfGreen surface; chips recolored to read on green */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.railContent}
        onLayout={(e) => {
          railWidth.current = e.nativeEvent.layout.width;
        }}
      >
        {weeks.map((w, i) => {
          const isSelected = i === selectedIndex;
          const isPast = w.end_date < selectedWeek.start_date;
          const ordinal = playoffOrdinals.get(w.id) ?? null;

          // Chip palette tuned for the turfGreen surface.
          // Selected: gold fill + ink — matches the broadcast bug.
          // Past: dim ecru text, no border — reads as "completed".
          // Future: ecru text + faint ecru border — reads as "upcoming".
          const bg = isSelected ? c.gold : 'transparent';
          const fg = isSelected
            ? Brand.ink
            : isPast
              ? Brand.ecruFaint
              : Brand.ecru;
          const border = isSelected
            ? c.gold
            : isPast
              ? 'transparent'
              : Brand.ecruFaint;

          return (
            <TouchableOpacity
              key={w.id}
              onPress={() => onSelect(i)}
              activeOpacity={0.7}
              onLayout={(e) =>
                chipLayouts.current.set(i, {
                  x: e.nativeEvent.layout.x,
                  w: e.nativeEvent.layout.width,
                })
              }
              accessibilityRole="button"
              accessibilityLabel={`${
                w.is_playoff
                  ? `Playoffs round ${ordinal ?? ''}`
                  : `Week ${w.week_number}`
              }, ${formatRange(w.start_date, w.end_date)}`}
              accessibilityState={{ selected: isSelected }}
              style={[
                styles.chip,
                {
                  backgroundColor: bg,
                  borderColor: border,
                },
              ]}
            >
              <ThemedText
                type="varsity"
                style={[styles.chipText, { color: fg }]}
              >
                {chipLabel(w, ordinal)}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Bottom gold rule — bookends the broadcast surface */}
      <View style={[styles.bannerRule, { backgroundColor: c.gold }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingVertical: s(10),
  },
  bannerRule: {
    height: 2,
    marginHorizontal: s(16),
  },
  bannerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(16),
    paddingVertical: s(10),
    gap: s(8),
  },
  bannerText: {
    flex: 1,
  },
  bannerTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(24),
    lineHeight: ms(28),
    letterSpacing: -0.2,
  },
  bannerRange: {
    marginTop: s(2),
  },
  railContent: {
    paddingHorizontal: s(12),
    paddingTop: s(2),
    paddingBottom: s(10),
    gap: s(6),
  },
  chip: {
    minWidth: s(40),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 6,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
});
