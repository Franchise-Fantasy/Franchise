import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLeagueRosterStats } from '@/hooks/useLeagueRosterStats';
import {
  buildLeagueComparison,
  calculateRosterAgeProfile,
  getInsightText,
} from '@/utils/rosterAge';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '../ThemedText';

export function AnalyticsPreviewCard({ leagueId }: { leagueId: string }) {
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
        <ActivityIndicator style={styles.loading} />
      ) : !profile || profile.totalWithAge < 3 ? (
        <ThemedText style={[styles.placeholderText, { color: c.secondaryText }]}>
          Not enough age data available
        </ThemedText>
      ) : (
        <>
          {/* Pills row */}
          <View style={styles.pillRow}>
            {/* Weighted Age pill */}
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

            {/* League Rank pill */}
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

            {/* VS League pill */}
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

          {/* Insight text */}
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
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 14,
    marginBottom: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  pillRow: {
    flexDirection: 'row',
    gap: 8,
  },
  pill: {
    flex: 1,
    borderRadius: 10,
    paddingVertical: 7,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  pillLabel: {
    fontSize: 8,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  pillValue: {
    fontSize: 18,
    fontWeight: '700',
  },
  pillSub: {
    fontSize: 9,
    fontWeight: '500',
    marginTop: 1,
  },
  insight: {
    fontSize: 11,
    marginTop: 10,
    lineHeight: 16,
  },
  placeholderText: {
    fontSize: 13,
    textAlign: 'center',
    paddingVertical: 8,
  },
  loading: {
    paddingVertical: 12,
  },
});
