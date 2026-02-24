import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PlayoffBracketSlot } from '@/types/playoff';
import { calcRounds, nextPowerOf2 } from '@/utils/playoff';
import { ScrollView, StyleSheet, View } from 'react-native';

interface Props {
  slots: PlayoffBracketSlot[];
  teamMap: Map<string, string>; // teamId → team name
  playoffTeams: number;
}

const CARD_W = 140;
const CARD_H = 56;
const ROUND_GAP = 32;
const VERTICAL_GAP = 8;

function TeamLine({
  name,
  seed,
  isWinner,
  isTBD,
  c,
}: {
  name: string;
  seed: number | null;
  isWinner: boolean;
  isTBD: boolean;
  c: any;
}) {
  return (
    <View style={[bStyles.teamLine, isWinner && { backgroundColor: c.accent + '22' }]}>
      {seed !== null && (
        <ThemedText style={[bStyles.seed, { color: c.secondaryText }]}>
          {seed}
        </ThemedText>
      )}
      <ThemedText
        style={[
          bStyles.teamText,
          isWinner && { fontWeight: '700', color: c.accent },
          isTBD && { color: c.secondaryText, fontStyle: 'italic' },
        ]}
        numberOfLines={1}
      >
        {name}
      </ThemedText>
    </View>
  );
}

function MatchupCard({
  slot,
  teamMap,
  c,
}: {
  slot: PlayoffBracketSlot;
  teamMap: Map<string, string>;
  c: any;
}) {
  const teamAName = slot.team_a_id ? teamMap.get(slot.team_a_id) ?? 'Unknown' : 'TBD';
  const teamBName = slot.is_bye
    ? 'BYE'
    : slot.team_b_id
      ? teamMap.get(slot.team_b_id) ?? 'Unknown'
      : 'TBD';

  const aWinner = slot.winner_id !== null && slot.winner_id === slot.team_a_id;
  const bWinner = slot.winner_id !== null && slot.winner_id === slot.team_b_id;

  return (
    <View style={[bStyles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <TeamLine
        name={teamAName}
        seed={slot.team_a_seed}
        isWinner={aWinner}
        isTBD={!slot.team_a_id}
        c={c}
      />
      <View style={[bStyles.cardDivider, { backgroundColor: c.border }]} />
      <TeamLine
        name={teamBName}
        seed={slot.team_b_seed}
        isWinner={bWinner}
        isTBD={!slot.team_b_id && !slot.is_bye}
        c={c}
      />
    </View>
  );
}

export function PlayoffBracket({ slots, teamMap, playoffTeams }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (slots.length === 0) {
    return (
      <View style={bStyles.empty}>
        <ThemedText style={{ color: c.secondaryText }}>
          Not enough teams to generate a bracket.
        </ThemedText>
      </View>
    );
  }

  const totalRounds = calcRounds(playoffTeams);
  const bracketSize = nextPowerOf2(playoffTeams);

  // Group slots by round
  const byRound = new Map<number, PlayoffBracketSlot[]>();
  for (const s of slots) {
    if (!byRound.has(s.round)) byRound.set(s.round, []);
    byRound.get(s.round)!.push(s);
  }

  // Round labels
  const roundLabel = (r: number) => {
    if (r === totalRounds) return 'Finals';
    if (r === totalRounds - 1 && totalRounds > 1) return 'Semis';
    return `Round ${r}`;
  };

  // Compute layout — each round column shows its matchups vertically centered
  // Round 1: N/2 matchups, Round 2: N/4, etc.
  const round1Matchups = bracketSize / 2;
  const colWidth = CARD_W + ROUND_GAP;
  const totalHeight = round1Matchups * (CARD_H + VERTICAL_GAP) - VERTICAL_GAP;
  const totalWidth = totalRounds * colWidth + CARD_W; // last round + champion card

  // Find champion
  const finalSlot = byRound.get(totalRounds)?.[0] ?? null;
  const championId = finalSlot?.winner_id ?? null;
  const championName = championId ? teamMap.get(championId) ?? 'Unknown' : null;

  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ minHeight: totalHeight + 60 }}
      >
        <View style={[bStyles.bracketContainer, { width: totalWidth, minHeight: totalHeight + 60 }]}>
          {/* Round columns */}
          {Array.from({ length: totalRounds }).map((_, ri) => {
            const round = ri + 1;
            const roundSlots = byRound.get(round) ?? [];
            const matchupsInRound = bracketSize / Math.pow(2, round);
            const spacing = totalHeight / matchupsInRound;

            return (
              <View key={round} style={[bStyles.roundCol, { left: ri * colWidth }]}>
                <ThemedText style={[bStyles.roundLabel, { color: c.secondaryText }]}>
                  {roundLabel(round)}
                </ThemedText>
                {Array.from({ length: matchupsInRound }).map((_, mi) => {
                  const slot = roundSlots.find((s) => s.bracket_position === mi + 1);
                  const topOffset = spacing * mi + (spacing - CARD_H) / 2;

                  if (!slot) {
                    // Empty TBD placeholder
                    return (
                      <View
                        key={mi}
                        style={[
                          bStyles.card,
                          {
                            position: 'absolute',
                            top: topOffset + 24,
                            width: CARD_W,
                            backgroundColor: c.card,
                            borderColor: c.border,
                            opacity: 0.4,
                          },
                        ]}
                      >
                        <TeamLine name="TBD" seed={null} isWinner={false} isTBD c={c} />
                        <View style={[bStyles.cardDivider, { backgroundColor: c.border }]} />
                        <TeamLine name="TBD" seed={null} isWinner={false} isTBD c={c} />
                      </View>
                    );
                  }

                  return (
                    <View
                      key={slot.id}
                      style={{ position: 'absolute', top: topOffset + 24, width: CARD_W }}
                    >
                      <MatchupCard slot={slot} teamMap={teamMap} c={c} />
                    </View>
                  );
                })}

                {/* Connector lines from this round to next */}
                {round < totalRounds &&
                  Array.from({ length: matchupsInRound / 2 }).map((_, gi) => {
                    const topIdx = gi * 2;
                    const botIdx = gi * 2 + 1;
                    const topCenter = spacing * topIdx + spacing / 2 + 24;
                    const botCenter = spacing * botIdx + spacing / 2 + 24;
                    const midY = (topCenter + botCenter) / 2;
                    const lineLeft = CARD_W;
                    const lineRight = CARD_W + ROUND_GAP;
                    const midX = (lineLeft + lineRight) / 2;

                    return (
                      <View key={`conn-${gi}`}>
                        {/* Horizontal from top card */}
                        <View
                          style={[
                            bStyles.connector,
                            {
                              position: 'absolute',
                              left: lineLeft,
                              top: topCenter,
                              width: midX - lineLeft,
                              height: 1,
                              backgroundColor: c.border,
                            },
                          ]}
                        />
                        {/* Horizontal from bottom card */}
                        <View
                          style={[
                            bStyles.connector,
                            {
                              position: 'absolute',
                              left: lineLeft,
                              top: botCenter,
                              width: midX - lineLeft,
                              height: 1,
                              backgroundColor: c.border,
                            },
                          ]}
                        />
                        {/* Vertical connecting top and bottom */}
                        <View
                          style={[
                            bStyles.connector,
                            {
                              position: 'absolute',
                              left: midX,
                              top: topCenter,
                              width: 1,
                              height: botCenter - topCenter,
                              backgroundColor: c.border,
                            },
                          ]}
                        />
                        {/* Horizontal from midpoint to next round */}
                        <View
                          style={[
                            bStyles.connector,
                            {
                              position: 'absolute',
                              left: midX,
                              top: midY,
                              width: lineRight - midX,
                              height: 1,
                              backgroundColor: c.border,
                            },
                          ]}
                        />
                      </View>
                    );
                  })}
              </View>
            );
          })}

          {/* Champion column */}
          {championName && (
            <View
              style={[
                bStyles.championCard,
                {
                  left: totalRounds * colWidth,
                  top: totalHeight / 2 - 20 + 24,
                  backgroundColor: c.accent + '18',
                  borderColor: c.accent,
                },
              ]}
            >
              <ThemedText style={[bStyles.championLabel, { color: c.accent }]}>
                Champion
              </ThemedText>
              <ThemedText style={[bStyles.championName, { color: c.accent }]}>
                {championName}
              </ThemedText>
            </View>
          )}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

const bStyles = StyleSheet.create({
  empty: {
    alignItems: 'center',
    paddingTop: 40,
  },
  bracketContainer: {
    position: 'relative',
  },
  roundCol: {
    position: 'absolute',
    top: 0,
    width: CARD_W,
  },
  roundLabel: {
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  card: {
    borderWidth: 1,
    borderRadius: 6,
    overflow: 'hidden',
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
  },
  teamLine: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 6,
    height: CARD_H / 2,
  },
  seed: {
    fontSize: 10,
    fontWeight: '700',
    width: 16,
    textAlign: 'center',
  },
  teamText: {
    fontSize: 11,
    flex: 1,
  },
  connector: {
    // positioned inline
  },
  championCard: {
    position: 'absolute',
    width: CARD_W,
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    alignItems: 'center',
  },
  championLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  championName: {
    fontSize: 14,
    fontWeight: '700',
  },
});
