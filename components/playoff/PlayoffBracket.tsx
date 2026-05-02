import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts, cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { PlayoffBracketSlot } from '@/types/playoff';
import { calcRounds } from '@/utils/league/playoff';
import { ms, s as scale } from '@/utils/scale';
import { formatScore } from '@/utils/scoring/fantasyPoints';

// ─── Layout constants ───────────────────────────────────────────────────────

// Two 56px rows + hairline divider + 2px border = 115. Round to 116.
const CARD_HEIGHT = scale(116);
const CARD_GAP = scale(16); // vertical gap between cards in round 1
const CONNECTOR_W = scale(28); // width of connector zone between columns
// Round labels live in a sticky chip picker above the canvas now, so the
// canvas itself doesn't reserve space for them.
const CANVAS_TOP_PAD = scale(12);

export interface BracketTeamRef {
  name: string;
  logoKey: string | null;
}

interface Props {
  slots: PlayoffBracketSlot[];
  /** Map of team id → name + logo key. Logo is rendered next to the seed. */
  teamMap: Map<string, BracketTeamRef>;
  playoffTeams: number;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function TeamRow({
  name,
  logoKey,
  seed,
  score,
  isWinner,
  isTBD,
  isBye,
  c,
}: {
  name: string;
  logoKey: string | null;
  seed: number | null;
  score: number | null | undefined;
  isWinner: boolean;
  isTBD: boolean;
  isBye: boolean;
  c: any;
}) {
  // Hide the logo for placeholder rows (TBD, BYE) — initials on a generic
  // gray circle would just add visual noise without identity.
  const showLogo = !isTBD && !isBye;
  return (
    <View
      accessibilityLabel={`${seed !== null ? `Seed ${seed}, ` : ''}${name}${score != null ? `, ${formatScore(score)}` : ''}${isWinner ? ', winner' : ''}`}
      style={[styles.teamRow, isWinner && { backgroundColor: c.goldMuted }]}
    >
      {seed !== null ? (
        <Badge
          label={`#${seed}`}
          variant={isWinner ? 'gold' : 'turf'}
          size="small"
          style={styles.seedSlot}
        />
      ) : (
        <View style={styles.seedSpacer} />
      )}
      {showLogo ? (
        <TeamLogo logoKey={logoKey} teamName={name} size="small" />
      ) : (
        <View style={styles.logoSpacer} />
      )}
      <ThemedText
        style={[
          styles.teamName,
          { color: c.text },
          isWinner && { color: c.gold },
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
            { color: isWinner ? c.gold : c.text },
          ]}
        >
          {formatScore(score)}
        </ThemedText>
      ) : !isBye && !isTBD ? (
        <ThemedText style={[styles.scoreText, { color: c.secondaryText }]}>–</ThemedText>
      ) : null}
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
  teamMap: Map<string, BracketTeamRef>;
  c: any;
  width: number;
}) {
  const router = useRouter();
  const teamARef = slot.team_a_id ? teamMap.get(slot.team_a_id) ?? null : null;
  const teamBRef = slot.team_b_id ? teamMap.get(slot.team_b_id) ?? null : null;
  const teamAName = teamARef?.name ?? (slot.team_a_id ? 'Unknown' : 'TBD');
  const teamBName = slot.is_bye
    ? 'BYE'
    : (teamBRef?.name ?? (slot.team_b_id ? 'Unknown' : 'TBD'));

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
        logoKey={teamARef?.logoKey ?? null}
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
        logoKey={teamBRef?.logoKey ?? null}
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

// ─── Main component ─────────────────────────────────────────────────────────

export function PlayoffBracket({ slots, teamMap, playoffTeams }: Props) {
  const c = useColors();
  const { width: screenWidth } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);

  const totalRounds = calcRounds(playoffTeams);

  // Card width: fill ~86% of screen so the next round peeks in. Slightly
  // wider than the original 0.78 to give the bigger text + logos breathing
  // room without losing the peek that signals "more rounds to the right".
  const cardWidth = Math.min(Math.round(screenWidth * 0.86), 360);
  const colWidth = cardWidth + CONNECTOR_W;

  // Active round drives the chip picker. Updated by chip taps + horizontal
  // scroll settle so the two stay in sync.
  const [activeRound, setActiveRound] = useState(1);

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

  // Smart default scroll: latest active round
  const defaultRound = useMemo(() => {
    if (championId) return totalRounds;
    for (let r = totalRounds; r >= 1; r--) {
      const roundSlots = byRound.get(r);
      if (roundSlots?.some((s) => s.team_a_id && (s.team_b_id || s.is_bye))) return r;
    }
    return 1;
  }, [byRound, totalRounds, championId]);

  // Round labels — used by both the chip picker and accessibility hints.
  const roundLabels = useMemo(() => {
    return Array.from({ length: totalRounds }, (_, i) => {
      const r = i + 1;
      if (r === totalRounds) return 'Finals';
      if (r === totalRounds - 1 && totalRounds > 1) return 'Semis';
      if (r === totalRounds - 2 && totalRounds > 2) return 'Quarters';
      return `Round ${r}`;
    });
  }, [totalRounds]);

  // Sync chip → canvas: scroll the horizontal canvas to the tapped round.
  const goToRound = (round: number) => {
    setActiveRound(round);
    scrollRef.current?.scrollTo({
      x: (round - 1) * colWidth,
      animated: true,
    });
  };

  // Sync canvas → chip: when the user finishes scrolling, snap the chip
  // selection to whichever round is closest to centered.
  const onMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = e.nativeEvent.contentOffset.x;
    const round = Math.min(
      totalRounds,
      Math.max(1, Math.round(x / colWidth) + 1),
    );
    if (round !== activeRound) setActiveRound(round);
  };

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

  // Total canvas dimensions — chip picker lives outside the canvas so we
  // only reserve a small top pad inside.
  const bracketContentH = round1Count * CARD_HEIGHT + (round1Count - 1) * CARD_GAP;
  const extraBelow = thirdPlaceSlots.length > 0 ? 100 : 0;
  const canvasH = CANVAS_TOP_PAD + bracketContentH + extraBelow + 24;
  const canvasW = colWidth * totalRounds - CONNECTOR_W + 32; // last round has no connector

  // Initial scroll — snap to the latest active round and seed the chip.
  const initialScrollX = useMemo(() => {
    return (defaultRound - 1) * colWidth;
  }, [defaultRound, colWidth]);

  useEffect(() => {
    setActiveRound(defaultRound);
  }, [defaultRound]);

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

  // Cards + connectors
  for (let r = 1; r <= totalRounds; r++) {
    const roundSlots = byRound.get(r) ?? [];
    const x = (r - 1) * colWidth;
    const isLast = r === totalRounds;

    // Matchup cards
    for (const [idx, slot] of roundSlots.entries()) {
      const y = CANVAS_TOP_PAD + cardTop(r, idx);
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
        const topCardMid = CANVAS_TOP_PAD + cardTop(r, idx) + CARD_HEIGHT / 2;
        const botCardMid = CANVAS_TOP_PAD + cardTop(r, idx + 1) + CARD_HEIGHT / 2;
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
              backgroundColor: c.heritageGold,
              opacity: 0.55,
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
              backgroundColor: c.heritageGold,
              opacity: 0.55,
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
              backgroundColor: c.heritageGold,
              opacity: 0.55,
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
              backgroundColor: c.heritageGold,
              opacity: 0.55,
            }}
          />,
        );
      }
    }

    // 3rd place game below finals — branded divider (gold rule + varsity caps)
    if (isLast && thirdPlaceSlots.length > 0) {
      const y = CANVAS_TOP_PAD + cardTop(r, 0) + CARD_HEIGHT + 14;
      elements.push(
        <View key="3rd-label" style={{ position: 'absolute', left: x, top: y, width: cardWidth }}>
          <View style={styles.thirdPlaceDivider} accessibilityRole="header">
            <View style={[styles.thirdPlaceRule, { backgroundColor: c.gold }]} />
            <ThemedText
              type="varsity"
              style={[styles.thirdPlaceLabel, { color: c.text }]}
            >
              3RD PLACE
            </ThemedText>
            <View style={[styles.thirdPlaceRule, { backgroundColor: c.border }]} />
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

  const championName =
    championId && teamMap.get(championId) ? teamMap.get(championId)!.name : '';

  return (
    <View style={styles.bracketWrap}>
      {/* Sticky round picker — primary navigation, replaces the
          per-column round labels that used to live inside the canvas.
          Underline-tab style mirrors BrandSegmented in League History. */}
      <View style={[styles.chipBar, { borderBottomColor: c.border }]}>
        <View style={styles.chipRow}>
          {roundLabels.map((label, i) => {
            const round = i + 1;
            const selected = round === activeRound;
            return (
              <TouchableOpacity
                key={round}
                onPress={() => goToRound(round)}
                activeOpacity={0.7}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                accessibilityLabel={label}
                style={styles.tab}
              >
                <ThemedText
                  type="varsity"
                  style={[
                    styles.tabText,
                    { color: selected ? c.text : c.secondaryText },
                  ]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {label}
                </ThemedText>
                <View
                  style={[
                    styles.tabIndicator,
                    selected && { backgroundColor: c.primary },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* Bracket canvas */}
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentOffset={{ x: initialScrollX, y: 0 }}
        snapToInterval={colWidth}
        decelerationRate="fast"
        onMomentumScrollEnd={onMomentumScrollEnd}
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

      {/* Champion teaser — sits at the bottom of the bracket. Variant
          shifts based on whether a champion exists yet; either way it
          fills the void below short brackets and gives the page a clear
          terminal anchor. */}
      <ChampionTeaser name={championName} />
    </View>
  );
}

// ─── Champion teaser ─────────────────────────────────────────────────────────

function ChampionTeaser({ name }: { name: string }) {
  const c = useColors();
  const hasChampion = name.length > 0;

  return (
    <View
      style={[styles.championCard, { backgroundColor: c.primary }]}
      accessibilityLabel={hasChampion ? `Champion: ${name}` : 'Champion to be crowned'}
    >
      <View style={[styles.championRule, { backgroundColor: c.gold }]} />
      <View style={styles.championBody}>
        <ThemedText
          type="varsitySmall"
          style={[styles.championEyebrow, { color: c.gold }]}
        >
          {hasChampion ? 'CHAMPION' : 'CHAMPION · TBD'}
        </ThemedText>
        <ThemedText
          type="display"
          style={[
            styles.championName,
            { color: Brand.ecru },
            !hasChampion && { fontStyle: 'italic', opacity: 0.7 },
          ]}
          numberOfLines={1}
        >
          {hasChampion ? name : 'To Be Crowned'}
        </ThemedText>
      </View>
      <View style={[styles.championRule, { backgroundColor: c.gold }]} />
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  bracketWrap: {
    flex: 1,
  },
  outerScroll: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    paddingTop: scale(40),
  },
  // ─── Round picker ───
  chipBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chipRow: {
    flexDirection: 'row',
    paddingHorizontal: scale(16),
  },
  tab: {
    flex: 1,
    paddingTop: scale(10),
    paddingBottom: scale(8),
    alignItems: 'center',
  },
  tabText: {
    fontSize: ms(11),
    letterSpacing: 0.9,
    paddingHorizontal: scale(2),
  },
  tabIndicator: {
    marginTop: scale(6),
    height: 2,
    width: '100%',
    backgroundColor: 'transparent',
  },
  // ─── Champion teaser ───
  championCard: {
    marginHorizontal: scale(16),
    marginTop: scale(8),
    marginBottom: scale(20),
    borderRadius: 14,
    paddingVertical: scale(10),
    overflow: 'hidden',
    ...cardShadow,
  },
  championRule: {
    height: 2,
    marginHorizontal: scale(20),
  },
  championBody: {
    alignItems: 'center',
    paddingVertical: scale(14),
    gap: scale(6),
  },
  championEyebrow: {
    fontSize: ms(11),
    letterSpacing: 1.8,
  },
  championName: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
    textAlign: 'center',
    paddingHorizontal: scale(16),
  },
  // ─── Card ───
  card: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
    ...cardShadow,
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: scale(12),
    paddingVertical: scale(10),
    height: scale(56),
    gap: scale(8),
  },
  seedSlot: {
    minWidth: scale(30),
  },
  seedSpacer: {
    width: scale(30),
  },
  logoSpacer: {
    width: scale(28),
  },
  teamName: {
    fontFamily: Fonts.display,
    fontSize: ms(16),
    lineHeight: ms(22),
    letterSpacing: -0.1,
    flex: 1,
  },
  scoreText: {
    fontFamily: Fonts.mono,
    fontSize: ms(16),
    fontVariant: ['tabular-nums'],
    marginLeft: scale(4),
  },
  // ─── 3rd place ───
  thirdPlaceDivider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: scale(8),
  },
  thirdPlaceRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
  },
  thirdPlaceLabel: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },
});

