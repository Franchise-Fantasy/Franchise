import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, ZoomIn } from 'react-native-reanimated';

import { Brand, Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { useMatchupResult } from '@/hooks/useMatchupResult';
import { ms, s } from '@/utils/scale';

const PATCH_SOURCE = require('../../assets/images/patch_logo.png');

// ── Marquee palette ──────────────────────────────────────────────────────
// The popup rides the app's signature brand surface (`heroSurface` — the
// same field-green strip as the matchup hero, sport-themed to merlot/navy
// for WNBA/NFL) with ecru type and the sport-aware gold accent on top. Ecru
// stays fixed since it reads against every heroSurface hue; the win accent
// comes from `c.gold` so it tracks each sport. A loss is conveyed by the
// *absence* of gold (dimmed ecru) rather than a muddy red on the dark green.
const SURFACE_EDGE = 'rgba(233, 226, 203, 0.10)';
const ECRU = Brand.ecru;
const ECRU_MUTED = Brand.ecruMuted;
const ECRU_FAINT = Brand.ecruFaint;
const HAIRLINE = 'rgba(233, 226, 203, 0.16)';

function calcRounds(playoffTeams: number): number {
  let p = 1;
  while (p < playoffTeams) p *= 2;
  return Math.log2(p);
}

function playoffRoundLabel(round: number, totalRounds: number, isThirdPlace: boolean): string {
  if (isThirdPlace) return '3rd Place Game';
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

interface ScoreRow {
  name: string;
  /** Pre-formatted score / category-win count for the right-hand digits. */
  display: string;
  isUser: boolean;
  isWinner: boolean;
}

export function MatchupResultModal() {
  const c = useColors();
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
    if (result.isPlayoff) {
      router.push('/playoff-bracket');
    } else {
      router.navigate({
        pathname: '/(tabs)/matchup',
        params: { matchupId: result.id },
      });
    }
  }, [result?.id, result?.isPlayoff, router]);

  if (!result) return null;

  const isCategory = result.userCatWins != null;

  // Playoff context
  const totalRounds = league?.playoff_teams ? calcRounds(league.playoff_teams) : 3;
  const isPlayoff = result.isPlayoff;
  const isThirdPlace = result.isThirdPlace;
  const isChampionship = isPlayoff && !isThirdPlace && result.playoffRound != null && result.playoffRound >= totalRounds;
  const roundLabel = isPlayoff && result.playoffRound != null
    ? playoffRoundLabel(result.playoffRound, totalRounds, isThirdPlace)
    : null;

  // Eyebrow context line above the FINAL stamp.
  const contextLabel = (roundLabel ?? `Week ${result.weekNumber}`).toUpperCase();

  // Punchy single-word headline for the marquee banner.
  const headline = result.won
    ? (isChampionship ? 'CHAMPION' : isThirdPlace ? 'THIRD PLACE' : isPlayoff ? 'ADVANCED' : 'VICTORY')
    : result.lost
      ? (isChampionship ? 'RUNNER-UP' : isThirdPlace ? 'FOURTH PLACE' : isPlayoff ? 'ELIMINATED' : 'DEFEAT')
      : 'DEAD HEAT';

  const headlineIcon: keyof typeof Ionicons.glyphMap = result.won
    ? (isChampionship ? 'trophy' : isThirdPlace ? 'medal' : isPlayoff ? 'arrow-up-circle' : 'trending-up')
    : result.lost
      ? 'trending-down'
      : 'swap-horizontal';

  const headlineColor = result.won ? c.gold : result.lost ? ECRU_MUTED : ECRU;

  // Head-to-head line score, user's team on top. Winner crowned in gold,
  // loser dimmed; on a tie neither row is crowned.
  const fmt = (n: number) => n.toFixed(1);
  const rows: ScoreRow[] = isCategory
    ? [
        {
          name: result.userTeamName,
          display: String(result.userCatWins),
          isUser: true,
          isWinner: !!result.won,
        },
        {
          name: result.opponentTeamName,
          display: String(result.opponentCatWins),
          isUser: false,
          isWinner: !!result.lost,
        },
      ]
    : [
        {
          name: result.userTeamName,
          display: fmt(result.userScore),
          isUser: true,
          isWinner: !!result.won,
        },
        {
          name: result.opponentTeamName,
          display: fmt(result.opponentScore),
          isUser: false,
          isWinner: !!result.lost,
        },
      ];

  const a11yLabel = `${contextLabel} final. ${headline}. ${rows[0].name} ${
    isCategory ? result.userCatWins : fmt(result.userScore)
  } to ${isCategory ? result.opponentCatWins : fmt(result.opponentScore)} ${rows[1].name}.`;

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
        <Animated.View entering={ZoomIn.springify().damping(15).mass(0.7)} style={styles.cardWrap}>
          <Pressable
            style={[styles.card, { backgroundColor: c.heroSurface }]}
            onPress={() => {}}
            accessibilityRole="none"
          >
            {/* Faded heritage emblem behind the scoreboard. */}
            <Image
              source={PATCH_SOURCE}
              style={styles.patch}
              contentFit="contain"
              cachePolicy="memory-disk"
              transition={0}
              accessible={false}
            />
            {/* Top light edge for a faint sense of depth on the brand surface. */}
            <View style={styles.topEdge} />

            {/* Rotated "stamped" FINAL chip, tucked into the top-right corner
                clear of the rule below it. */}
            <View style={[styles.stamp, { borderColor: c.gold }]} accessibilityElementsHidden>
              <Text style={[styles.stampText, { color: c.gold }]}>FINAL</Text>
            </View>

            {/* Grouped summary — one accessible announcement; buttons stay
                separately focusable below. */}
            <View style={styles.summary} accessible accessibilityLabel={a11yLabel}>
              {/* Eyebrow + top gold double-rule (runs clear below the stamp) */}
              <View style={[styles.rule, styles.ruleThick, styles.ruleTop, { backgroundColor: c.gold }]} />
              <View style={styles.rule} />
              <Text style={styles.eyebrow}>{contextLabel}</Text>

              {/* Head-to-head line score */}
              <View style={styles.board}>
                {rows.map((row, i) => (
                  <Animated.View
                    key={row.isUser ? 'you' : 'opp'}
                    entering={FadeInDown.delay(120 + i * 90).duration(340)}
                    style={[styles.scoreRow, i === 0 && styles.scoreRowDivider]}
                  >
                    {/* Gold tick crowns the winner's row. */}
                    <View
                      style={[styles.tick, { backgroundColor: row.isWinner ? c.gold : 'transparent' }]}
                    />
                    <View style={styles.teamCol}>
                      <Text
                        style={[styles.teamName, { color: row.isWinner ? ECRU : ECRU_MUTED }]}
                        numberOfLines={1}
                      >
                        {row.name}
                      </Text>
                      {row.isUser && (
                        <View style={styles.youPill}>
                          <Text style={styles.youText}>YOU</Text>
                        </View>
                      )}
                    </View>
                    <Text
                      style={[styles.scoreDigits, { color: row.isWinner ? c.gold : ECRU_MUTED }]}
                    >
                      {row.display}
                    </Text>
                  </Animated.View>
                ))}
              </View>

              {isCategory && (result.catTies ?? 0) > 0 && (
                <Text style={styles.tiesNote}>{result.catTies} CATEGORIES TIED</Text>
              )}

              {/* Banner headline — display word flanked by gold rules. */}
              <Animated.View entering={FadeIn.delay(320).duration(360)} style={styles.banner}>
                <View style={styles.bannerRule} />
                <View style={styles.bannerInner}>
                  <Ionicons name={headlineIcon} size={ms(20)} color={headlineColor} />
                  <Text
                    style={[styles.headline, { color: headlineColor }]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {headline}
                  </Text>
                </View>
                <View style={styles.bannerRule} />
              </Animated.View>
            </View>

            {/* Buttons */}
            <View style={styles.buttons}>
              <Pressable
                style={({ pressed }) => [styles.primaryBtn, { backgroundColor: c.gold }, pressed && styles.pressed]}
                onPress={handleViewMatchup}
                accessibilityRole="button"
                accessibilityLabel={isPlayoff ? 'View playoff bracket' : 'View matchup details'}
              >
                <Text style={styles.primaryBtnText}>
                  {isPlayoff ? 'VIEW BRACKET' : 'VIEW MATCHUP'}
                </Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.ghostBtn, pressed && styles.pressed]}
                onPress={handleDismiss}
                accessibilityRole="button"
                accessibilityLabel="Dismiss matchup result"
              >
                <Text style={styles.ghostBtnText}>DISMISS</Text>
              </Pressable>
            </View>
          </Pressable>
        </Animated.View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: s(20),
  },
  cardWrap: {
    width: '100%',
    maxWidth: s(380),
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(181, 123, 48, 0.30)',
    paddingTop: s(14),
    paddingBottom: s(18),
    paddingHorizontal: s(22),
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.45,
    shadowRadius: 24,
    elevation: 14,
  },
  topEdge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: SURFACE_EDGE,
  },
  patch: {
    position: 'absolute',
    alignSelf: 'center',
    bottom: s(40),
    width: s(190),
    height: s(190),
    opacity: 0.10,
  },

  // ── Rubber-stamp FINAL chip ────────────────────────────────────────────
  stamp: {
    position: 'absolute',
    top: s(8),
    right: s(14),
    borderWidth: 1.5,
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    transform: [{ rotate: '-8deg' }],
    opacity: 0.92,
    zIndex: 2,
  },
  stampText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 2.5,
  },

  summary: {
    alignSelf: 'stretch',
  },

  // ── Gold double-rule framing ───────────────────────────────────────────
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
  },
  ruleThick: {
    height: 2,
    marginVertical: 3,
  },
  // Pushes the top rule down so the full-width line clears the corner stamp
  // (including the lower corner the -8deg tilt dips down) instead of grazing
  // it.
  ruleTop: {
    marginTop: s(26),
  },
  eyebrow: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 2.4,
    color: ECRU_FAINT,
    textAlign: 'center',
    marginTop: s(12),
    marginBottom: s(4),
  },

  // ── Head-to-head board ─────────────────────────────────────────────────
  board: {
    marginTop: s(6),
  },
  scoreRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: s(54),
    gap: s(10),
  },
  scoreRowDivider: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(233, 226, 203, 0.14)',
  },
  tick: {
    width: 3,
    height: s(30),
    borderRadius: 2,
  },
  teamCol: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  teamName: {
    flexShrink: 1,
    fontFamily: Fonts.varsityBold,
    fontSize: ms(18),
    letterSpacing: 0.5,
  },
  youPill: {
    paddingHorizontal: s(5),
    paddingVertical: s(1),
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(233, 226, 203, 0.30)',
  },
  youText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(8),
    letterSpacing: 1.2,
    color: ECRU_MUTED,
  },
  scoreDigits: {
    fontFamily: Fonts.mono,
    fontSize: ms(34),
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  tiesNote: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(9),
    letterSpacing: 1.4,
    color: ECRU_FAINT,
    textAlign: 'center',
    marginTop: s(8),
  },

  // ── Banner headline ────────────────────────────────────────────────────
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    marginTop: s(18),
    marginBottom: s(4),
  },
  bannerRule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: HAIRLINE,
  },
  bannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  headline: {
    fontFamily: Fonts.display,
    fontSize: ms(28),
    lineHeight: ms(34),
    letterSpacing: 0.5,
  },

  // ── Buttons ────────────────────────────────────────────────────────────
  buttons: {
    marginTop: s(18),
    gap: s(10),
  },
  primaryBtn: {
    borderRadius: 10,
    minHeight: s(50),
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(14),
    letterSpacing: 1.6,
    color: Brand.ink,
  },
  ghostBtn: {
    borderRadius: 10,
    minHeight: s(46),
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(181, 123, 48, 0.45)',
  },
  ghostBtnText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(13),
    letterSpacing: 1.6,
    color: ECRU_MUTED,
  },
  pressed: {
    opacity: 0.7,
  },
});
