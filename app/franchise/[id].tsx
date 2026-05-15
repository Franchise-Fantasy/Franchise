import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArchiveTeamLogo } from '@/components/playoff-archive/ArchiveTeamLogo';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import {
  useArchiveFranchiseHistory,
  useArchiveSeasons,
} from '@/hooks/useArchivePlayoffs';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import { supabase } from '@/lib/supabase';
import type { ArchiveFranchiseHistoryRow } from '@/types/archivePlayoff';
import { ms, s } from '@/utils/scale';
import { useQuery } from '@tanstack/react-query';

// Per-franchise metadata for the page header (modern logo + display name).
// Pulled from the most-recent pro_franchise_season row so we always have
// current branding regardless of which historical era the user lands on.
function useFranchiseMeta(franchiseId: string | null | undefined) {
  return useQuery({
    queryKey: ['franchiseMeta', franchiseId ?? ''],
    enabled: !!franchiseId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pro_franchise_season')
        .select('city, name, tricode, primary_color, secondary_color, logo_key, season')
        .eq('franchise_id', franchiseId as string)
        .order('season', { ascending: false })
        .limit(1)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60 * 60 * 1000,
  });
}

const ROUND_LABELS: Record<number, string> = {
  1: 'R1',
  2: 'Semis',
  3: 'Conf F',
  4: 'Finals',
};

// e.g. "2024-25" from end-year season int.
function seasonLabel(season: number): string {
  const endShort = season.toString().slice(-2);
  return `${season - 1}-${endShort}`;
}

export default function FranchisePage() {
  const c = useArchiveColors();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const { data: meta } = useFranchiseMeta(id);
  const { data: history, isLoading } = useArchiveFranchiseHistory(id);
  const { data: seasons } = useArchiveSeasons();

  // Determine the latest season known to the archive (header subtitle).
  const latestSeason = useMemo(() => seasons?.[0]?.season ?? null, [seasons]);

  const title = meta ? `${meta.city} ${meta.name}` : 'Franchise';
  const subtitle = history && history.length > 0
    ? `${history.length} SEASONS · SINCE ${seasonLabel(history[history.length - 1].season)}`
    : undefined;

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.background }]}
      edges={['top']}
    >
      <PageHeader title="FRANCHISE HISTORY" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header strip */}
        <View
          style={[
            styles.heroCard,
            { backgroundColor: meta?.primary_color ?? c.primary },
          ]}
        >
          <View
            style={[
              styles.heroRule,
              { backgroundColor: meta?.secondary_color ?? Brand.gold },
            ]}
          />
          <View style={styles.heroBody}>
            {meta && (
              <ArchiveTeamLogo
                franchiseId={id ?? ''}
                tricode={meta.tricode}
                primaryColor={meta.secondary_color}
                secondaryColor={meta.primary_color}
                logoKey={meta.logo_key}
                size={s(60)}
              />
            )}
            <View style={styles.heroLabels}>
              <ThemedText
                style={[styles.heroTitle, { color: '#FFFFFF' }]}
                numberOfLines={1}
              >
                {title}
              </ThemedText>
              {subtitle && (
                <ThemedText
                  type="varsitySmall"
                  style={[
                    styles.heroSubtitle,
                    { color: meta?.secondary_color ?? Brand.ecru },
                  ]}
                >
                  {subtitle}
                </ThemedText>
              )}
            </View>
            <TouchableOpacity
              onPress={() => router.back()}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={styles.closeBtn}
            >
              <Ionicons name="close" size={ms(22)} color="#FFFFFF" />
            </TouchableOpacity>
          </View>
        </View>

        {/* Year-by-year section */}
        <View style={styles.section}>
          <ThemedText
            type="varsity"
            style={[styles.sectionLabel, { color: c.text }]}
            accessibilityRole="header"
          >
            YEAR BY YEAR
          </ThemedText>

          {isLoading || !history ? (
            <View style={styles.loading}>
              <LogoSpinner />
            </View>
          ) : (
            <View style={[styles.historyList, { borderColor: c.border }]}>
              {history.map((row) => (
                <SeasonRow
                  key={row.season}
                  row={row}
                  franchiseId={id ?? ''}
                  isCurrent={row.season === latestSeason}
                  onPress={() =>
                    router.push({
                      pathname: '/playoff-archive',
                      params: { season: String(row.season), team: id },
                    })
                  }
                  c={c}
                  secondary={meta?.secondary_color ?? Brand.gold}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Single per-season row. Left side: year + record/seed. Middle: playoff
// chips (one per round, hollow on the elimination loss). Right side: top
// rotation player + VORP. Whole row is tappable to jump to the archive.
function SeasonRow({
  row,
  franchiseId,
  isCurrent,
  onPress,
  c,
  secondary,
}: {
  row: ArchiveFranchiseHistoryRow;
  franchiseId: string;
  isCurrent: boolean;
  onPress: () => void;
  c: ReturnType<typeof useArchiveColors>;
  secondary: string;
}) {
  const hasRecord = row.wins != null && row.losses != null;
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={`${seasonLabel(row.season)} season — open in archive`}
      style={[styles.seasonRow, { borderBottomColor: c.border }]}
    >
      <View style={styles.seasonLeft}>
        <ThemedText
          style={[styles.seasonYear, { color: c.text }]}
        >
          {seasonLabel(row.season)}
          {isCurrent && (
            <ThemedText
              type="varsitySmall"
              style={[styles.currentTag, { color: secondary }]}
            >
              {'  '}NOW
            </ThemedText>
          )}
        </ThemedText>
        {hasRecord ? (
          <ThemedText
            type="varsitySmall"
            style={[styles.seasonMeta, { color: c.secondaryText }]}
          >
            {row.wins}-{row.losses}
            {row.conference_seed != null
              ? `  ·  ${row.conference?.charAt(0)}${row.conference_seed}`
              : ''}
          </ThemedText>
        ) : (
          <ThemedText
            type="varsitySmall"
            style={[styles.seasonMeta, { color: c.secondaryText }]}
          >
            —
          </ThemedText>
        )}
      </View>

      <View style={styles.seasonMiddle}>
        {row.series.length > 0 ? (
          <View style={styles.chipRow}>
            {row.series.map((sr, idx) => {
              const decided = !!sr.winner_id;
              const lost = decided && sr.winner_id !== franchiseId;
              return (
                <View
                  key={idx}
                  style={[
                    styles.chip,
                    {
                      borderColor: secondary,
                      backgroundColor: lost ? 'transparent' : secondary + '33',
                    },
                  ]}
                >
                  <ThemedText style={[styles.chipText, { color: c.text }]}>
                    {sr.opponent_id ?? '—'} {sr.my_wins}-{sr.opp_wins}
                  </ThemedText>
                </View>
              );
            })}
          </View>
        ) : (
          <ThemedText
            type="varsitySmall"
            style={[styles.missedTag, { color: c.secondaryText }]}
          >
            MISSED
          </ThemedText>
        )}
      </View>

      <View style={styles.seasonRight}>
        {row.top_player ? (
          <>
            <View style={styles.topPlayerName}>
              {row.top_player.is_all_star && (
                <Ionicons
                  name="star"
                  size={ms(10)}
                  color={c.gold}
                  style={styles.starIcon}
                  accessibilityLabel="All-Star"
                />
              )}
              <ThemedText
                style={[styles.topPlayerText, { color: c.text }]}
                numberOfLines={1}
              >
                {row.top_player.player_name}
              </ThemedText>
            </View>
            {row.top_player.vorp != null && (
              <ThemedText
                type="varsitySmall"
                style={[styles.topPlayerVorp, { color: c.secondaryText }]}
              >
                {Number(row.top_player.vorp).toFixed(1)} VORP
              </ThemedText>
            )}
          </>
        ) : (
          <ThemedText
            type="varsitySmall"
            style={[styles.topPlayerVorp, { color: c.secondaryText }]}
          >
            —
          </ThemedText>
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingBottom: s(40),
  },
  loading: {
    paddingVertical: s(40),
    alignItems: 'center',
  },

  // Hero — same idiom as the team sheet's hero strip
  heroCard: {
    marginHorizontal: s(12),
    marginTop: s(8),
    borderRadius: 12,
    overflow: 'hidden',
  },
  heroRule: {
    height: 2,
    marginHorizontal: s(16),
    marginTop: s(8),
  },
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
    padding: s(14),
  },
  heroLabels: {
    flex: 1,
    minWidth: 0,
  },
  heroTitle: {
    fontSize: ms(18),
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  heroSubtitle: {
    fontSize: ms(10),
    letterSpacing: 1.0,
    marginTop: 2,
  },
  closeBtn: {
    padding: s(2),
  },

  section: {
    marginTop: s(20),
    paddingHorizontal: s(12),
  },
  sectionLabel: {
    fontSize: ms(11),
    letterSpacing: 1.2,
    marginBottom: s(8),
  },

  historyList: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 10,
    overflow: 'hidden',
  },
  seasonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(10),
    gap: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  seasonLeft: {
    width: s(70),
  },
  seasonYear: {
    fontSize: ms(13),
    fontWeight: '700',
    letterSpacing: -0.1,
  },
  currentTag: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  seasonMeta: {
    fontFamily: Fonts.mono,
    fontSize: ms(10),
    letterSpacing: 0.5,
    marginTop: 2,
  },
  seasonMiddle: {
    flex: 1,
    minWidth: 0,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(4),
  },
  chip: {
    paddingHorizontal: s(6),
    paddingVertical: s(2),
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontFamily: Fonts.mono,
    fontSize: ms(9),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  missedTag: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  seasonRight: {
    width: s(96),
    alignItems: 'flex-end',
  },
  topPlayerName: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  starIcon: {
    marginRight: s(2),
  },
  topPlayerText: {
    fontSize: ms(11),
    fontWeight: '600',
    flexShrink: 1,
  },
  topPlayerVorp: {
    fontFamily: Fonts.mono,
    fontSize: ms(9),
    letterSpacing: 0.5,
    marginTop: 1,
  },
});
