import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useMatchupResult } from '@/hooks/useMatchupResult';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
    router.push(`/matchup-detail/${result.id}`);
  }, [result?.id, router]);

  if (!result) return null;

  const isCategory = result.userCatWins != null;
  const outcomeLabel = result.won ? 'You won!' : result.lost ? 'You lost.' : "It's a tie.";
  const iconName: keyof typeof Ionicons.glyphMap = result.won
    ? 'trophy'
    : result.lost
      ? 'sad-outline'
      : 'swap-horizontal';

  // Outcome-based accent colors
  const accent = result.won
    ? { bg: c.successMuted, text: c.success, icon: c.success }
    : result.lost
      ? { bg: c.dangerMuted, text: c.danger, icon: c.danger }
      : { bg: c.warningMuted, text: c.warning, icon: c.warning };

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
          {/* Icon */}
          <View style={[styles.iconCircle, { backgroundColor: accent.bg }]}>
            <Ionicons name={iconName} size={32} color={accent.icon} />
          </View>

          {/* Header */}
          <Text
            style={[styles.header, { color: c.text }]}
            accessibilityRole="header"
          >
            Week {result.weekNumber} Final
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
              accessibilityLabel="View matchup details"
            >
              <Text style={[styles.primaryButtonText, { color: c.statusText }]}>View Matchup</Text>
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
    maxWidth: 360,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 24,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.25,
    shadowRadius: 12,
    elevation: 8,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  header: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },
  score: {
    fontSize: 15,
    fontWeight: '500',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 4,
  },
  scoreNumber: {
    fontWeight: '800',
    fontSize: 16,
  },
  outcome: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 8,
    marginBottom: 24,
  },
  buttons: {
    width: '100%',
    gap: 10,
  },
  button: {
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  primaryButton: {},
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '700',
  },
  secondaryButton: {
    borderWidth: 1,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
