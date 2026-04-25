import { ThemedText } from '@/components/ui/ThemedText';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { TeamLogo } from '@/components/team/TeamLogo';
import { Colors, cardShadow } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/lottery';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface Props {
  leagueId: string;
  playoffTeams: number;
  lotteryOdds: number[] | null;
  rookieDraftOrder: string;
  offseasonStep: string;
}

interface OrderRow {
  position: number;
  teamId: string | null;
  teamName: string;
  tricode: string | null;
  logoKey: string | null;
  wins: number;
  losses: number;
  oddsPct: string;
}

/**
 * Offseason replacement for StandingsSection — shows either lottery odds
 * (pre-lottery) or the locked-in rookie draft order (post-lottery).
 *
 * Styling mirrors StandingsSection exactly: same sectionLabel header,
 * same card padding, left-aligned rank + team logo + flex name col,
 * stat columns on the right in mono, footer "See All →" routing to
 * the draft hub. Keeps the home-screen list-card rhythm consistent.
 */
export function OffseasonLotteryOrder({
  leagueId,
  playoffTeams,
  lotteryOdds,
  rookieDraftOrder,
  offseasonStep,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

  const lotteryComplete =
    offseasonStep === 'lottery_complete' ||
    offseasonStep === 'rookie_draft_pending' ||
    offseasonStep === 'rookie_draft_complete' ||
    offseasonStep === 'ready_for_new_season';
  const isLotteryLeague = rookieDraftOrder === 'lottery';

  const { data, isLoading } = useQuery<OrderRow[]>({
    queryKey: queryKeys.offseasonLotteryOrder(leagueId, offseasonStep),
    queryFn: async () => {
      const { data: allArchived } = await supabase
        .from('team_seasons')
        .select('team_id, wins, losses, points_for, final_standing, season, team:teams!team_seasons_team_id_fkey(id, name, tricode, logo_key)')
        .eq('league_id', leagueId)
        .order('season', { ascending: false });

      if (!allArchived || allArchived.length === 0) return [];
      const latestSeason = (allArchived[0] as any).season;
      const rows = allArchived.filter((r: any) => r.season === latestSeason);

      // Sort: worst record first (reverse standings)
      rows.sort((a: any, b: any) => {
        if (a.final_standing != null && b.final_standing != null) {
          return b.final_standing - a.final_standing;
        }
        if (a.wins !== b.wins) return a.wins - b.wins;
        return Number(a.points_for) - Number(b.points_for);
      });

      const totalTeams = rows.length;
      const poolSize = isLotteryLeague ? calcLotteryPoolSize(totalTeams, playoffTeams) : 0;
      const odds = lotteryOdds ?? (poolSize > 0 ? generateDefaultOdds(poolSize) : []);

      // If lottery complete, use current draft_picks slot_number ordering for round 1
      if (lotteryComplete) {
        const { data: picks } = await supabase
          .from('draft_picks')
          .select('slot_number, current_team_id, team:teams!draft_picks_current_team_id_fkey(id, name, tricode, logo_key)')
          .eq('league_id', leagueId)
          .eq('round', 1)
          .is('player_id', null)
          .is('draft_id', null)
          .order('slot_number', { ascending: true });

        const ordered = (picks ?? []).filter((p: any) => p.slot_number != null);
        if (ordered.length > 0) {
          return ordered.map((p: any, i: number) => ({
            position: p.slot_number ?? i + 1,
            teamId: p.team?.id ?? null,
            teamName: p.team?.name ?? 'Unknown',
            tricode: p.team?.tricode ?? null,
            logoKey: p.team?.logo_key ?? null,
            wins: 0,
            losses: 0,
            oddsPct: '—',
          }));
        }
      }

      return rows.map((r: any, i: number) => ({
        position: i + 1,
        teamId: r.team?.id ?? null,
        teamName: r.team?.name ?? 'Unknown',
        tricode: r.team?.tricode ?? null,
        logoKey: r.team?.logo_key ?? null,
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        oddsPct: isLotteryLeague && i < poolSize && odds[i] != null ? `${odds[i]}%` : '—',
      }));
    },
    staleTime: 1000 * 60 * 2,
  });

  const outerLabel = lotteryComplete
    ? 'Rookie Draft Order'
    : isLotteryLeague
      ? 'Lottery Odds'
      : 'Rookie Draft Order';
  const showRecord = !lotteryComplete;
  const showOdds = isLotteryLeague && !lotteryComplete;

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <View style={[styles.labelRule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" style={{ color: c.text }}>
          {outerLabel}
        </ThemedText>
      </View>

      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border, ...cardShadow }]}>
        <View style={styles.list}>
          {isLoading ? (
            <View style={styles.loading}>
              <LogoSpinner />
            </View>
          ) : !data || data.length === 0 ? (
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
              Order will be available once the season ends.
            </ThemedText>
          ) : (
            <>
              <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
                <ThemedText type="varsitySmall" style={[styles.rank, { color: c.secondaryText }]}>#</ThemedText>
                <View style={{ width: s(26) }} />
                <ThemedText type="varsitySmall" style={[styles.teamCol, { color: c.secondaryText }]}>
                  Team
                </ThemedText>
                {showRecord && (
                  <ThemedText type="varsitySmall" style={[styles.record, { color: c.secondaryText }]}>
                    W-L
                  </ThemedText>
                )}
                {showOdds && (
                  <ThemedText type="varsitySmall" style={[styles.odds, { color: c.secondaryText }]}>
                    Odds
                  </ThemedText>
                )}
              </View>
              {data.slice(0, 14).map((row, i, arr) => {
                const isLast = i === arr.length - 1;
                return (
                  <TouchableOpacity
                    key={`${row.position}-${row.teamId ?? row.teamName}`}
                    style={[
                      styles.row,
                      { borderBottomColor: c.border },
                      isLast && { borderBottomWidth: 0 },
                    ]}
                    onPress={() =>
                      row.teamId ? router.push(`/team-roster/${row.teamId}` as never) : undefined
                    }
                    disabled={!row.teamId}
                    activeOpacity={0.6}
                    accessibilityRole={row.teamId ? 'button' : undefined}
                    accessibilityLabel={`${row.teamName}, pick ${row.position}`}
                  >
                    <ThemedText type="mono" style={[styles.rank, { color: c.secondaryText }]}>
                      {row.position}
                    </ThemedText>
                    <TeamLogo
                      logoKey={row.logoKey}
                      teamName={row.teamName}
                      tricode={row.tricode ?? undefined}
                      size="small"
                    />
                    <ThemedText
                      style={[styles.teamName, { color: c.text }]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {row.teamName}
                    </ThemedText>
                    {showRecord && (
                      <ThemedText type="mono" style={[styles.record, { color: c.secondaryText }]}>
                        {row.wins}-{row.losses}
                      </ThemedText>
                    )}
                    {showOdds && (
                      <ThemedText type="mono" style={[styles.odds, { color: c.gold }]}>
                        {row.oddsPct}
                      </ThemedText>
                    )}
                  </TouchableOpacity>
                );
              })}
            </>
          )}
        </View>

        {!!data?.length && (
          <View style={[styles.footer, { borderTopColor: c.border }]}>
            <View />
            <TouchableOpacity
              style={styles.seeAll}
              onPress={() => router.push('/draft-hub' as never)}
              accessibilityRole="button"
              accessibilityLabel="View full draft hub"
              hitSlop={8}
            >
              <ThemedText type="varsitySmall" style={[styles.seeAllText, { color: c.secondaryText }]}>
                Draft Hub
              </ThemedText>
              <Ionicons name="chevron-forward" size={12} color={c.secondaryText} accessible={false} />
            </TouchableOpacity>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: s(4),
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(10),
    gap: s(10),
  },
  labelRule: {
    height: 2,
    width: s(18),
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingTop: s(10),
    paddingBottom: s(0),
    marginBottom: s(16),
    overflow: 'hidden',
  },
  list: {},
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(6),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(9),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    marginHorizontal: -s(4),
  },
  rank: {
    width: s(18),
    fontSize: ms(12),
    textAlign: 'left',
  },
  teamCol: {
    flex: 1,
    fontSize: ms(13),
    marginLeft: s(8),
  },
  teamName: {
    flex: 1,
    flexShrink: 1,
    fontSize: ms(13),
    fontWeight: '500',
    marginLeft: s(8),
  },
  record: {
    width: s(44),
    textAlign: 'center',
    fontSize: ms(12),
  },
  odds: {
    width: s(52),
    textAlign: 'right',
    fontSize: ms(12),
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(4),
    paddingVertical: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: s(4),
    marginHorizontal: -s(4),
  },
  seeAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(3),
  },
  seeAllText: {
    fontSize: ms(10),
  },
  empty: {
    fontSize: ms(13),
    textAlign: 'center',
    paddingVertical: s(20),
  },
  loading: {
    paddingVertical: s(20),
  },
});
