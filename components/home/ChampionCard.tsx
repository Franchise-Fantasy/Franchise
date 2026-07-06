import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

interface ChampionCardProps {
  teamName: string;
  logoKey: string | null | undefined;
  tricode: string | null | undefined;
  season: string;
}

/**
 * Crowns the league champion on the home screen during the window after the
 * championship game finalizes but before the commissioner advances the season
 * (which is what records `leagues.champion_team_id` and starts the offseason).
 * Until advance runs, the only champion signal is the finalized final-round
 * bracket slot — resolved by the caller and passed in here. Taps through to
 * the playoff bracket.
 */
export function ChampionCard({ teamName, logoKey, tricode, season }: ChampionCardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.goldMuted, borderColor: c.gold, ...cardShadow }]}
      onPress={() => router.push('/playoff-bracket')}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`${teamName} won the ${season} championship. View the playoff bracket.`}
    >
      <View style={styles.header}>
        <IconSymbol name="trophy.fill" size={14} color={c.gold} />
        <ThemedText type="varsitySmall" style={[styles.headerText, { color: c.gold }]}>
          League Champion
        </ThemedText>
      </View>
      <View style={styles.body}>
        <TeamLogo logoKey={logoKey} teamName={teamName} tricode={tricode ?? undefined} size="large" />
        <View style={styles.nameCol}>
          <ThemedText
            type="defaultSemiBold"
            style={[styles.teamName, { color: c.text }]}
            numberOfLines={1}
            ellipsizeMode="tail"
          >
            {teamName}
          </ThemedText>
          <ThemedText type="varsitySmall" style={[styles.season, { color: c.secondaryText }]}>
            {season}
          </ThemedText>
        </View>
        <View style={styles.viewBracket}>
          <ThemedText type="varsitySmall" style={[styles.viewBracketText, { color: c.gold }]}>
            View Bracket
          </ThemedText>
          <IconSymbol name="chevron.right" size={14} color={c.gold} />
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    padding: s(14),
    marginBottom: s(16),
    gap: s(12),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  headerText: {
    fontSize: ms(10),
    letterSpacing: 0.8,
  },
  body: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
  },
  nameCol: {
    flex: 1,
    minWidth: 0,
    gap: s(2),
  },
  teamName: {
    fontSize: ms(16),
  },
  season: {
    fontSize: ms(11),
  },
  viewBracket: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(2),
  },
  viewBracketText: {
    fontSize: ms(10),
  },
});
