import { Ionicons } from '@expo/vector-icons';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts, cardShadow } from '@/constants/Colors';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type {
  NflArchiveFranchiseSeason,
  NflArchiveGame,
  NflArchiveGameBoxLine,
  NflArchiveSeries,
} from '@/types/archiveNflPlayoff';
import { ms, s } from '@/utils/scale';

interface Props {
  series: NflArchiveSeries | null;
  game: NflArchiveGame | null;
  franchiseMap: Map<string, NflArchiveFranchiseSeason>;
  onTeamTap: (franchiseId: string) => void;
  /** Super Bowl MVP — only consumed for SB series (round 4). */
  sbMvp?: {
    playerName: string;
    franchiseId: string | null;
    statLine: string | null;
  } | null;
}

// Round label per (round, conference). Pre-merger has AFL CG / NFL CG before
// the Super Bowl, so we branch on conference for round=3.
function roundLabel(series: NflArchiveSeries): string {
  if (series.round === 4) return 'SUPER BOWL';
  if (series.round === 3) {
    if (series.conference === 'AFL' || series.conference === 'NFL') {
      return `${series.conference} CHAMPIONSHIP`;
    }
    return `${series.conference} CHAMPIONSHIP`;
  }
  if (series.round === 2) return `${series.conference} DIVISIONAL`;
  if (series.round === 1) return `${series.conference} WILD CARD`;
  return '';
}

// NFL playoff series are single-elimination so the eyebrow's right-side tag
// shows the final score instead of NBA's "WINNER IN N" series count.
function scoreTag(
  series: NflArchiveSeries,
  game: NflArchiveGame | null,
  franchiseMap: Map<string, NflArchiveFranchiseSeason>,
): string | null {
  if (!series.winner_franchise_id || !game) return null;
  const winner = franchiseMap.get(series.winner_franchise_id);
  if (!winner) return null;
  const homeIsWinner = game.home_franchise_id === series.winner_franchise_id;
  const winnerScore = homeIsWinner ? game.home_score : game.away_score;
  const loserScore = homeIsWinner ? game.away_score : game.home_score;
  if (winnerScore == null || loserScore == null) return null;
  return `${winner.tricode} ${winnerScore}–${loserScore}`;
}

// Mirrors the NBA SeriesDetailCard chrome — gold-rule eyebrow, fixed
// minHeight, fade transitions, upward-growing expanded panel. Adapted for
// NFL: per-game quarter scores replace NBA's series-progress pips, and the
// box rows are split into a passer block (always visible in the preview)
// and a rusher/receiver block surfaced only when expanded.
export function NflSeriesDetailCard({
  series,
  game,
  franchiseMap,
  onTeamTap,
  sbMvp,
}: Props) {
  const c = useArchiveColors();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [series?.id]);

  // Upward-growing animation: the card's marginTop shrinks into negative
  // territory while an inline `expandedSection` height grows from 0 → max.
  // Bottom edge stays anchored above the page footer; top edge slides up
  // over the bracket. Same approach as NBA SeriesDetailCard.
  const COLLAPSED_TOP_GAP = s(16);
  const insets = useSafeAreaInsets();
  const PAGE_HEADER_HEIGHT = s(50);
  const cardRef = useRef<View>(null);
  const measuredRef = useRef(false);
  const [maxExpand, setMaxExpand] = useState(s(280));
  const handleCardLayout = useCallback(() => {
    if (measuredRef.current) return;
    cardRef.current?.measureInWindow((_x, y) => {
      if (y <= 0) return;
      measuredRef.current = true;
      const targetTop = insets.top + PAGE_HEADER_HEIGHT;
      const max = Math.max(y - targetTop, s(120));
      setMaxExpand(max);
    });
  }, [insets.top, PAGE_HEADER_HEIGHT]);

  const expandedHeight = useSharedValue(0);
  useEffect(() => {
    expandedHeight.value = withTiming(expanded ? maxExpand : 0, { duration: 260 });
  }, [expanded, maxExpand, expandedHeight]);
  const animatedCardStyle = useAnimatedStyle(() => ({
    marginTop: COLLAPSED_TOP_GAP - expandedHeight.value,
  }));
  const animatedSectionStyle = useAnimatedStyle(() => ({
    height: expandedHeight.value,
    opacity: interpolate(
      expandedHeight.value,
      [0, Math.max(maxExpand * 0.25, 1)],
      [0, 1],
      'clamp',
    ),
  }));

  const teamA = series?.franchise_a_id
    ? franchiseMap.get(series.franchise_a_id) ?? null
    : null;
  const teamB = series?.franchise_b_id
    ? franchiseMap.get(series.franchise_b_id) ?? null
    : null;
  const isSuperBowl = series?.round === 4;

  // Resolve which side of the game record (home/away) corresponds to series
  // teams a/b. Wikipedia-derived games use the convention franchise_a = away
  // / franchise_b = home, but neutral-site CC/SB swap freely so we resolve
  // by ID to be safe.
  const aIsHome = !!game && !!teamA && game.home_franchise_id === teamA.franchise_id;
  const aFinal = game ? (aIsHome ? game.home_score : game.away_score) : null;
  const bFinal = game ? (aIsHome ? game.away_score : game.home_score) : null;
  const winnerId = series?.winner_franchise_id ?? null;
  const aIsWinner = !!winnerId && winnerId === teamA?.franchise_id;
  const bIsWinner = !!winnerId && winnerId === teamB?.franchise_id;

  // Quarter scores per side. The DB stores home/away; remap to a/b based on
  // the home/away assignment of this series's franchise_a.
  const quarterArray = useMemo(() => {
    if (!game?.quarter_scores) return null;
    const q = game.quarter_scores;
    const aQs = aIsHome
      ? [q.q1_home, q.q2_home, q.q3_home, q.q4_home]
      : [q.q1_away, q.q2_away, q.q3_away, q.q4_away];
    const bQs = aIsHome
      ? [q.q1_away, q.q2_away, q.q3_away, q.q4_away]
      : [q.q1_home, q.q2_home, q.q3_home, q.q4_home];
    const aOt = aIsHome ? q.ot_home : q.ot_away;
    const bOt = aIsHome ? q.ot_away : q.ot_home;
    const hasAny = [...aQs, ...bQs, aOt, bOt].some((v) => v != null);
    if (!hasAny) return null;
    return { a: aQs, b: bQs, aOt, bOt };
  }, [game, aIsHome]);

  // Pull the passer line per side for the always-visible preview row, and
  // hold rusher/receiver for the expanded panel. Box rows arrive sorted by
  // rank from the RPC, so first match wins.
  const aBox = game?.box?.a ?? [];
  const bBox = game?.box?.b ?? [];
  const aPasser = aBox.find((r) => r.category === 'passer') ?? null;
  const bPasser = bBox.find((r) => r.category === 'passer') ?? null;

  return (
    <Animated.View
      ref={cardRef}
      onLayout={handleCardLayout}
      style={[
        styles.card,
        {
          backgroundColor: c.card,
          borderColor: isSuperBowl ? c.gold : c.border,
          ...cardShadow,
        },
        animatedCardStyle,
      ]}
    >
      {series && teamA && teamB && game && (
        <Animated.View
          pointerEvents={expanded ? 'auto' : 'none'}
          style={[styles.expandedSection, animatedSectionStyle]}
        >
          <ExpandedPanelContent
            teamA={teamA}
            teamB={teamB}
            aBox={aBox}
            bBox={bBox}
            aFinal={aFinal}
            bFinal={bFinal}
            aIsWinner={aIsWinner}
            bIsWinner={bIsWinner}
            c={c}
          />
          <View style={[styles.expandedDivider, { backgroundColor: c.border }]} />
        </Animated.View>
      )}
      {series && teamA && teamB && game ? (
        <Animated.View
          key={series.id}
          entering={FadeIn.duration(160)}
          exiting={FadeOut.duration(120)}
          style={styles.cardBody}
        >
          <View style={styles.eyebrowRow}>
            <View
              style={[
                styles.eyebrowRule,
                { backgroundColor: isSuperBowl ? c.gold : c.heritageGold },
              ]}
            />
            <ThemedText
              type="varsitySmall"
              style={[
                styles.eyebrow,
                { color: isSuperBowl ? c.gold : c.secondaryText },
              ]}
              accessibilityRole="header"
              numberOfLines={1}
            >
              {roundLabel(series)}
            </ThemedText>
            {scoreTag(series, game, franchiseMap) && (
              <ThemedText
                type="varsitySmall"
                style={[
                  styles.winnerTag,
                  { color: isSuperBowl ? c.gold : c.text },
                ]}
              >
                {scoreTag(series, game, franchiseMap)}
              </ThemedText>
            )}
            {isSuperBowl && (
              <Ionicons name="trophy" size={ms(12)} color={c.gold} accessible={false} />
            )}
            <TouchableOpacity
              onPress={() => setExpanded((v) => !v)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={expanded ? 'Hide top performers' : 'Show top performers'}
              accessibilityState={{ expanded }}
              style={styles.expandToggle}
            >
              <Ionicons
                name={expanded ? 'chevron-down' : 'chevron-up'}
                size={ms(16)}
                color={c.secondaryText}
                accessible={false}
              />
            </TouchableOpacity>
          </View>

          <TeamScoreRow
            franchise={teamA}
            seed={series.seed_a}
            quarters={quarterArray?.a ?? null}
            ot={quarterArray?.aOt ?? null}
            finalScore={aFinal}
            isWinner={aIsWinner}
            onPress={() => onTeamTap(teamA.franchise_id)}
            c={c}
          />
          <View style={[styles.divider, { backgroundColor: c.border }]} />
          <TeamScoreRow
            franchise={teamB}
            seed={series.seed_b}
            quarters={quarterArray?.b ?? null}
            ot={quarterArray?.bOt ?? null}
            finalScore={bFinal}
            isWinner={bIsWinner}
            onPress={() => onTeamTap(teamB.franchise_id)}
            c={c}
          />

          {(aPasser || bPasser) && (
            <View style={styles.passerBlock}>
              {aPasser && (
                <PasserLine
                  franchise={teamA}
                  passer={aPasser}
                  isWinner={aIsWinner}
                  c={c}
                />
              )}
              {bPasser && (
                <PasserLine
                  franchise={teamB}
                  passer={bPasser}
                  isWinner={bIsWinner}
                  c={c}
                />
              )}
            </View>
          )}

          {(game.played_on || game.venue || game.ot_periods > 0) && (
            <View style={styles.metaRow}>
              {game.played_on && (
                <ThemedText style={[styles.metaText, { color: c.secondaryText }]}>
                  {game.played_on}
                </ThemedText>
              )}
              {game.venue && (
                <ThemedText
                  style={[styles.metaText, { color: c.secondaryText, flex: 1 }]}
                  numberOfLines={1}
                >
                  {game.venue}
                </ThemedText>
              )}
              {game.ot_periods > 0 && (
                <ThemedText style={[styles.metaText, { color: c.gold }]}>
                  OT
                </ThemedText>
              )}
            </View>
          )}

          {isSuperBowl && winnerId && sbMvp ? (
            <View
              style={styles.mvpBlock}
              accessibilityLabel={`Super Bowl MVP: ${sbMvp.playerName}${sbMvp.statLine ? `, ${sbMvp.statLine}` : ''}`}
            >
              <View style={[styles.mvpDivider, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.mvpEyebrow, { color: c.gold }]}
              >
                SUPER BOWL MVP
              </ThemedText>
              <ThemedText
                style={[styles.mvpName, { color: c.text }]}
                numberOfLines={1}
              >
                {sbMvp.playerName}
              </ThemedText>
              {sbMvp.statLine ? (
                <ThemedText
                  style={[styles.mvpStatLine, { color: c.secondaryText }]}
                  numberOfLines={2}
                >
                  {sbMvp.statLine}
                </ThemedText>
              ) : null}
            </View>
          ) : null}
        </Animated.View>
      ) : (
        <View style={[styles.hintWrap, styles.cardBody]}>
          <ThemedText
            type="varsitySmall"
            style={[styles.hint, { color: c.secondaryText }]}
          >
            TAP A GAME TO SEE DETAILS
          </ThemedText>
        </View>
      )}
    </Animated.View>
  );
}

function TeamScoreRow({
  franchise,
  seed,
  quarters,
  ot,
  finalScore,
  isWinner,
  onPress,
  c,
}: {
  franchise: NflArchiveFranchiseSeason;
  seed: number | null;
  quarters: (number | null)[] | null;
  ot: number | null;
  finalScore: number | null;
  isWinner: boolean;
  onPress: () => void;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${franchise.city} ${franchise.name}, seed ${seed ?? '—'}, ${finalScore ?? 0} points${isWinner ? ', winner' : ''}. Tap for team details.`}
      style={[
        styles.teamRow,
        isWinner && { backgroundColor: c.goldMuted },
      ]}
    >
      <ArchiveTeamLogo
        franchiseId={franchise.franchise_id}
        tricode={franchise.tricode}
        primaryColor={franchise.primary_color}
        secondaryColor={franchise.secondary_color}
        logoKey={franchise.logo_key}
        size={s(32)}
        sport="nfl"
      />
      {seed != null && (
        <View style={[styles.seedBadge, { backgroundColor: c.cardAlt }]}>
          <ThemedText style={[styles.seedText, { color: c.secondaryText }]}>{seed}</ThemedText>
        </View>
      )}
      <View style={styles.labels}>
        <ThemedText
          style={[
            styles.cityName,
            { color: c.text, fontWeight: isWinner ? '700' : '500' },
          ]}
          numberOfLines={1}
        >
          {franchise.city}
        </ThemedText>
        <ThemedText
          style={[styles.teamName, { color: c.secondaryText }]}
          numberOfLines={1}
        >
          {franchise.name}
        </ThemedText>
      </View>
      {quarters && (
        <View style={styles.quarterStrip}>
          {quarters.map((q, i) => (
            <ThemedText
              key={i}
              style={[
                styles.quarterCell,
                { color: isWinner ? c.text : c.secondaryText, fontWeight: isWinner ? '700' : '500' },
              ]}
            >
              {q ?? '—'}
            </ThemedText>
          ))}
          {ot != null && (
            <ThemedText
              style={[
                styles.quarterCell,
                styles.otCell,
                { color: c.gold, fontWeight: '700' },
              ]}
            >
              {ot}
            </ThemedText>
          )}
        </View>
      )}
      <ThemedText
        style={[
          styles.finalScore,
          { color: isWinner ? c.gold : c.secondaryText, fontWeight: isWinner ? '700' : '500' },
        ]}
      >
        {finalScore ?? '—'}
      </ThemedText>
    </TouchableOpacity>
  );
}

function PasserLine({
  franchise,
  passer,
  isWinner,
  c,
}: {
  franchise: NflArchiveFranchiseSeason;
  passer: NflArchiveGameBoxLine;
  isWinner: boolean;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View style={styles.passerLine}>
      <ThemedText
        type="varsitySmall"
        style={[
          styles.passerTricode,
          { color: isWinner ? c.gold : c.secondaryText },
        ]}
      >
        {franchise.tricode}
      </ThemedText>
      <ThemedText
        style={[
          styles.passerName,
          { color: c.text, fontWeight: isWinner ? '700' : '600' },
        ]}
        numberOfLines={1}
      >
        {passer.player_name}
      </ThemedText>
      <ThemedText
        style={[styles.passerStatLine, { color: c.secondaryText }]}
        numberOfLines={1}
      >
        {passer.stat_line}
      </ThemedText>
    </View>
  );
}

// Vertical stack of two team blocks. Per team: header row (logo + tricode +
// final score) followed by per-category rows (RUSH / REC / DEF). Mirrors
// NBA's TeamBlock structure but with NFL's free-form `stat_line` instead of
// the structured 7-column stat grid.
function ExpandedPanelContent({
  teamA,
  teamB,
  aBox,
  bBox,
  aFinal,
  bFinal,
  aIsWinner,
  bIsWinner,
  c,
}: {
  teamA: NflArchiveFranchiseSeason;
  teamB: NflArchiveFranchiseSeason;
  aBox: NflArchiveGameBoxLine[];
  bBox: NflArchiveGameBoxLine[];
  aFinal: number | null;
  bFinal: number | null;
  aIsWinner: boolean;
  bIsWinner: boolean;
  c: ReturnType<typeof useArchiveColors>;
}) {
  const hasAny = aBox.length > 0 || bBox.length > 0;
  if (!hasAny) {
    return (
      <View style={styles.expandedInner}>
        <ThemedText style={[styles.expandedEmpty, { color: c.secondaryText }]}>
          Top-performer data not curated for this game.
        </ThemedText>
      </View>
    );
  }
  return (
    <View style={styles.expandedInner}>
      <TeamLeadersBlock
        franchise={teamA}
        score={aFinal}
        isWinner={aIsWinner}
        rows={filterAndOrder(aBox)}
        c={c}
      />
      <TeamLeadersBlock
        franchise={teamB}
        score={bFinal}
        isWinner={bIsWinner}
        rows={filterAndOrder(bBox)}
        c={c}
      />
    </View>
  );
}

// In the expanded panel we surface the rusher/receiver/defense rows. The
// passer is already covered in the always-visible preview, so we drop it
// here to avoid repeating the same name twice. Order: rusher, receiver,
// defense, kicker — readers expect a top-to-bottom skill arc.
const CATEGORY_ORDER: { key: string; label: string }[] = [
  { key: 'rusher', label: 'RUSH' },
  { key: 'receiver', label: 'REC' },
  { key: 'defense', label: 'DEF' },
  { key: 'kicker', label: 'K' },
  { key: 'returner', label: 'RET' },
  { key: 'team', label: 'TEAM' },
];

function filterAndOrder(rows: NflArchiveGameBoxLine[]): NflArchiveGameBoxLine[] {
  const ordered: NflArchiveGameBoxLine[] = [];
  for (const cat of CATEGORY_ORDER) {
    for (const r of rows) {
      if (r.category === cat.key) ordered.push(r);
    }
  }
  return ordered;
}

function categoryLabel(category: string): string {
  return CATEGORY_ORDER.find((cat) => cat.key === category)?.label ?? category.toUpperCase();
}

function TeamLeadersBlock({
  franchise,
  score,
  isWinner,
  rows,
  c,
}: {
  franchise: NflArchiveFranchiseSeason;
  score: number | null;
  isWinner: boolean;
  rows: NflArchiveGameBoxLine[];
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <View style={styles.teamBlock}>
      <View style={[styles.teamBlockHeader, { borderBottomColor: c.border }]}>
        <ArchiveTeamLogo
          franchiseId={franchise.franchise_id}
          tricode={franchise.tricode}
          primaryColor={franchise.primary_color}
          secondaryColor={franchise.secondary_color}
          logoKey={franchise.logo_key}
          size={s(18)}
          sport="nfl"
        />
        <ThemedText
          type="varsitySmall"
          style={[styles.teamBlockTricode, { color: c.text }]}
        >
          {franchise.tricode}
        </ThemedText>
        <ThemedText
          style={[styles.teamBlockSpacer, { color: c.secondaryText }]}
          numberOfLines={1}
        >
          {franchise.name}
        </ThemedText>
        {score != null && (
          <ThemedText
            style={[
              styles.teamBlockScore,
              { color: isWinner ? c.gold : c.text },
            ]}
          >
            {score}
          </ThemedText>
        )}
      </View>
      {rows.map((r, i) => (
        <Fragment key={`${r.category}-${i}`}>
          <View
            style={[
              styles.leaderRow,
              i % 2 === 1 && { backgroundColor: c.cardAlt },
            ]}
          >
            <ThemedText
              type="varsitySmall"
              style={[styles.leaderCategory, { color: c.heritageGold }]}
            >
              {categoryLabel(r.category)}
            </ThemedText>
            <ThemedText
              style={[styles.leaderName, { color: c.text }]}
              numberOfLines={1}
            >
              {r.player_name}
            </ThemedText>
            <ThemedText
              style={[styles.leaderStatLine, { color: c.secondaryText }]}
              numberOfLines={1}
            >
              {r.stat_line}
            </ThemedText>
          </View>
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  expandedSection: {
    overflow: 'hidden',
    marginHorizontal: -s(12),
  },
  expandedDivider: {
    height: StyleSheet.hairlineWidth,
  },
  expandedInner: {
    flex: 1,
    paddingHorizontal: s(10),
    paddingTop: s(14),
    paddingBottom: s(2),
  },
  expandedEmpty: {
    fontSize: ms(11),
    fontStyle: 'italic',
  },

  teamBlock: {
    marginBottom: s(8),
  },
  teamBlockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingBottom: s(3),
    minHeight: s(24),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamBlockTricode: {
    fontSize: ms(12),
    letterSpacing: 0.8,
    fontWeight: '700',
  },
  teamBlockSpacer: {
    flex: 1,
    fontSize: ms(11),
    paddingHorizontal: s(4),
  },
  teamBlockScore: {
    fontFamily: Fonts.mono,
    fontSize: ms(15),
    fontWeight: '800',
    marginLeft: 'auto',
    letterSpacing: -0.3,
  },

  leaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(4),
    paddingHorizontal: s(2),
    gap: s(8),
  },
  leaderCategory: {
    fontSize: ms(9),
    letterSpacing: 1.0,
    minWidth: s(36),
    textAlign: 'left',
  },
  leaderName: {
    fontSize: ms(12),
    fontWeight: '600',
    minWidth: s(80),
    flexShrink: 0,
  },
  leaderStatLine: {
    fontSize: ms(11),
    flex: 1,
    minWidth: 0,
    textAlign: 'right',
  },

  expandToggle: {
    paddingHorizontal: s(2),
  },

  card: {
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: s(12),
    overflow: 'hidden',
    zIndex: 100,
    elevation: 100,
  },
  cardBody: {
    paddingVertical: s(10),
  },

  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(6),
  },
  eyebrowRule: {
    height: 2,
    width: s(18),
  },
  eyebrow: {
    fontSize: ms(10),
    letterSpacing: 1.3,
    flex: 1,
  },
  winnerTag: {
    fontSize: ms(10),
    letterSpacing: 1.0,
    fontWeight: '700',
    fontFamily: Fonts.mono,
  },

  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(6),
    gap: s(8),
    borderRadius: 8,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },

  // Per-team passer line, sits below the two team rows. Shows the team's
  // tricode + QB name + raw stat_line. Two-line block when both sides have
  // a passer recorded.
  passerBlock: {
    marginTop: s(8),
    paddingTop: s(8),
    paddingHorizontal: s(4),
    gap: s(4),
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(0,0,0,0.05)',
  },
  passerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  passerTricode: {
    fontSize: ms(10),
    letterSpacing: 1.0,
    minWidth: s(36),
  },
  passerName: {
    fontSize: ms(13),
    minWidth: s(96),
  },
  passerStatLine: {
    flex: 1,
    fontSize: ms(11),
    textAlign: 'right',
    minWidth: 0,
    fontFamily: Fonts.mono,
    letterSpacing: -0.2,
  },

  // Below the passer block — date / venue / OT chip. Single-row meta.
  metaRow: {
    marginTop: s(8),
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingHorizontal: s(4),
  },
  metaText: {
    fontSize: ms(10),
    letterSpacing: 0.4,
  },

  mvpBlock: {
    paddingTop: s(8),
    paddingBottom: s(2),
    paddingHorizontal: s(4),
  },
  mvpDivider: {
    height: 1,
    opacity: 0.5,
    marginBottom: s(8),
  },
  mvpEyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  mvpName: {
    fontSize: ms(15),
    fontWeight: '700',
    letterSpacing: -0.2,
    marginTop: 2,
  },
  mvpStatLine: {
    fontSize: ms(11),
    letterSpacing: 0.2,
    marginTop: 2,
  },

  seedBadge: {
    width: s(22),
    height: s(22),
    borderRadius: s(11),
    alignItems: 'center',
    justifyContent: 'center',
  },
  seedText: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    fontWeight: '700',
  },
  labels: {
    flex: 1,
    minWidth: 0,
  },
  cityName: {
    fontSize: ms(15),
    lineHeight: ms(18),
  },
  teamName: {
    fontSize: ms(11),
    lineHeight: ms(13),
    marginTop: 1,
  },

  // Compact 4-quarter score strip on the right side of each team row. Each
  // quarter cell has a fixed minWidth so the column lines up across the two
  // team rows. OT cell is conditional and visually distinct (gold color).
  quarterStrip: {
    flexDirection: 'row',
    gap: s(2),
    alignItems: 'center',
  },
  quarterCell: {
    fontFamily: Fonts.mono,
    fontVariant: ['tabular-nums'],
    fontSize: ms(11),
    minWidth: s(18),
    textAlign: 'center',
    letterSpacing: -0.3,
  },
  otCell: {
    minWidth: s(18),
  },
  finalScore: {
    fontFamily: Fonts.mono,
    fontSize: ms(20),
    fontVariant: ['tabular-nums'],
    minWidth: s(32),
    textAlign: 'right',
    paddingLeft: s(6),
    letterSpacing: -0.3,
  },

  hintWrap: {
    flex: 1,
    minHeight: s(126),
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontSize: ms(10),
    letterSpacing: 1.3,
  },
});
