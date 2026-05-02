import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { useChampions } from '@/hooks/useLeagueHistory';
import { ms, s } from '@/utils/scale';


interface TrophyCaseProps {
  leagueId: string;
}

/**
 * Trophy Case — a proper display case for league champions. Each season
 * gets its own "pedestal": Turf Green championship ribbon down the left
 * edge, gold trophy badge, varsity caps year + CHAMPIONS label, the
 * winner's name set in Alfa Slab display, and the runner-up in muted
 * body below. Reads as ceremonial, not a utility list.
 */
export function TrophyCase({ leagueId }: TrophyCaseProps) {
  const c = useColors();
  const { data: champions, isLoading } = useChampions(leagueId);

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <View style={[styles.labelRule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" style={{ color: c.text }}>
          Trophy Case
        </ThemedText>
      </View>

      <View
        style={[
          styles.case,
          { backgroundColor: c.card, borderColor: c.border, ...cardShadow },
        ]}
      >
        {isLoading ? (
          <View style={styles.loading}>
            <LogoSpinner />
          </View>
        ) : !champions || champions.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="trophy-outline" size={28} color={c.secondaryText} />
            <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
              No champions crowned yet
            </ThemedText>
          </View>
        ) : (
          champions.map((entry, idx) => (
            <View
              key={entry.season}
              style={[
                styles.pedestal,
                idx < champions.length - 1 && {
                  borderBottomColor: c.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              {/* Turf Green championship ribbon on the left edge */}
              <View style={[styles.ribbon, { backgroundColor: c.primary }]} />

              <View style={styles.pedestalContent}>
                <View style={styles.pedestalHeader}>
                  <View style={[styles.trophyBadge, { backgroundColor: c.goldMuted }]}>
                    <Ionicons name="trophy" size={18} color={c.gold} />
                  </View>
                  <View style={styles.pedestalMeta}>
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.seasonLabel, { color: c.secondaryText }]}
                    >
                      {entry.season}
                    </ThemedText>
                    <ThemedText
                      type="varsity"
                      style={[styles.champLabel, { color: c.primary }]}
                    >
                      Champions
                    </ThemedText>
                  </View>
                </View>

                <ThemedText
                  type="display"
                  style={[styles.championName, { color: c.text }]}
                  numberOfLines={2}
                  accessibilityLabel={`${entry.season} champion: ${entry.champion?.name ?? 'unknown'}`}
                >
                  {entry.champion?.name ?? '—'}
                </ThemedText>

                {entry.runnerUp && (
                  <View style={styles.runnerUpRow}>
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.runnerUpLabel, { color: c.secondaryText }]}
                    >
                      Runner-Up
                    </ThemedText>
                    <ThemedText style={[styles.runnerUpName, { color: c.text }]} numberOfLines={1}>
                      {entry.runnerUp.name}
                    </ThemedText>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: s(4),
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(10),
    gap: s(10),
  },
  labelRule: {
    height: 2,
    width: s(18),
  },
  case: {
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: s(16),
    overflow: 'hidden',
  },
  // Each pedestal: horizontal layout with the green ribbon flush against
  // the case's left edge, content laid out in its own padded well.
  pedestal: {
    flexDirection: 'row',
    minHeight: s(100),
  },
  ribbon: {
    width: s(5),
  },
  pedestalContent: {
    flex: 1,
    paddingVertical: s(14),
    paddingHorizontal: s(16),
  },
  pedestalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginBottom: s(8),
  },
  trophyBadge: {
    width: s(34),
    height: s(34),
    borderRadius: s(17),
    alignItems: 'center',
    justifyContent: 'center',
  },
  pedestalMeta: {
    flex: 1,
  },
  seasonLabel: {
    fontSize: ms(10),
  },
  champLabel: {
    fontSize: ms(11),
    marginTop: s(1),
  },
  // Display-font team name — the centerpiece of each pedestal. Alfa
  // Slab at this size reads ceremonial, like a plaque engraving.
  championName: {
    fontSize: ms(22),
    lineHeight: ms(28),
    letterSpacing: -0.3,
    marginBottom: s(6),
  },
  runnerUpRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  runnerUpLabel: {
    fontSize: ms(9.5),
  },
  runnerUpName: {
    flex: 1,
    fontSize: ms(12),
    fontWeight: '500',
  },
  empty: {
    paddingVertical: s(36),
    alignItems: 'center',
    gap: s(8),
  },
  emptyText: {
    fontSize: ms(13),
  },
  loading: {
    paddingVertical: s(36),
  },
});
