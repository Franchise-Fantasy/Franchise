import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { PlayoffBracketSlot } from '@/types/playoff';
import { calcRounds, nextPowerOf2 } from '@/utils/playoff';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface Props {
  slots: PlayoffBracketSlot[];
  teamMap: Map<string, string>;
  playoffTeams: number;
}

function TeamRow({
  name,
  seed,
  isWinner,
  isTBD,
  isBye,
  c,
}: {
  name: string;
  seed: number | null;
  isWinner: boolean;
  isTBD: boolean;
  isBye: boolean;
  c: any;
}) {
  return (
    <View
      accessibilityLabel={`${seed !== null ? `Seed ${seed}, ` : ''}${name}${isWinner ? ', winner' : ''}`}
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
      {isWinner && (
        <Ionicons name="checkmark-circle" size={18} color={c.accent} style={styles.winnerIcon} />
      )}
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
        { backgroundColor: c.card, borderColor: c.border },
        isByeCard && { opacity: 0.6 },
      ]}
    >
      <TeamRow
        name={teamAName}
        seed={slot.team_a_seed}
        isWinner={aWinner}
        isTBD={!slot.team_a_id}
        isBye={false}
        c={c}
      />
      <View style={[styles.cardDivider, { backgroundColor: c.border }]} />
      <TeamRow
        name={teamBName}
        seed={slot.team_b_seed}
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

function ChampionCard({ name, c }: { name: string; c: any }) {
  return (
    <View
      style={[styles.championCard, { borderColor: c.accent, backgroundColor: c.accent + '12' }]}
      accessibilityLabel={`Champion: ${name}`}
      accessibilityRole="header"
    >
      <ThemedText style={[styles.championLabel, { color: c.accent }]}>Champion</ThemedText>
      <ThemedText style={[styles.championName, { color: c.accent }]}>{name}</ThemedText>
    </View>
  );
}

export function PlayoffBracket({ slots, teamMap, playoffTeams }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const totalRounds = calcRounds(playoffTeams);

  // Group slots by round
  const byRound = useMemo(() => {
    const map = new Map<number, PlayoffBracketSlot[]>();
    for (const s of slots) {
      if (!map.has(s.round)) map.set(s.round, []);
      map.get(s.round)!.push(s);
    }
    // Sort each round by bracket_position
    for (const [, roundSlots] of map) {
      roundSlots.sort((a, b) => a.bracket_position - b.bracket_position);
    }
    return map;
  }, [slots]);

  // Find champion
  const finalSlot = byRound.get(totalRounds)?.[0] ?? null;
  const championId = finalSlot?.winner_id ?? null;
  const championName = championId ? teamMap.get(championId) ?? 'Unknown' : null;

  // Smart default: latest round with at least one populated matchup
  const defaultRound = useMemo(() => {
    if (championId) return totalRounds;
    for (let r = totalRounds; r >= 1; r--) {
      const roundSlots = byRound.get(r);
      if (roundSlots?.some((s) => s.team_a_id && (s.team_b_id || s.is_bye))) return r;
    }
    return 1;
  }, [byRound, totalRounds, championId]);

  const [selectedRoundIndex, setSelectedRoundIndex] = useState(defaultRound - 1);
  const selectedRound = selectedRoundIndex + 1;

  // Round labels
  const roundLabels = useMemo(() => {
    return Array.from({ length: totalRounds }, (_, i) => {
      const r = i + 1;
      if (r === totalRounds) return 'Finals';
      if (r === totalRounds - 1 && totalRounds > 1) return 'Semis';
      return `Round ${r}`;
    });
  }, [totalRounds]);

  const currentSlots = byRound.get(selectedRound) ?? [];

  if (slots.length === 0) {
    return (
      <View style={styles.empty}>
        <ThemedText style={{ color: c.secondaryText }}>
          Not enough teams to generate a bracket.
        </ThemedText>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Round tabs — hide if only 1 round */}
      {totalRounds > 1 && (
        <View style={styles.tabBar}>
          <SegmentedControl
            options={roundLabels}
            selectedIndex={selectedRoundIndex}
            onSelect={setSelectedRoundIndex}
          />
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Champion card — show on finals tab when winner exists */}
        {selectedRound === totalRounds && championName && (
          <ChampionCard name={championName} c={c} />
        )}

        {/* Matchup cards */}
        {currentSlots.map((slot) => (
          <MatchupCard key={slot.id} slot={slot} teamMap={teamMap} c={c} />
        ))}

        {/* Empty state for rounds with no slots yet */}
        {currentSlots.length === 0 && (
          <View style={styles.emptyRound}>
            <ThemedText style={{ color: c.secondaryText, fontStyle: 'italic' }}>
              Matchups not yet determined
            </ThemedText>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  empty: {
    alignItems: 'center',
    paddingTop: 40,
  },
  tabBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  scrollContent: {
    padding: 16,
    gap: 12,
  },
  card: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: 'hidden',
  },
  cardDivider: {
    height: StyleSheet.hairlineWidth,
  },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  seedBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  seedSpacer: {
    width: 24,
    marginRight: 10,
  },
  seedText: {
    fontSize: 11,
    fontWeight: '700',
  },
  teamName: {
    fontSize: 15,
    flex: 1,
  },
  winnerIcon: {
    marginLeft: 8,
  },
  championCard: {
    borderWidth: 2,
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  championLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginBottom: 4,
  },
  championName: {
    fontSize: 18,
    fontWeight: '700',
  },
  emptyRound: {
    alignItems: 'center',
    paddingTop: 32,
  },
});
