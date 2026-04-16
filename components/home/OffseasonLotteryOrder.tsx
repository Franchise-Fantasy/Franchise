import { ThemedText } from '@/components/ui/ThemedText';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
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
  teamName: string;
  wins: number;
  losses: number;
  oddsPct: string;
}

/**
 * Offseason replacement for StandingsSection: shows the rookie draft order
 * for the upcoming rookie draft. Before the lottery runs, rows display odds
 * based on the prior season's final standings. After the lottery runs, rows
 * display the locked-in slot order.
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
        .select('team_id, wins, losses, points_for, final_standing, season, team:teams!team_seasons_team_id_fkey(id, name)')
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
          .select('slot_number, current_team_id, team:teams!draft_picks_current_team_id_fkey(name)')
          .eq('league_id', leagueId)
          .eq('round', 1)
          .is('player_id', null)
          .is('draft_id', null)
          .order('slot_number', { ascending: true });

        const ordered = (picks ?? []).filter((p: any) => p.slot_number != null);
        if (ordered.length > 0) {
          return ordered.map((p: any, i: number) => ({
            position: p.slot_number ?? i + 1,
            teamName: p.team?.name ?? 'Unknown',
            wins: 0,
            losses: 0,
            oddsPct: '—',
          }));
        }
      }

      return rows.map((r: any, i: number) => ({
        position: i + 1,
        teamName: r.team?.name ?? 'Unknown',
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        oddsPct: isLotteryLeague && i < poolSize && odds[i] != null ? `${odds[i]}%` : '—',
      }));
    },
    staleTime: 1000 * 60 * 2,
  });

  const title = lotteryComplete ? 'Rookie Draft Order' : isLotteryLeague ? 'Lottery Odds' : 'Rookie Draft Order';

  return (
    <TouchableOpacity
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }, cardShadow]}
      onPress={() => router.push('/draft-hub')}
      accessibilityRole="button"
      accessibilityLabel={`${title}, tap for full draft hub`}
    >
      <View style={styles.header}>
        <Ionicons name="trophy-outline" size={18} color={c.accent} />
        <ThemedText type="defaultSemiBold" style={styles.title} accessibilityRole="header">
          {title}
        </ThemedText>
        <Ionicons name="chevron-forward" size={18} color={c.secondaryText} />
      </View>
      {isLoading ? (
        <View style={{ paddingVertical: s(20) }}><LogoSpinner /></View>
      ) : !data || data.length === 0 ? (
        <ThemedText style={[styles.empty, { color: c.secondaryText }]}>
          Order will be available once the season ends.
        </ThemedText>
      ) : (
        <>
          <View style={[styles.row, { borderBottomColor: c.border }]}>
            <ThemedText style={[styles.pos, styles.headerText, { color: c.secondaryText }]}>#</ThemedText>
            <ThemedText style={[styles.teamCol, styles.headerText, { color: c.secondaryText }]}>Team</ThemedText>
            {!lotteryComplete && (
              <ThemedText style={[styles.record, styles.headerText, { color: c.secondaryText }]}>Rec</ThemedText>
            )}
            {isLotteryLeague && !lotteryComplete && (
              <ThemedText style={[styles.odds, styles.headerText, { color: c.secondaryText }]}>Odds</ThemedText>
            )}
          </View>
          {data.slice(0, 14).map((row) => (
            <View key={`${row.position}-${row.teamName}`} style={[styles.row, { borderBottomColor: c.border }]}>
              <ThemedText style={[styles.pos, { color: c.secondaryText }]}>{row.position}</ThemedText>
              <ThemedText style={styles.teamCol} numberOfLines={1}>{row.teamName}</ThemedText>
              {!lotteryComplete && (
                <ThemedText style={[styles.record, { color: c.secondaryText }]}>
                  {row.wins}-{row.losses}
                </ThemedText>
              )}
              {isLotteryLeague && !lotteryComplete && (
                <ThemedText style={[styles.odds, { color: c.accent, fontWeight: '600' }]}>
                  {row.oddsPct}
                </ThemedText>
              )}
            </View>
          ))}
        </>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(14),
    marginBottom: s(16),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(8),
  },
  title: { flex: 1, fontSize: ms(15) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(7),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerText: { fontSize: ms(10), fontWeight: '600' },
  pos: { width: s(24), fontSize: ms(12) },
  teamCol: { flex: 1, fontSize: ms(13) },
  record: { width: s(48), textAlign: 'center', fontSize: ms(12) },
  odds: { width: s(48), textAlign: 'right', fontSize: ms(12) },
  empty: { fontSize: ms(13), textAlign: 'center', paddingVertical: s(16) },
});
