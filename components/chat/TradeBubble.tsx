import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { TradeSummary } from '@/types/chat';
import { ms, s } from '@/utils/scale';

interface Props {
  tradeSummary?: TradeSummary;
}

const TIER_CONFIG = {
  minor: {
    label: 'Trade Completed',
    emoji: '🤝',
    borderWidth: 1,
    accentBorder: false,
    goldBorder: false,
  },
  major: {
    label: 'MAJOR TRADE',
    emoji: '🔥',
    borderWidth: 1.5,
    accentBorder: true,
    goldBorder: false,
  },
  blockbuster: {
    label: 'BLOCKBUSTER',
    emoji: '💣',
    borderWidth: 2,
    accentBorder: false,
    goldBorder: true,
  },
} as const;

export function TradeBubble({ tradeSummary }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  // Group moves by receiving team
  const receiveGroups = useMemo(() => {
    if (!tradeSummary) return {};
    const groups: Record<string, typeof tradeSummary.moves> = {};
    for (const move of tradeSummary.moves) {
      const key = move.to_team_name;
      if (!groups[key]) groups[key] = [];
      groups[key].push(move);
    }
    return groups;
  }, [tradeSummary]);

  if (!tradeSummary) {
    return (
      <View
        style={[styles.card, { backgroundColor: c.cardAlt, borderColor: c.border, borderWidth: 1 }]}
        accessibilityRole="summary"
        accessibilityLabel="Trade completed"
      >
        <ThemedText style={styles.headerText}>🤝 Trade Completed</ThemedText>
      </View>
    );
  }

  const tier = tradeSummary.hype_tier ?? 'minor';
  const config = TIER_CONFIG[tier];
  const isBlockbuster = tier === 'blockbuster';

  const borderColor = config.goldBorder
    ? c.gold
    : config.accentBorder
      ? c.accent
      : c.border;

  const bgColor = isBlockbuster
    ? scheme === 'dark' ? 'rgba(212, 160, 23, 0.08)' : 'rgba(212, 160, 23, 0.06)'
    : c.cardAlt;

  const a11yLabel = `${config.label}. ${Object.entries(receiveGroups)
    .map(([team, moves]) => `${team} receives ${moves.map((m) => m.asset).join(', ')}`)
    .join('. ')}`;

  const Wrapper = isBlockbuster ? Animated.View : View;
  const enteringAnim = isBlockbuster ? ZoomIn.duration(400).springify() : undefined;

  return (
    <Wrapper
      entering={enteringAnim}
      style={[
        styles.card,
        {
          backgroundColor: bgColor,
          borderColor,
          borderWidth: config.borderWidth,
        },
      ]}
      accessibilityRole="summary"
      accessibilityLabel={a11yLabel}
    >
      {/* Header */}
      <View style={styles.header}>
        <ThemedText style={[styles.headerText, isBlockbuster && styles.headerBlockbuster]}>
          {config.emoji} {config.label}
        </ThemedText>
      </View>

      {/* Moves grouped by receiving team */}
      {Object.entries(receiveGroups).map(([teamName, moves]) => {
        const isMultiTeam = (tradeSummary?.team_count ?? 2) > 2;
        return (
          <View key={teamName} style={styles.teamSection}>
            <ThemedText style={[styles.teamLabel, { color: c.secondaryText }]}>
              {teamName} receives:
            </ThemedText>
            {moves.map((move, i) => (
              <View key={`${move.asset}-${i}`} style={styles.moveRow}>
                <ThemedText style={styles.bullet}>•</ThemedText>
                <ThemedText style={styles.moveText}>
                  {move.asset}
                  {move.protection ? ` (${move.protection})` : ''}
                  {isMultiTeam && move.from_team_name ? (
                    <ThemedText style={[styles.fromTeam, { color: c.secondaryText }]}>
                      {' '}(from {move.from_team_name})
                    </ThemedText>
                  ) : null}
                </ThemedText>
              </View>
            ))}
          </View>
        );
      })}
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: s(14),
    gap: s(8),
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerText: {
    fontSize: ms(14),
    fontWeight: '700',
  },
  headerBlockbuster: {
    fontSize: ms(15),
    letterSpacing: 0.5,
  },
  tierBadge: {
    paddingHorizontal: s(8),
    paddingVertical: s(3),
    borderRadius: 4,
  },
  tierBadgeText: {
    fontSize: ms(10),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  teamSection: {
    gap: s(2),
  },
  teamLabel: {
    fontSize: ms(12),
    fontWeight: '600',
    marginBottom: s(2),
  },
  moveRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingLeft: s(4),
    gap: s(6),
  },
  bullet: {
    fontSize: ms(14),
    lineHeight: ms(20),
  },
  moveText: {
    fontSize: ms(14),
    lineHeight: ms(20),
    flex: 1,
  },
  fromTeam: {
    fontSize: ms(12),
    fontStyle: 'italic',
  },
});
