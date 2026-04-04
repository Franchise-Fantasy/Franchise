import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PlayoffBracketSlot } from '@/types/playoff';
import { calcRounds } from '@/utils/playoff';
import { formatScore } from '@/utils/fantasyPoints';
import { ms, s as scale } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useRef } from 'react';
import {
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

// ─── Layout constants ───────────────────────────────────────────────────────

const CARD_HEIGHT = scale(88); // two 43px rows + hairline divider + 2px border
const CARD_GAP = scale(12); // vertical gap between cards in round 1
const CONNECTOR_W = scale(28); // width of connector zone between columns
const LABEL_H = scale(32); // height reserved for round label above cards

interface Props {
  slots: PlayoffBracketSlot[];
  teamMap: Map<string, string>;
  playoffTeams: number;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TeamRow({
  name,
  seed,
  score,
  isWinner,
  isTBD,
  isBye,
  c,
}: {
  name: string;
  seed: number | null;
  score: number | null | undefined;
  isWinner: boolean;
  isTBD: boolean;
  isBye: boolean;
  c: any;
}) {
  return (
    <View
      accessibilityLabel={`${seed !== null ? `Seed ${seed}, ` : ''}${name}${score != null ? `, ${formatScore(score)}` : ''}${isWinner ? ', winner' : ''}`}
      style={[styles.teamRow, isWinner && { backgroundColor: c.accent + '15' }]}
    >
      {seed !== null ? (
        <View style={[styles.seedBadge, { backgroundColor: isWinner ? c.accent : c.cardAlt }]}>
          <ThemedText
            style={[styles.seedText, { color: isWinner ? c.accentText : c.secondaryText }]}
          >
            {seed}
          </ThemedText>
        </View>
      ) : (
        <View style={styles.seedSpacer} />
      )}
      <ThemedText
        style={[
          styles.teamName,
          isWinner && { fontWeight: '700', color: c.accent },
          (isTBD || isBye) && { color: c.secondaryText, fontStyle: 'italic' },
        ]}
        numberOfLines={1}
      >
        {name}
      </ThemedText>
      {score != null && !isBye && !isTBD ? (
        <ThemedText
          style={[
            styles.scoreText,
            { color: isWinner ? c.accent : c.text },
            isWinner && { fontWeight: '700' },
          ]}
        >
          {formatScore(score)}
        </ThemedText>
      ) : !isBye && !isTBD ? (
        <ThemedText style={[styles.scoreText, { color: c.secondaryText }]}>–</ThemedText>
      ) : null}
      {isWinner && (
        <Ionicons name="checkmark-circle" size={16} color={c.accent} style={{ marginLeft: 4 }} />
      )}
    </View>
  );
}

function MatchupCard({
  slot,
  teamMap,
  c,
  width,
}: {
  slot: PlayoffBracketSlot;
  teamMap: Map<string, string>;
  c: any;
  width: number;
}) {
  const router = useRouter();
  const teamAName = slot.team_a_id ? teamMap.get(slot.team_a_id) ?? 'Unknown' : 'TBD';
  const teamBName = slot.is_bye
    ? 'BYE'
    : slot.team_b_id
      ? teamMap.get(slot.team_b_id) ?? 'Unknown'
      : 'TBD';

  const aWinner = slot.winner_id !== null && slot.winner_id === slot.team_a_id;
  const bWinner = slot.winner_id !== null && slot.winner_id === slot.team_b_id;
  const isByeCard = slot.is_bye;

  const accessibilityLabel = `${slot.team_a_seed ? `Seed ${slot.team_a_seed} ` : ''}${teamAName} vs ${slot.team_b_seed ? `Seed ${slot.team_b_seed} ` : ''}${teamBName}${aWinner ? `, winner: ${teamAName}` : bWinner ? `, winner: ${teamBName}` : ''}`;

  const cardContent = (
    <View
      style={[
        styles.card,
        { backgroundColor: c.card, borderColor: c.border, width },
        isByeCard && { opacity: 0.5 },
      ]}
    >
      <TeamRow
        name={teamAName}
        seed={slot.team_a_seed}
        score={slot.team_a_score}
        isWinner={aWinner}
        isTBD={!slot.team_a_id}
        isBye={false}
        c={c}
      />
      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />
      <TeamRow
        name={teamBName}
        seed={slot.team_b_seed}
        score={slot.team_b_score}
        isWinner={bWinner}
        isTBD={!slot.team_b_id && !slot.is_bye}
        isBye={slot.is_bye}
        c={c}
      />
    </View>
  );

  if (slot.matchup_id) {
    return (
      <TouchableOpacity
        onPress={() => router.push(`/matchup-detail/${slot.matchup_id}`)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="View matchup details"
        activeOpacity={0.7}
      >
        {cardContent}
      </TouchableOpacity>
    );
  }

  return <View accessibilityLabel={accessibilityLabel}>{cardContent}</View>;
}

function ChampionBanner({ name, c, width }: { name: string; c: any; width: number }) {
  return (
    <View
      style={[styles.championCard, { borderColor: c.accent, backgroundColor: c.accent + '12', width }]}
      accessibilityLabel={`Champion: ${name}`}
      accessibilityRole="header"
    >
      <Ionicons name="trophy" size={18} color={c.accent} />
      <ThemedText style={[styles.championLabel, { color: c.accent }]}>Champion</ThemedText>
      <ThemedText style={[styles.championName, { color: c.accent }]}>{name}</ThemedText>
    </View>
  );
}

// ─── Main component ─────────────────────────────────────────────────────────

export function PlayoffBracket({ slots, teamMap, playoffTeams }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  const totalRounds = calcRounds(playoffTeams);

  // Card width: fill ~78% of screen so the next round peeks in
  const cardWidth = Math.min(Math.round(screenWidth * 0.78), 320);
  const colWidth = cardWidth + CONNECTOR_W;

  // Group slots by round, separating 3rd place
  const { byRound, thirdPlaceSlots } = useMemo(() => {
    const map = new Map<number, PlayoffBracketSlot[]>();
    const tp: PlayoffBracketSlot[] = [];
    for (const s of slots) {
      if (s.is_third_place) {
        tp.push(s);
        continue;
      }
      if (!map.has(s.round)) map.set(s.round, []);
      map.get(s.round)!.push(s);
    }
    for (const [, roundSlots] of map) {
      roundSlots.sort((a, b) => a.bracket_position - b.bracket_position);
    }
    return { byRound: map, thirdPlaceSlots: tp };
  }, [slots]);

  // Find champion
  const finalSlot = byRound.get(totalRounds)?.[0] ?? null;
  const championId = finalSlot?.winner_id ?? null;
  const championName = championId ? teamMap.get(championId) ?? 'Unknown' : null;

  // Smart default scroll: latest active round
  const defaultRound = useMemo(() => {
    if (championId) return totalRounds;
    for (let r = totalRounds; r >= 1; r--) {
      const roundSlots = byRound.get(r);
      if (roundSlots?.some((s) => s.team_a_id && (s.team_b_id || s.is_bye))) return r;
    }
    return 1;
  }, [byRound, totalRounds, championId]);

  // Round labels
  const roundLabels = useMemo(() => {
    return Array.from({ length: totalRounds }, (_, i) => {
      const r = i + 1;
      if (r === totalRounds) return 'Finals';
      if (r === totalRounds - 1 && totalRounds > 1) return 'Semis';
      return `Round ${r}`;
    });
  }, [totalRounds]);

  // Vertical position for card at (round, index).
  // Round 1 stacks tight. Later rounds center between their two feeders.
  const round1Count = byRound.get(1)?.length ?? 1;

  function cardTop(round: number, index: number): number {
    if (round === 1) {
      return index * (CARD_HEIGHT + CARD_GAP);
    }
    const topFeeder = cardTop(round - 1, index * 2);
    const botFeeder = cardTop(round - 1, index * 2 + 1) + CARD_HEIGHT;
    return topFeeder + (botFeeder - topFeeder - CARD_HEIGHT) / 2;
  }

  // Total canvas dimensions
  const bracketContentH = round1Count * CARD_HEIGHT + (round1Count - 1) * CARD_GAP;
  const extraBelow = (championName ? 90 : 0) + (thirdPlaceSlots.length > 0 ? 100 : 0);
  const canvasH = LABEL_H + bracketContentH + extraBelow + 24;
  const canvasW = colWidth * totalRounds - CONNECTOR_W + 32; // last round has no connector

  // Initial scroll
  // Snap to the latest active round
  const initialScrollX = useMemo(() => {
    return (defaultRound - 1) * colWidth;
  }, [defaultRound, colWidth]);

  if (slots.length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText style={{ color: c.secondaryText }}>
          Not enough teams to generate a bracket.
        </ThemedText>
      </View>
    );
  }

  // Build all render elements
  const elements: React.ReactNode[] = [];

  // Round labels
  for (let i = 0; i < totalRounds; i++) {
    elements.push(
      <View
        key={`lbl-${i}`}
        style={{ position: 'absolute', left: i * colWidth, top: 0, width: cardWidth }}
      >
        <ThemedText
          style={[styles.roundLabelText, { color: c.secondaryText }]}
          accessibilityRole="header"
        >
          {roundLabels[i]}
        </ThemedText>
      </View>,
    );
  }

  // Cards + connectors
  for (let r = 1; r <= totalRounds; r++) {
    const roundSlots = byRound.get(r) ?? [];
    const x = (r - 1) * colWidth;
    const isLast = r === totalRounds;

    // Matchup cards
    for (const [idx, slot] of roundSlots.entries()) {
      const y = LABEL_H + cardTop(r, idx);
      elements.push(
        <View key={slot.id} style={{ position: 'absolute', left: x, top: y }}>
          <MatchupCard slot={slot} teamMap={teamMap} c={c} width={cardWidth} />
        </View>,
      );
    }

    // Connector lines between this round and the next
    if (!isLast) {
      for (let idx = 0; idx < roundSlots.length; idx += 2) {
        if (idx + 1 >= roundSlots.length) break;
        const topCardMid = LABEL_H + cardTop(r, idx) + CARD_HEIGHT / 2;
        const botCardMid = LABEL_H + cardTop(r, idx + 1) + CARD_HEIGHT / 2;
        const connX = x + cardWidth; // right edge of cards

        // Horizontal stub from top card
        elements.push(
          <View
            key={`conn-t-${r}-${idx}`}
            style={{
              position: 'absolute',
              left: connX,
              top: topCardMid,
              width: CONNECTOR_W / 2,
              height: 1,
              backgroundColor: c.border,
            }}
          />,
        );
        // Horizontal stub from bottom card
        elements.push(
          <View
            key={`conn-b-${r}-${idx}`}
            style={{
              position: 'absolute',
              left: connX,
              top: botCardMid,
              width: CONNECTOR_W / 2,
              height: 1,
              backgroundColor: c.border,
            }}
          />,
        );
        // Vertical line connecting the two stubs
        elements.push(
          <View
            key={`conn-v-${r}-${idx}`}
            style={{
              position: 'absolute',
              left: connX + CONNECTOR_W / 2 - 1,
              top: topCardMid,
              width: 1,
              height: botCardMid - topCardMid + 1,
              backgroundColor: c.border,
            }}
          />,
        );
        // Horizontal exit from midpoint to next round
        const midY = topCardMid + (botCardMid - topCardMid) / 2;
        elements.push(
          <View
            key={`conn-e-${r}-${idx}`}
            style={{
              position: 'absolute',
              left: connX + CONNECTOR_W / 2 - 1,
              top: midY,
              width: CONNECTOR_W / 2 + 1,
              height: 1,
              backgroundColor: c.border,
            }}
          />,
        );
      }
    }

    // Champion banner below finals
    if (isLast && championName && roundSlots.length > 0) {
      const y = LABEL_H + cardTop(r, 0) + CARD_HEIGHT + 14;
      elements.push(
        <View key="champion" style={{ position: 'absolute', left: x, top: y }}>
          <ChampionBanner name={championName} c={c} width={cardWidth} />
        </View>,
      );
    }

    // 3rd place game below champion/finals
    if (isLast && thirdPlaceSlots.length > 0) {
      const y = LABEL_H + cardTop(r, 0) + CARD_HEIGHT + (championName ? 106 : 14);
      elements.push(
        <View key="3rd-label" style={{ position: 'absolute', left: x, top: y, width: cardWidth }}>
          <View style={styles.thirdPlaceDivider} accessibilityRole="header">
            <Ionicons name="medal-outline" size={12} color={c.secondaryText} />
            <ThemedText style={[styles.thirdPlaceLabel, { color: c.secondaryText }]}>
              3rd Place
            </ThemedText>
          </View>
        </View>,
      );
      for (const [i, slot] of thirdPlaceSlots.entries()) {
        elements.push(
          <View
            key={slot.id}
            style={{ position: 'absolute', left: x, top: y + 24 + i * (CARD_HEIGHT + 6) }}
          >
            <MatchupCard slot={slot} teamMap={teamMap} c={c} width={cardWidth} />
          </View>,
        );
      }
    }
  }

  return (
    <ScrollView
      ref={scrollRef}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentOffset={{ x: initialScrollX, y: 0 }}
      snapToInterval={colWidth}
      decelerationRate="fast"
      style={styles.outerScroll}
      accessibilityLabel="Playoff bracket. Scroll left and right to view rounds."
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          width: canvasW,
          height: canvasH,
          paddingHorizontal: 16,
        }}
      >
        <View style={{ width: canvasW, height: canvasH }}>
          {elements}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  outerScroll: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    paddingTop: scale(40),
  },
  // ─── Round label ───
  roundLabelText: {
    fontSize: ms(12),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    textAlign: 'center',
  },
  // ─── Card ───
  card: {
    borderWidth: 1,
    borderRadius: 10,
    overflow: 'hidden',
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scale(12),
    paddingVertical: scale(10),
    height: scale(43),
  },
  seedBadge: {
    width: scale(26),
    height: scale(26),
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: scale(8),
  },
  seedSpacer: {
    width: scale(26),
    marginRight: scale(8),
  },
  seedText: {
    fontSize: ms(12),
    fontWeight: '700',
  },
  teamName: {
    fontSize: ms(15),
    flex: 1,
  },
  scoreText: {
    fontSize: ms(15),
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
    marginLeft: scale(8),
  },
  // ─── Champion ───
  championCard: {
    borderWidth: 2,
    borderRadius: 10,
    padding: scale(10),
    alignItems: 'center',
    gap: 2,
  },
  championLabel: {
    fontSize: ms(10),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  championName: {
    fontSize: ms(14),
    fontWeight: '700',
  },
  // ─── 3rd place ───
  thirdPlaceDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(4),
  },
  thirdPlaceLabel: {
    fontSize: ms(11),
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
