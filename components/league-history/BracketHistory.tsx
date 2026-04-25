import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors, Fonts } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { BracketSlotHistory, useBracketHistory } from '@/hooks/useLeagueHistory';
import { ms, s } from '@/utils/scale';

interface BracketHistoryProps {
  leagueId: string;
}

// Per-round labels — generated based on distance from the final round.
// The bracket's maxRound is the championship; maxRound-1 is semifinals, etc.
function roundLabel(round: number, maxRound: number): string {
  const fromFinal = maxRound - round;
  if (fromFinal === 0) return 'Championship';
  if (fromFinal === 1) return 'Semifinals';
  if (fromFinal === 2) return 'Quarterfinals';
  if (fromFinal === 3) return 'First Round';
  return `Round ${round}`;
}

export function BracketHistory({ leagueId }: BracketHistoryProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data, isLoading } = useBracketHistory(leagueId);
  const [selectedSeason, setSelectedSeason] = useState<string | null>(null);

  const activeSeason = selectedSeason ?? data?.seasons[0] ?? null;

  // Slots for the active season, grouped by round. Championship and
  // 3rd-place games split out separately so they render in their own
  // sections with distinct styling.
  const seasonData = useMemo(() => {
    if (!data || !activeSeason) return null;
    const slots = data.bracketsBySeason.get(activeSeason) ?? [];
    const mainSlots = slots.filter((s) => !s.is_third_place);
    const thirdPlace = slots.find((s) => s.is_third_place) ?? null;
    const maxRound = mainSlots.reduce((m, s) => Math.max(m, s.round), 0);
    const byRound = new Map<number, BracketSlotHistory[]>();
    for (const slot of mainSlots) {
      if (!byRound.has(slot.round)) byRound.set(slot.round, []);
      byRound.get(slot.round)!.push(slot);
    }
    const rounds = [...byRound.entries()].sort(([a], [b]) => a - b);
    return { rounds, thirdPlace, maxRound };
  }, [data, activeSeason]);

  if (isLoading) return <View style={styles.loading}><LogoSpinner /></View>;
  if (!data || data.seasons.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        No playoff brackets yet — complete a postseason to build history.
      </ThemedText>
    );
  }

  return (
    <View>
      {/* Season picker — varsity caps pills, Turf Green selected. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRowContent}
        style={styles.pillRow}
      >
        {data.seasons.map((season) => {
          const isSelected = activeSeason === season;
          return (
            <TouchableOpacity
              key={season}
              accessibilityRole="button"
              accessibilityLabel={`Season ${season}`}
              accessibilityState={{ selected: isSelected }}
              style={[
                styles.pill,
                { borderColor: c.border },
                isSelected
                  ? { backgroundColor: Brand.turfGreen, borderColor: Brand.turfGreen }
                  : { backgroundColor: c.cardAlt },
              ]}
              onPress={() => setSelectedSeason(season)}
            >
              <ThemedText
                type="varsitySmall"
                style={[
                  styles.pillText,
                  { color: isSelected ? Brand.ecru : c.secondaryText },
                ]}
              >
                {season}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {seasonData && seasonData.rounds.map(([round, slots]) => {
        const isChampionship = round === seasonData.maxRound;
        return (
          <View key={round} style={styles.roundBlock}>
            <View style={styles.roundHeader}>
              <View
                style={[
                  styles.roundRule,
                  { backgroundColor: isChampionship ? c.gold : c.heritageGold },
                ]}
              />
              <ThemedText
                type="varsity"
                style={[
                  styles.roundLabel,
                  { color: isChampionship ? c.gold : c.text },
                ]}
                accessibilityRole="header"
              >
                {roundLabel(round, seasonData.maxRound)}
              </ThemedText>
              {isChampionship && (
                <Ionicons name="trophy" size={14} color={c.gold} accessible={false} />
              )}
            </View>
            {slots.map((slot) => (
              <BracketMatchup
                key={slot.id}
                slot={slot}
                teamMap={data.teamMap}
                c={c}
                isChampionship={isChampionship}
              />
            ))}
          </View>
        );
      })}

      {seasonData?.thirdPlace && (
        <View style={styles.roundBlock}>
          <View style={styles.roundHeader}>
            <View style={[styles.roundRule, { backgroundColor: c.heritageGold }]} />
            <ThemedText
              type="varsity"
              style={[styles.roundLabel, { color: c.text }]}
              accessibilityRole="header"
            >
              Third Place
            </ThemedText>
          </View>
          <BracketMatchup
            slot={seasonData.thirdPlace}
            teamMap={data.teamMap}
            c={c}
            isChampionship={false}
          />
        </View>
      )}
    </View>
  );
}

// ─── Matchup row ────────────────────────────────────────────────────────────

function BracketMatchup({
  slot,
  teamMap,
  c,
  isChampionship,
}: {
  slot: BracketSlotHistory;
  teamMap: Map<string, { id: string; name: string; tricode: string | null; logo_key: string | null }>;
  c: typeof Colors.light;
  isChampionship: boolean;
}) {
  const teamA = slot.team_a_id ? teamMap.get(slot.team_a_id) ?? null : null;
  const teamB = slot.team_b_id ? teamMap.get(slot.team_b_id) ?? null : null;
  const winnerIsA = slot.winner_id && slot.winner_id === slot.team_a_id;
  const winnerIsB = slot.winner_id && slot.winner_id === slot.team_b_id;

  // A bye slot renders the surviving team alone with a muted "BYE" tag.
  if (slot.is_bye && teamA) {
    return (
      <View style={[styles.matchup, { borderColor: c.border }]}>
        <BracketTeamRow
          team={teamA}
          seed={slot.team_a_seed}
          score={null}
          isWinner={false}
          isBye
          c={c}
          isChampionship={false}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.matchup,
        { borderColor: c.border },
        isChampionship && winnerIsA && { backgroundColor: c.goldMuted, borderColor: c.gold },
        isChampionship && winnerIsB && { backgroundColor: c.goldMuted, borderColor: c.gold },
      ]}
      accessibilityLabel={
        teamA && teamB
          ? `${teamA.name} ${slot.team_a_score ?? '—'} to ${teamB.name} ${slot.team_b_score ?? '—'}${slot.winner_id ? `, ${winnerIsA ? teamA.name : teamB.name} won` : ''}`
          : 'To be determined'
      }
    >
      <BracketTeamRow
        team={teamA}
        seed={slot.team_a_seed}
        score={slot.team_a_score}
        isWinner={!!winnerIsA}
        c={c}
        isChampionship={isChampionship && !!winnerIsA}
      />
      <View style={[styles.matchupDivider, { backgroundColor: c.border }]} />
      <BracketTeamRow
        team={teamB}
        seed={slot.team_b_seed}
        score={slot.team_b_score}
        isWinner={!!winnerIsB}
        c={c}
        isChampionship={isChampionship && !!winnerIsB}
      />
    </View>
  );
}

function BracketTeamRow({
  team,
  seed,
  score,
  isWinner,
  isBye,
  c,
  isChampionship,
}: {
  team: { id: string; name: string; tricode: string | null; logo_key: string | null } | null;
  seed: number | null;
  score: number | null;
  isWinner: boolean;
  isBye?: boolean;
  c: typeof Colors.light;
  isChampionship: boolean;
}) {
  const isTBD = !team;
  return (
    <View style={styles.teamRow}>
      {seed !== null && !isTBD ? (
        <View style={[styles.seedBadge, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
          <Text style={[styles.seedText, { color: c.secondaryText }]}>{seed}</Text>
        </View>
      ) : (
        <View style={styles.seedSpacer} />
      )}
      {team && (
        <View style={styles.logoSlot}>
          <TeamLogo
            logoKey={team.logo_key}
            teamName={team.name}
            tricode={team.tricode ?? undefined}
            size="small"
          />
        </View>
      )}
      <ThemedText
        style={[
          styles.teamName,
          {
            color: isTBD ? c.secondaryText : c.text,
            fontStyle: isTBD || isBye ? 'italic' : 'normal',
            fontWeight: isWinner ? '700' : '500',
          },
        ]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {isTBD ? 'TBD' : team.name}
      </ThemedText>
      {isBye && (
        <ThemedText
          type="varsitySmall"
          style={[styles.byeLabel, { color: c.secondaryText }]}
        >
          Bye
        </ThemedText>
      )}
      {isChampionship && isWinner && (
        <Ionicons name="trophy" size={13} color={c.gold} accessible={false} style={styles.trophyIcon} />
      )}
      {!isBye && score !== null && score !== undefined && (
        <Text
          style={[
            styles.scoreText,
            {
              color: isWinner ? c.success : c.secondaryText,
              fontWeight: isWinner ? '700' : '500',
            },
          ]}
        >
          {Number(score).toFixed(1)}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { paddingVertical: s(24) },
  emptyText: {
    fontSize: ms(13),
    textAlign: 'center',
    paddingVertical: s(16),
  },

  pillRow: {
    marginBottom: s(14),
    marginHorizontal: -s(4),
  },
  pillRowContent: {
    paddingHorizontal: s(4),
    gap: s(8),
  },
  pill: {
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    borderRadius: 8,
    borderWidth: 1,
  },
  pillText: {
    fontSize: ms(10),
  },

  roundBlock: {
    marginBottom: s(14),
  },
  roundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(8),
  },
  roundRule: {
    height: 2,
    width: s(18),
  },
  roundLabel: {
    fontSize: ms(11),
  },

  // Matchup card — a single bordered card that houses two team rows
  // separated by a hairline. Keeps the two teams visually paired.
  matchup: {
    borderWidth: 1,
    borderRadius: 10,
    marginBottom: s(8),
    overflow: 'hidden',
  },
  matchupDivider: {
    height: StyleSheet.hairlineWidth,
  },

  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(9),
    paddingHorizontal: s(10),
    gap: s(8),
  },
  seedBadge: {
    width: s(22),
    height: s(22),
    borderRadius: s(11),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  seedText: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    fontWeight: '700',
  },
  seedSpacer: {
    width: s(22),
    height: s(22),
  },
  logoSlot: {
    width: s(26),
    alignItems: 'flex-start',
  },
  teamName: {
    flex: 1,
    fontSize: ms(13),
    minWidth: 0,
  },
  byeLabel: {
    fontSize: ms(9),
  },
  trophyIcon: {
    marginLeft: s(2),
  },
  scoreText: {
    fontFamily: Fonts.mono,
    fontSize: ms(13),
    letterSpacing: 0.3,
    minWidth: s(44),
    textAlign: 'right',
  },
});
