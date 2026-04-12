import { Colors, cardShadowMedium } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { ms, s } from '@/utils/scale';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLeagueRosterStats } from '@/hooks/useLeagueRosterStats';
import {
  buildLeagueComparison,
  calculateRosterAgeProfile,
  getInsightText,
} from '@/utils/rosterAge';
import {
  computeTeamCategoryAvgs,
  computeTeamZScores,
  CAT_ORDER,
} from '@/utils/categoryAnalytics';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '../ui/ThemedText';

export function AnalyticsPreviewCard({ leagueId, scoringType }: { leagueId: string; scoringType?: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDark = scheme === 'dark';
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

  const insight = useMemo(() => {
    if (!profile) return '';
    return getInsightText(profile, comparison);
  }, [profile, comparison]);

  const isCategories = scoringType === 'h2h_categories';

  const teamAvgs = useMemo(() => {
    if (!isCategories || !allPlayers?.length) return null;
    return computeTeamCategoryAvgs(allPlayers as any);
  }, [isCategories, allPlayers]);

  const zScores = useMemo(() => {
    if (!teamAvgs || !teamId) return null;
    return computeTeamZScores(teamAvgs, teamId);
  }, [teamAvgs, teamId]);

  const topStrengths = useMemo(() => {
    if (!zScores?.length) return [];
    return [...zScores].sort((a, b) => b.zScore - a.zScore).slice(0, 3);
  }, [zScores]);

  const topWeaknesses = useMemo(() => {
    if (!zScores?.length) return [];
    return [...zScores].sort((a, b) => a.zScore - b.zScore).slice(0, 3);
  }, [zScores]);

  if (!teamId) return null;

  const isLoading = loadingPlayers || loadingScoring;
  const skewsOlder = profile ? profile.weightedProductionAge > profile.avgAge : false;
  const prodColor = isDark
    ? skewsOlder ? '#818CF8' : '#60A5FA'
    : skewsOlder ? '#6366F1' : '#2563EB';

  const vsLeague = comparison
    ? profile!.weightedProductionAge - comparison.leagueAvgWeightedAge
    : null;

  return (
    <TouchableOpacity
      style={[styles.card, {
        backgroundColor: isDark ? 'rgba(96,165,250,0.06)' : 'rgba(96,165,250,0.05)',
        borderColor: isDark ? 'rgba(96,165,250,0.15)' : 'rgba(96,165,250,0.2)',
        ...cardShadowMedium,
      }]}
      onPress={() => router.push('/analytics' as any)}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel="Roster Analytics preview. Tap to view full analytics"
    >
      {/* Header */}
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Ionicons
            name="analytics"
            size={16}
            color={isDark ? '#60A5FA' : '#2563EB'}
            accessible={false}
          />
          <Text style={[styles.headerLabel, { color: isDark ? '#60A5FA' : '#2563EB' }]}>
            ROSTER ANALYTICS
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
      </View>

      {isLoading ? (
        <View style={styles.loading}><LogoSpinner /></View>
      ) : isCategories && topStrengths.length > 0 ? (
        <>
          {/* CAT strengths / weaknesses */}
          <View style={styles.pillRow}>
            <View style={[styles.pill, { flex: 1, backgroundColor: isDark ? 'rgba(52,211,153,0.08)' : 'rgba(16,185,129,0.06)', borderWidth: 1, borderColor: isDark ? 'rgba(52,211,153,0.15)' : 'rgba(16,185,129,0.15)' }]}>
              <Text style={[styles.pillLabel, { color: c.secondaryText }]}>STRENGTHS</Text>
              {topStrengths.map((s) => (
                <View key={s.cat} style={styles.zRow}>
                  <ThemedText style={styles.zCat}>{s.cat}</ThemedText>
                  <Text style={[styles.zValue, { color: isDark ? '#6EE7B7' : '#059669' }]}>
                    {s.zScore >= 0 ? '+' : ''}{s.zScore.toFixed(1)}
                  </Text>
                </View>
              ))}
            </View>
            <View style={[styles.pill, { flex: 1, backgroundColor: isDark ? 'rgba(248,113,113,0.08)' : 'rgba(239,68,68,0.06)', borderWidth: 1, borderColor: isDark ? 'rgba(248,113,113,0.15)' : 'rgba(239,68,68,0.15)' }]}>
              <Text style={[styles.pillLabel, { color: c.secondaryText }]}>WEAKNESSES</Text>
              {topWeaknesses.map((s) => (
                <View key={s.cat} style={styles.zRow}>
                  <ThemedText style={styles.zCat}>{s.cat}</ThemedText>
                  <Text style={[styles.zValue, { color: isDark ? '#FCA5A5' : '#DC2626' }]}>
                    {s.zScore >= 0 ? '+' : ''}{s.zScore.toFixed(1)}
                  </Text>
                </View>
              ))}
            </View>
          </View>
        </>
      ) : !profile || profile.totalWithAge < 3 ? (
        <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
          Not enough age data available
        </ThemedText>
      ) : (
        <>
          {/* Points league: age pills */}
          <View style={styles.pillRow}>
            <View style={[styles.pill, {
              backgroundColor: skewsOlder
                ? (isDark ? 'rgba(129,140,248,0.08)' : 'rgba(99,102,241,0.06)')
                : (isDark ? 'rgba(96,165,250,0.08)' : 'rgba(37,99,235,0.06)'),
              borderWidth: 1,
              borderColor: skewsOlder
                ? (isDark ? 'rgba(129,140,248,0.15)' : 'rgba(99,102,241,0.15)')
                : (isDark ? 'rgba(96,165,250,0.15)' : 'rgba(37,99,235,0.15)'),
            }]}>
              <Text style={[styles.pillLabel, { color: c.secondaryText }]}>
                WEIGHTED AGE
              </Text>
              <Text style={[styles.pillValue, { color: prodColor }]}>
                {profile.weightedProductionAge}
              </Text>
            </View>

            <View style={[styles.pill, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            }]}>
              <Text style={[styles.pillLabel, { color: c.secondaryText }]}>
                LEAGUE RANK
              </Text>
              <ThemedText style={styles.pillValue}>
                {comparison ? `#${comparison.weightedAgeRank}` : '—'}
              </ThemedText>
              {comparison && (
                <Text style={[styles.pillSub, { color: c.secondaryText }]}>
                  of {comparison.totalTeams}
                </Text>
              )}
            </View>

            <View style={[styles.pill, {
              backgroundColor: isDark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
            }]}>
              <Text style={[styles.pillLabel, { color: c.secondaryText }]}>
                VS LEAGUE
              </Text>
              <ThemedText style={styles.pillValue}>
                {vsLeague !== null
                  ? `${vsLeague >= 0 ? '+' : ''}${vsLeague.toFixed(1)}`
                  : '—'}
              </ThemedText>
              {vsLeague !== null && (
                <Text style={[styles.pillSub, { color: c.secondaryText }]}>
                  yr
                </Text>
              )}
            </View>
          </View>

          <Text style={[styles.insight, { color: c.secondaryText }]}>
            {insight}
          </Text>
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(14),
    marginBottom: s(16),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(12),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  headerLabel: {
    fontSize: ms(11),
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  pillRow: {
    flexDirection: 'row',
    gap: s(8),
  },
  pill: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: s(7),
    paddingHorizontal: s(8),
    alignItems: 'center',
  },
  pillLabel: {
    fontSize: ms(8),
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: s(2),
  },
  pillValue: {
    fontSize: ms(18),
    fontWeight: '700',
  },
  pillSub: {
    fontSize: ms(9),
    fontWeight: '500',
    marginTop: s(1),
  },
  insight: {
    fontSize: ms(11),
    marginTop: s(10),
    lineHeight: ms(16),
  },
  placeholderText: {
    fontSize: ms(13),
    textAlign: 'center',
    paddingVertical: s(8),
  },
  loading: {
    paddingVertical: s(12),
  },
  zRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(2),
  },
  zCat: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  zValue: {
    fontSize: ms(12),
    fontWeight: '700',
  },
});
