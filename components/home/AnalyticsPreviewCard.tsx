import { Brand, Colors, cardShadow } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { ms, s } from '@/utils/scale';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLeagueRosterStats } from '@/hooks/useLeagueRosterStats';
import {
  buildLeagueComparison,
  calculateRosterAgeProfile,
} from '@/utils/rosterAge';
import {
  computeTeamCategoryAvgs,
  computeTeamZScores,
} from '@/utils/categoryAnalytics';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '../ui/ThemedText';
import { IconSymbol } from '../ui/IconSymbol';

/**
 * Analytics preview — one solid card matching the rest of the home
 * surfaces (no nested pill sub-cards). Two columns separated by a thin
 * rule: a primary stat on the left, a framing counterpart on the right.
 * A Turf Green notch up top echoes the hero's gold notch without
 * repeating the hero's color — keeps the screen from feeling monotone.
 */
export function AnalyticsPreviewCard({
  leagueId,
  scoringType,
}: {
  leagueId: string;
  scoringType?: string;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const { teamId } = useAppState();

  const { data: allPlayers, isLoading: loadingPlayers } = useLeagueRosterStats(leagueId);
  const { data: weights, isLoading: loadingScoring } = useLeagueScoring(leagueId);

  const myPlayers = useMemo(
    () => allPlayers?.filter((p) => p.team_id === teamId) ?? [],
    [allPlayers, teamId],
  );

  const profile = useMemo(() => {
    if (!myPlayers.length || !weights?.length) return null;
    return calculateRosterAgeProfile(myPlayers, weights);
  }, [myPlayers, weights]);

  const comparison = useMemo(() => {
    if (!allPlayers?.length || !weights?.length || !teamId) return null;
    return buildLeagueComparison(allPlayers as any, weights, teamId);
  }, [allPlayers, weights, teamId]);

  const isCategories = scoringType === 'h2h_categories';

  const teamAvgs = useMemo(() => {
    if (!isCategories || !allPlayers?.length) return null;
    return computeTeamCategoryAvgs(allPlayers as any);
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

  const isLoading = loadingPlayers || loadingScoring;
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
      : !!profile && profile.totalWithAge >= 3);

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
            // with the ecru page around it. Turf Green notch + ink text
            // keep the read legible.
            backgroundColor: c.heritageGoldMuted,
            borderColor: c.border,
            ...cardShadow,
          },
        ]}
        {...wrapperProps}
      >
        <View style={[styles.topRule, { backgroundColor: Brand.turfGreen }]} />

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
                bigColor={Brand.turfGreen}
                subColor={Brand.turfGreen}
                labelColor={c.secondaryText}
              />
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <Column
                label="Weakest"
                bigValue={worstCategory.cat}
                subValue={`${worstCategory.zScore >= 0 ? '+' : ''}${worstCategory.zScore.toFixed(1)}`}
                bigColor={c.danger}
                subColor={c.danger}
                labelColor={c.secondaryText}
              />
            </View>
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

function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
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
    borderWidth: 1,
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
