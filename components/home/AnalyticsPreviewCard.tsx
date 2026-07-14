import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Platform, StyleSheet, TouchableOpacity, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { cardShadow } from '@/constants/Colors';
import { type Sport } from '@/constants/LeagueDefaults';
import { useAppState } from '@/context/AppStateProvider';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueRosterStats } from '@/hooks/useLeagueRosterStats';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePrevSeasonFpts } from '@/hooks/usePrevSeasonFpts';
import { ordinalSuffix } from '@/utils/formatting';
import {
  buildLeagueComparison,
  calculateRosterAgeProfile,
} from '@/utils/roster/rosterAge';
import { isActiveRosterSlot } from '@/utils/roster/rosterSlots';
import { buildLeagueStrengthComparison } from '@/utils/roster/rosterStrength';
import { ms, s } from '@/utils/scale';
import {
  computeTeamCategoryAvgs,
  computeTeamZScores,
} from '@/utils/scoring/categoryAnalytics';
import { ANALYTICS_MIN_CURRENT_SEASON_GAMES } from '@/utils/scoring/fantasyPoints';

import { IconSymbol } from '../ui/IconSymbol';
import { ThemedText } from '../ui/ThemedText';

/**
 * Analytics preview — one solid card matching the rest of the home
 * surfaces (no nested pill sub-cards). Two columns separated by a thin
 * rule: a primary stat on the left, a framing counterpart on the right.
 * A heritage-gold notch up top echoes the hero's gold notch. It stays
 * in the gold family on purpose — out of the sport-accent (red/green)
 * range — so it never collides with the danger/success stat colors
 * below (e.g. WNBA's dark-mode tint and danger are both reds).
 */
export function AnalyticsPreviewCard({
  leagueId,
  scoringType,
}: {
  leagueId: string;
  scoringType?: string;
}) {
  const c = useColors();
  const router = useRouter();
  const { teamId } = useAppState();

  const { data: league } = useLeague();
  const { data: allPlayers, isLoading: loadingPlayers } = useLeagueRosterStats(leagueId);
  const { data: weights, isLoading: loadingScoring } = useLeagueScoring(leagueId);

  // Same prev-season fpts fallback the full analytics screen uses, so
  // pre-tipoff WNBA / first-month NBA / categories leagues compute the
  // exact same weighted age in both places. Without this the preview's
  // weighted age silently diverges from the screen the user navigates to.
  const allPlayerIds = useMemo(
    () => (allPlayers ?? []).map((p) => p.player_id),
    [allPlayers],
  );
  const sport: Sport = (league?.sport as Sport | undefined) ?? 'nba';
  const { data: prevSeasonFptsMap, isLoading: loadingPrevSeason } = usePrevSeasonFpts(
    leagueId,
    sport,
    allPlayerIds,
    weights,
  );

  const myPlayers = useMemo(
    () => allPlayers?.filter((p) => p.team_id === teamId) ?? [],
    [allPlayers, teamId],
  );

  const profile = useMemo(() => {
    if (!myPlayers.length || !weights?.length) return null;
    return calculateRosterAgeProfile(myPlayers, weights, prevSeasonFptsMap, ANALYTICS_MIN_CURRENT_SEASON_GAMES, sport);
  }, [myPlayers, weights, prevSeasonFptsMap]);

  const comparison = useMemo(() => {
    if (!allPlayers?.length || !weights?.length || !teamId) return null;
    return buildLeagueComparison(
      allPlayers as any,
      weights,
      teamId,
      prevSeasonFptsMap,
      ANALYTICS_MIN_CURRENT_SEASON_GAMES,
      sport,
    );
  }, [allPlayers, weights, teamId, prevSeasonFptsMap, sport]);

  const isCategories = scoringType === 'h2h_categories';
  const isDynasty = (league?.league_type ?? 'dynasty') === 'dynasty';

  // Single-year (keeper/redraft) points leagues show roster strength instead
  // of weighted age. Skipped for dynasty (age columns) and categories
  // (strongest/weakest cats), so neither pays for the extra grouping pass.
  const strength = useMemo(() => {
    if (isDynasty || isCategories || !allPlayers?.length || !weights?.length || !teamId) {
      return null;
    }
    return buildLeagueStrengthComparison(allPlayers as any, weights, teamId, {
      prevSeasonFptsMap,
      minGames: ANALYTICS_MIN_CURRENT_SEASON_GAMES,
      sport,
    });
  }, [isDynasty, isCategories, allPlayers, weights, teamId, prevSeasonFptsMap, sport]);

  const teamAvgs = useMemo(() => {
    if (!isCategories || !allPlayers?.length) return null;
    // Exclude IR/TAXI so category strength reflects the active roster (matches
    // the full analytics screen's radar).
    return computeTeamCategoryAvgs(
      (allPlayers as any[]).filter((p) => isActiveRosterSlot(p.roster_slot)),
    );
  }, [isCategories, allPlayers]);

  const zScores = useMemo(() => {
    if (!teamAvgs || !teamId) return null;
    return computeTeamZScores(teamAvgs, teamId);
  }, [teamAvgs, teamId]);

  const bestCategory = useMemo(() => {
    if (!zScores?.length) return null;
    return [...zScores].sort((a, b) => b.zScore - a.zScore)[0];
  }, [zScores]);

  const worstCategory = useMemo(() => {
    if (!zScores?.length) return null;
    return [...zScores].sort((a, b) => a.zScore - b.zScore)[0];
  }, [zScores]);

  // "4th youngest of 10" / "3rd oldest of 10" — phrased from whichever
  // end of the age scale is shorter for this team, so the number is
  // always a small, easily-parsed position.
  const { rankValue, rankSub } = useMemo(() => {
    if (!comparison) return { rankValue: '—', rankSub: '' };
    const rank = comparison.weightedAgeRank; // 1 = youngest
    const total = comparison.totalTeams;
    const fromYoungest = rank <= Math.ceil(total / 2);
    const n = fromYoungest ? rank : total - rank + 1;
    return {
      rankValue: `${n}${ordinalSuffix(n)}`,
      rankSub: `${fromYoungest ? 'youngest' : 'oldest'} of ${total}`,
    };
  }, [comparison]);

  if (!teamId) return null;

  // Roster-strength and weighted-age both fall back to prev-season FPTS for
  // players under the games threshold, and that map loads *after* players +
  // scoring (it keys off their player ids). Rendering before it settles shows a
  // number computed without the fallback that then visibly jumps when it lands —
  // so the rank changes between two opens depending on whether the cache was
  // warm. Wait for it too, but only where it's actually read: not categories
  // (which don't use it), and only with a roster + weights to compute (so an
  // empty or still-loading league never blocks on a query that's disabled).
  const needsPrevSeason = !isCategories && !!allPlayers?.length && !!weights?.length;
  const isLoading =
    loadingPlayers || loadingScoring || (needsPrevSeason && loadingPrevSeason);
  const vsLeague = comparison
    ? profile!.weightedProductionAge - comparison.leagueAvgWeightedAge
    : null;

  // Whether the card has enough data to bother navigating into the full
  // analytics screen. Empty/loading states shouldn't be tappable — there's
  // nothing behind the tap and the affordance is misleading.
  const hasData =
    !isLoading &&
    (isCategories
      ? !!bestCategory && !!worstCategory
      : isDynasty
        ? !!profile && profile.totalWithAge >= 3
        : !!strength);

  const CardWrapper = hasData ? TouchableOpacity : View;
  const wrapperProps = hasData
    ? {
        onPress: () => router.push('/analytics' as never),
        activeOpacity: 0.78,
        accessibilityRole: 'button' as const,
        accessibilityLabel: 'Analytics preview. Tap to view full analytics',
      }
    : {};

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" style={{ color: c.text }}>
          Analytics
        </ThemedText>
      </View>

      <CardWrapper
        style={[
          styles.card,
          {
            // Heritage gold surface — the older olive-leaning gold, at
            // low opacity. Warmer than Vintage Gold and doesn't fight
            // with the ecru page around it. Heritage-gold notch (solid,
            // same hue family) + ecru text keep the read legible.
            backgroundColor: c.heritageGoldMuted,
            borderColor: c.border,
            ...cardShadow,
            // Android elevation renders a hard halo on tinted bg; iOS shadow is fine
            ...(Platform.OS === 'android' && { elevation: 0 }),
          },
        ]}
        {...wrapperProps}
      >
        <View style={[styles.topRule, { backgroundColor: c.heritageGold }]} />

        {/* Fixed-height content well. All states (loading/empty/data)
            render into the same reserved box so the card doesn't flicker
            height as the data resolves. */}
        <View style={styles.contentWell}>
          {isLoading ? (
            <LogoSpinner />
          ) : isCategories && bestCategory && worstCategory ? (
            <View style={styles.dataRow}>
              <Column
                label="Strongest"
                bigValue={bestCategory.cat}
                subValue={`${bestCategory.zScore >= 0 ? '+' : ''}${bestCategory.zScore.toFixed(1)}`}
                bigColor={c.success}
                subColor={c.secondaryText}
                labelColor={c.secondaryText}
              />
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Column
                label="Weakest"
                bigValue={worstCategory.cat}
                subValue={`${worstCategory.zScore >= 0 ? '+' : ''}${worstCategory.zScore.toFixed(1)}`}
                bigColor={c.danger}
                subColor={c.secondaryText}
                labelColor={c.secondaryText}
              />
            </View>
          ) : !isDynasty ? (
            strength ? (
              <View style={styles.dataRow}>
                <Column
                  label="Roster Strength"
                  bigValue={`${strength.myRank}${ordinalSuffix(strength.myRank)}`}
                  subValue={`of ${strength.totalTeams}`}
                  bigColor={c.text}
                  subColor={c.secondaryText}
                  labelColor={c.secondaryText}
                />
                <View style={[styles.divider, { backgroundColor: c.border }]} />
                <Column
                  label="vs League"
                  bigValue={`${strength.myAvgFpts - strength.leagueAvgFpts >= 0 ? '+' : ''}${(strength.myAvgFpts - strength.leagueAvgFpts).toFixed(1)}`}
                  subValue="FPTS/G vs avg"
                  bigColor={c.text}
                  subColor={c.secondaryText}
                  labelColor={c.secondaryText}
                />
              </View>
            ) : (
              <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
                Not enough league data available
              </ThemedText>
            )
          ) : !profile || profile.totalWithAge < 3 ? (
            <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
              Not enough age data available
            </ThemedText>
          ) : (
            <View style={styles.dataRow}>
              <Column
                label="Weighted Age"
                bigValue={String(profile.weightedProductionAge)}
                subValue={
                  vsLeague !== null
                    ? `${vsLeague >= 0 ? '+' : ''}${vsLeague.toFixed(1)}yr vs avg`
                    : undefined
                }
                bigColor={c.text}
                subColor={c.secondaryText}
                labelColor={c.secondaryText}
              />
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Column
                label="League Position"
                bigValue={rankValue}
                subValue={rankSub || undefined}
                bigColor={c.text}
                subColor={c.secondaryText}
                labelColor={c.secondaryText}
              />
            </View>
          )}
        </View>

        {hasData && (
          <View style={styles.tapHint}>
            <ThemedText
              type="varsitySmall"
              style={[styles.tapHintText, { color: c.secondaryText }]}
            >
              Tap for full breakdown
            </ThemedText>
            <IconSymbol name="arrow.right" size={12} color={c.secondaryText} />
          </View>
        )}
      </CardWrapper>
    </View>
  );
}

function Column({
  label,
  bigValue,
  subValue,
  labelColor,
  bigColor,
  subColor,
}: {
  label: string;
  bigValue: string;
  subValue?: string;
  labelColor: string;
  bigColor: string;
  subColor: string;
}) {
  return (
    <View style={styles.column}>
      <ThemedText type="varsitySmall" style={[styles.colLabel, { color: labelColor }]}>
        {label}
      </ThemedText>
      <ThemedText
        type="display"
        style={[styles.colBig, { color: bigColor }]}
        numberOfLines={1}
      >
        {bigValue}
      </ThemedText>
      {subValue !== undefined && (
        <ThemedText type="varsitySmall" style={[styles.colSub, { color: subColor }]}>
          {subValue}
        </ThemedText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: s(18),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(10),
    gap: s(10),
  },
  rule: {
    height: 2,
    width: s(18),
  },
  card: {
    position: 'relative',
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: s(16),
    paddingTop: s(18),
    paddingBottom: s(12),
    overflow: 'hidden',
    // Match the data-state height so loading/empty/data renders don't
    // reflow the surrounding scroll.
    minHeight: s(120),
  },
  topRule: {
    position: 'absolute',
    top: 0,
    left: s(16),
    height: 3,
    width: s(44),
  },
  // Flex-fills the card's vertical space so loading/empty states center
  // across the full card, not just a small reserved box. When the tap
  // hint is present it sits in the remaining flex row below.
  contentWell: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'stretch',
  },
  dataRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  column: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingHorizontal: s(4),
  },
  divider: {
    width: 1,
    marginHorizontal: s(10),
  },
  colLabel: {
    marginBottom: s(4),
    fontSize: ms(9.5),
  },
  colBig: {
    fontSize: ms(26),
    lineHeight: ms(30),
    letterSpacing: -0.3,
    marginBottom: s(2),
  },
  colSub: {
    fontSize: ms(10),
    letterSpacing: 0.3,
  },
  tapHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    marginTop: s(14),
  },
  tapHintText: {
    fontSize: ms(9.5),
  },
  placeholderText: {
    fontSize: ms(13),
    textAlign: 'center',
  },
});
