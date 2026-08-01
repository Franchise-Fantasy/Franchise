import { useRouter } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/IconSymbol';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface HomeListCardProps {
  /** Section heading, e.g. "Rookie Draft Order" / "2027-28 Outlook". */
  label: string;
  /** Right side of the label row — usually a RostersPill. */
  accessory?: ReactNode;
  isLoading?: boolean;
  /** Query failed. Wins over `empty` — a fetch error must never present as a
   *  calm "nothing here yet" message (that's how the draft-order card read as
   *  "order available once the season ends" on a network failure). */
  isError?: boolean;
  /** Re-runs the failed query from the error state. */
  onRetry?: () => void;
  /** Loaded fine but there's genuinely nothing to show. */
  empty?: boolean;
  emptyText?: string;
  children: ReactNode;
}

/**
 * Shared shell for the home screen's list cards (StandingsSection's offseason
 * stand-ins): the gold-rule sectionLabel header row with an optional accessory,
 * the standard card chrome, and uniform loading / error / empty states.
 * Content rows stay with the caller — only the frame is shared.
 */
export function HomeListCard({
  label,
  accessory,
  isLoading,
  isError,
  onRetry,
  empty,
  emptyText,
  children,
}: HomeListCardProps) {
  const c = useColors();
  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <View style={styles.labelLeft}>
          <View style={[styles.labelRule, { backgroundColor: c.gold }]} />
          <ThemedText type="sectionLabel" style={{ color: c.text }}>
            {label}
          </ThemedText>
        </View>
        {accessory}
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
        {isLoading ? (
          <View style={styles.stateBox}>
            <LogoSpinner />
          </View>
        ) : isError ? (
          <View style={styles.stateBox}>
            <ThemedText style={[styles.stateText, { color: c.secondaryText }]}>
              Couldn&apos;t load this right now.
            </ThemedText>
            {onRetry && (
              <TouchableOpacity
                style={[styles.retryBtn, { borderColor: c.border, backgroundColor: c.cardAlt }]}
                onPress={onRetry}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={`Retry loading ${label}`}
                hitSlop={8}
              >
                <ThemedText type="varsitySmall" style={[styles.retryText, { color: c.text }]}>
                  Try Again
                </ThemedText>
              </TouchableOpacity>
            )}
          </View>
        ) : empty ? (
          <ThemedText style={[styles.stateText, styles.stateBox, { color: c.secondaryText }]}>
            {emptyText}
          </ThemedText>
        ) : (
          children
        )}
      </View>
    </View>
  );
}

/** The "Rosters" entry point the dynasty offseason cards share. During the
 *  offseason StandingsSection is swapped out, so these cards are the only
 *  surface listing every team — the pill keeps rosters reachable (the
 *  team-roster page carries its own switcher, so any team works as the landing
 *  point). */
export function RostersPill({ teamId }: { teamId: string | null }) {
  const c = useColors();
  const router = useRouter();
  if (!teamId) return null;
  return (
    <TouchableOpacity
      style={[styles.pill, { backgroundColor: c.cardAlt, borderColor: c.border }]}
      onPress={() => router.push(`/team-roster/${teamId}` as never)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Browse team rosters"
      hitSlop={8}
    >
      <IconSymbol name="person.3.fill" size={14} color={c.gold} />
      <ThemedText type="varsitySmall" style={[styles.pillText, { color: c.text }]}>
        Rosters
      </ThemedText>
    </TouchableOpacity>
  );
}

/** RostersPill's twin for redraft/keeper, whose rosters are CLEARED during the
 *  offseason — an empty roster is a dead end, so their card points at league
 *  history instead. */
export function HistoryPill() {
  const c = useColors();
  const router = useRouter();
  return (
    <TouchableOpacity
      style={[styles.pill, { backgroundColor: c.cardAlt, borderColor: c.border }]}
      onPress={() => router.push('/league-history' as never)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="View league history"
      hitSlop={8}
    >
      <IconSymbol name="book.fill" size={14} color={c.gold} />
      <ThemedText type="varsitySmall" style={[styles.pillText, { color: c.text }]}>
        History
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: s(4),
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(10),
  },
  labelLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  labelRule: {
    height: 2,
    width: s(18),
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingTop: s(10),
    paddingBottom: s(8),
    marginBottom: s(16),
    overflow: 'hidden',
  },
  stateBox: {
    paddingVertical: s(20),
    alignItems: 'center',
    gap: s(10),
  },
  stateText: {
    fontSize: ms(13),
    textAlign: 'center',
  },
  retryBtn: {
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    borderRadius: 8,
    borderWidth: 1,
  },
  retryText: {
    fontSize: ms(10),
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 8,
    borderWidth: 1,
  },
  pillText: {
    fontSize: ms(9.5),
  },
});
