import { useQuery } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { HistoryPill, HomeListCard } from '@/components/home/HomeListCard';
import { TeamLogo } from '@/components/team/TeamLogo';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

interface Props {
  leagueId: string;
  /** Team that won the title, so the card can crown it. */
  championTeamId: string | null;
}

interface StandingRow {
  teamId: string;
  teamName: string;
  tricode: string | null;
  logoKey: string | null;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  finalStanding: number | null;
}

/**
 * Offseason standings card for redraft + keeper leagues.
 *
 * Dynasty's offseason card is the rookie draft order, which these leagues don't
 * have — they were being shown one anyway, built from reverse standings, for a
 * draft that would never happen and in an order that meant nothing (a redraft
 * league's next draft order comes from `initial_draft_order`). Their rosters
 * are also cleared, so there is no forward-looking roster state to show either.
 *
 * What IS real is the season that just finished. This shows it: the final
 * table, the champion crowned, and a way through to full league history.
 */
export function OffseasonFinalStandings({ leagueId, championTeamId }: Props) {
  const c = useColors();

  const { data, isLoading, isError, refetch } = useQuery<StandingRow[]>({
    queryKey: queryKeys.offseasonFinalStandings(leagueId),
    queryFn: async () => {
      // advance-season archives the just-completed season into team_seasons as
      // its first write, so the most recent row set is always the one that just
      // ended — no need to derive which season that was.
      const { data: rows, error } = await supabase
        .from('team_seasons')
        .select(
          'team_id, wins, losses, ties, points_for, final_standing, season, team:teams!team_seasons_team_id_fkey(id, name, tricode, logo_key)',
        )
        .eq('league_id', leagueId)
        .order('season', { ascending: false });
      if (error) throw error;
      if (!rows || rows.length === 0) return [];

      const latestSeason = (rows[0] as { season: string }).season;
      const latest = rows.filter((r: any) => r.season === latestSeason);

      latest.sort((a: any, b: any) => {
        if (a.final_standing != null && b.final_standing != null) {
          return a.final_standing - b.final_standing;
        }
        if (a.wins !== b.wins) return b.wins - a.wins;
        return Number(b.points_for ?? 0) - Number(a.points_for ?? 0);
      });

      return latest.map((r: any) => ({
        teamId: r.team?.id ?? r.team_id,
        teamName: r.team?.name ?? 'Unknown',
        tricode: r.team?.tricode ?? null,
        logoKey: r.team?.logo_key ?? null,
        wins: r.wins ?? 0,
        losses: r.losses ?? 0,
        ties: r.ties ?? 0,
        pointsFor: Number(r.points_for ?? 0),
        finalStanding: r.final_standing ?? null,
      }));
    },
    staleTime: 1000 * 60 * 5,
  });

  return (
    <HomeListCard
      label="Final Standings"
      accessory={<HistoryPill />}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      empty={!data || data.length === 0}
      emptyText="Standings will appear once a season is in the books."
    >
      <View style={[styles.headerRow, { borderBottomColor: c.border }]}>
        <ThemedText type="varsitySmall" style={[styles.rank, { color: c.secondaryText }]}>
          #
        </ThemedText>
        <View style={{ width: s(26) }} />
        <ThemedText type="varsitySmall" style={[styles.teamCol, { color: c.secondaryText }]}>
          Team
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.record, { color: c.secondaryText }]}>
          W-L
        </ThemedText>
        <ThemedText type="varsitySmall" style={[styles.points, { color: c.secondaryText }]}>
          PF
        </ThemedText>
      </View>

      {/* Null-safe: HomeListCard evaluates children even in the loading/empty
          states (it just doesn't render them). */}
      {(data ?? []).slice(0, 14).map((row, i, arr) => {
        const isChampion = !!championTeamId && row.teamId === championTeamId;
        const record = row.ties > 0 ? `${row.wins}-${row.losses}-${row.ties}` : `${row.wins}-${row.losses}`;
        return (
          <View
            key={row.teamId}
            style={[
              styles.row,
              { borderBottomColor: c.border },
              i === arr.length - 1 && { borderBottomWidth: 0 },
            ]}
            accessible
            accessibilityLabel={
              `${row.finalStanding ?? i + 1}. ${row.teamName}, ${record}, ` +
              `${row.pointsFor.toFixed(1)} points for` +
              (isChampion ? ', champion' : '')
            }
          >
            <ThemedText type="mono" style={[styles.rank, { color: c.secondaryText }]}>
              {row.finalStanding ?? i + 1}
            </ThemedText>
            <TeamLogo
              logoKey={row.logoKey}
              teamName={row.teamName}
              tricode={row.tricode ?? undefined}
              size="small"
            />
            <View style={styles.nameWrap}>
              <ThemedText
                style={[styles.teamName, { color: c.text }]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {row.teamName}
              </ThemedText>
              {isChampion && (
                <IconSymbol name="trophy.fill" size={ms(11)} color={c.gold} accessible={false} />
              )}
            </View>
            <ThemedText type="mono" style={[styles.record, { color: c.secondaryText }]}>
              {record}
            </ThemedText>
            <ThemedText type="mono" style={[styles.points, { color: c.secondaryText }]}>
              {row.pointsFor.toFixed(0)}
            </ThemedText>
          </View>
        );
      })}
    </HomeListCard>
  );
}

const styles = StyleSheet.create({
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
    marginHorizontal: -s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  nameWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: s(8),
    gap: s(6),
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
    flexShrink: 1,
    fontSize: ms(13),
    fontWeight: '500',
  },
  record: {
    width: s(52),
    textAlign: 'center',
    fontSize: ms(12),
  },
  points: {
    width: s(46),
    textAlign: 'right',
    fontSize: ms(12),
  },
});
