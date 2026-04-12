import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useMatchupResult } from '@/hooks/useMatchupResult';
import { ms, s } from '@/utils/scale';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

function calcRounds(playoffTeams: number): number {
  let p = 1;
  while (p < playoffTeams) p *= 2;
  return Math.log2(p);
}

function playoffRoundLabel(round: number, totalRounds: number): string {
  if (round >= totalRounds) return 'Championship';
  if (round === totalRounds - 1) return 'Semifinals';
  if (round === totalRounds - 2) return 'Quarterfinals';
  return `Playoff Round ${round}`;
} 

const DISMISSED_KEY = '@dismissed_matchup_results';

async function getDismissedIds(): Promise<string[]> {
  const raw = await AsyncStorage.getItem(DISMISSED_KEY);
  return raw ? JSON.parse(raw) : [];
}

async function addDismissedId(id: string): Promise<void> {
  const ids = await getDismissedIds();
  const updated = [...ids.slice(-19), id];
  await AsyncStorage.setItem(DISMISSED_KEY, JSON.stringify(updated));
}

export function MatchupResultModal() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { data: league } = useLeague();
  const { data: result } = useMatchupResult(league?.scoring_type);

  const [visible, setVisible] = useState(false);
  const [checkedId, setCheckedId] = useState<string | null>(null);

  // Check if the latest result has been dismissed
  useEffect(() => {
    if (!result?.id) return;
    if (result.id === checkedId) return;
    let cancelled = false;
    getDismissedIds().then((ids) => {
      if (cancelled) return;
      setCheckedId(result.id);
      if (!ids.includes(result.id)) {
        setVisible(true);
      }
    });
    return () => { cancelled = true; };
  }, [result?.id, checkedId]);

  const handleDismiss = useCallback(async () => {
    if (!result?.id) return;
    setVisible(false);
    await addDismissedId(result.id);
  }, [result?.id]);

  const handleViewMatchup = useCallback(async () => {
    if (!result?.id) return;
    setVisible(false);
    await addDismissedId(result.id);
    router.push(result.isPlayoff ? '/playoff-bracket' : `/matchup-detail/${result.id}`);
  }, [result?.id, result?.isPlayoff, router]);

  if (!result) return null;

  const isCategory = result.userCatWins != null;

  // Playoff context
  const totalRounds = league?.playoff_teams ? calcRounds(league.playoff_teams) : 3;
  const isPlayoff = result.isPlayoff;
  const isChampionship = isPlayoff && result.playoffRound != null && result.playoffRound >= totalRounds;
  const roundLabel = isPlayoff && result.playoffRound != null
    ? playoffRoundLabel(result.playoffRound, totalRounds)
    : null;

  // Emoji + label combos that feel alive
  const emoji = result.won
    ? (isChampionship ? '\uD83C\uDFC6' : isPlayoff ? '\uD83D\uDD25' : '\uD83D\uDCAA')
    : result.lost
      ? (isChampionship ? '\uD83D\uDE14' : isPlayoff ? '\u2744\uFE0F' : '\uD83D\uDCA8')
      : '\u2696\uFE0F';

  const outcomeLabel = result.won
    ? (isChampionship ? 'CHAMPION!' : isPlayoff ? 'You advance!' : 'Victory!')
    : result.lost
      ? (isChampionship ? 'So close.' : isPlayoff ? 'Eliminated.' : 'Tough break.')
      : "It's a tie.";

  // Outcome-based accent colors
  const accent = result.won
    ? { bg: c.successMuted, text: c.success }
    : result.lost
      ? { bg: c.dangerMuted, text: c.danger }
      : { bg: c.warningMuted, text: c.warning };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleDismiss}
      accessibilityViewIsModal
    >
      <Pressable
        style={styles.backdrop}
        onPress={handleDismiss}
        accessibilityRole="button"
        accessibilityLabel="Dismiss result"
      >
        <Pressable
          style={[styles.card, { backgroundColor: c.card }]}
          onPress={undefined}
          accessibilityRole="none"
        >
          {/* Emoji */}
          <View
            style={[styles.iconCircle, { backgroundColor: accent.bg }]}
            accessibilityElementsHidden
          >
            <Text style={styles.emoji}>{emoji}</Text>
          </View>

          {/* Header */}
          {roundLabel && (
            <Text
              style={[styles.roundLabel, { color: accent.text }]}
              accessibilityRole="text"
            >
              {roundLabel}
            </Text>
          )}
          <Text
            style={[styles.header, { color: c.text }]}
            accessibilityRole="header"
          >
            {isPlayoff ? `${roundLabel ?? 'Playoff'} Final` : `Week ${result.weekNumber} Final`}
          </Text>

          {/* Score */}
          {isCategory ? (
            <Text style={[styles.score, { color: c.text }]}>
              {result.userTeamName}{' '}
              <Text style={[styles.scoreNumber, { color: accent.text }]}>
                {result.userCatWins}-{result.opponentCatWins}
                {(result.catTies ?? 0) > 0 ? `-${result.catTies}` : ''}
              </Text>
              {' '}{result.opponentTeamName}
            </Text>
          ) : (
            <Text style={[styles.score, { color: c.text }]}>
              {result.userTeamName}{' '}
              <Text style={[styles.scoreNumber, { color: accent.text }]}>
                {result.userScore.toFixed(1)}
              </Text>
              {' – '}
              <Text style={[styles.scoreNumber, { color: accent.text }]}>
                {result.opponentScore.toFixed(1)}
              </Text>
              {' '}{result.opponentTeamName}
            </Text>
          )}

          {/* Outcome */}
          <Text style={[styles.outcome, { color: accent.text }]}>
            {outcomeLabel}
          </Text>

          {/* Buttons */}
          <View style={styles.buttons}>
            <TouchableOpacity
              style={[styles.button, styles.primaryButton, { backgroundColor: c.accent }]}
              onPress={handleViewMatchup}
              accessibilityRole="button"
              accessibilityLabel={isPlayoff ? 'View playoff bracket' : 'View matchup details'}
            >
              <Text style={[styles.primaryButtonText, { color: c.statusText }]}>
                {isPlayoff ? 'View Bracket' : 'View Matchup'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.button, styles.secondaryButton, { borderColor: c.border }]}
              onPress={handleDismiss}
              accessibilityRole="button"
              accessibilityLabel="Dismiss matchup result"
            >
              <Text style={[styles.secondaryButtonText, { color: c.secondaryText }]}>Dismiss</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    width: '85%',
    maxWidth: s(360),
    borderRadius: 16,
    paddingVertical: s(28),
    paddingHorizontal: s(24),
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  iconCircle: {
    width: s(72),
    height: s(72),
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: s(12),
  },
  emoji: {
    fontSize: ms(36),
    textAlign: 'center',
  },
  roundLabel: {
    fontSize: ms(12),
    fontWeight: '800',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: s(4),
  },
  header: {
    fontSize: ms(18),
    fontWeight: '700',
    marginBottom: s(12),
  },
  score: {
    fontSize: ms(15),
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: ms(22),
    marginBottom: s(4),
  },
  scoreNumber: {
    fontWeight: '800',
    fontSize: ms(16),
  },
  outcome: {
    fontSize: ms(20),
    fontWeight: '800',
    marginTop: s(8),
    marginBottom: s(24),
  },
  buttons: {
    width: '100%',
    gap: s(10),
  },
  button: {
    paddingVertical: s(12),
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButton: {},
  primaryButtonText: {
    fontSize: ms(15),
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
});
