import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { ZoomIn } from 'react-native-reanimated';

import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
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
  const c = useColors();

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
        <View style={styles.headerRow}>
          <View style={[styles.eyebrowRule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.eyebrow, { color: c.secondaryText }]}
          >
            🤝 TRADE COMPLETED
          </ThemedText>
        </View>
      </View>
    );
  }

  const tier = tradeSummary.hype_tier ?? 'minor';
  const config = TIER_CONFIG[tier];
  const isBlockbuster = tier === 'blockbuster';

  const borderColor = config.goldBorder
    ? c.gold
    : config.accentBorder
      ? c.gold
      : c.border;

  const bgColor = isBlockbuster
    ? c.goldMuted
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
      <View style={styles.headerRow}>
        <View style={[styles.eyebrowRule, { backgroundColor: isBlockbuster ? c.gold : c.secondaryText, opacity: isBlockbuster ? 1 : 0.5 }]} />
        <ThemedText
          type="varsitySmall"
          style={[
            styles.eyebrow,
            { color: isBlockbuster ? c.gold : c.secondaryText },
          ]}
        >
          {config.emoji} {config.label}
        </ThemedText>
      </View>

      {/* Moves grouped by receiving team — team name on its own line, then
          a gold-rule "RECEIVES" eyebrow underneath, matching the rhythm
          used by TradeSideSummary so the chat embed reads as the same
          surface as the trades list and detail modal. */}
      {Object.entries(receiveGroups).map(([teamName, moves]) => {
        const isMultiTeam = (tradeSummary?.team_count ?? 2) > 2;
        return (
          <View key={teamName} style={styles.teamSection}>
            <ThemedText
              type="defaultSemiBold"
              style={[styles.teamName, { color: c.text }]}
              numberOfLines={1}
            >
              {teamName}
            </ThemedText>
            <View style={styles.receivesEyebrowRow}>
              <View style={[styles.receivesEyebrowRule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.receivesEyebrow, { color: c.gold }]}
              >
                Receives
              </ThemedText>
            </View>
            {moves.map((move, i) => (
              <View key={`${move.asset}-${i}`} style={styles.moveRow}>
                <ThemedText style={[styles.bullet, { color: c.gold }]}>•</ThemedText>
                <ThemedText style={[styles.moveText, { color: c.text }]}>
                  {move.asset}
                  {move.protection ? ` (${move.protection})` : ''}
                  {isMultiTeam && move.from_team_name ? (
                    <ThemedText style={[styles.fromTeam, { color: c.gold }]}>
                      {' '}from {move.from_team_name}
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  eyebrowRule: {
    height: 2,
    width: s(20),
  },
  eyebrow: {
    fontSize: ms(11),
    letterSpacing: 1.4,
  },
  teamSection: {
    gap: s(2),
  },
  teamName: {
    fontSize: ms(13),
  },
  receivesEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(2),
  },
  receivesEyebrowRule: { height: 2, width: s(14) },
  receivesEyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.4,
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
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
});
