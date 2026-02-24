import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { PlayerFilterBar } from '@/components/player/PlayerFilterBar';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDraftPlayer } from '@/hooks/useDraftPlayer';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayerFilter } from '@/hooks/usePlayerFilter';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { getPlayerHeadshotUrl, getTeamLogoUrl } from '@/utils/playerHeadshot';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface AvailablePlayersProps {
  draftId: string;
  leagueId: string;
  currentPick: { id: string; current_team_id: string } | null;
  teamId: string;
}

export function AvailablePlayers({ draftId, leagueId, currentPick, teamId }: AvailablePlayersProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const isMyTurn = currentPick?.current_team_id === teamId;
  const [selectedPlayer, setSelectedPlayer] = useState<PlayerSeasonStats | null>(null);

  const { mutate: draftPlayer, isPending: isDrafting } = useDraftPlayer(leagueId, draftId);
  const { data: scoringWeights } = useLeagueScoring(leagueId);

  const { data: players, isLoading } = useQuery<PlayerSeasonStats[]>({
    queryKey: ['availablePlayers', leagueId],
    queryFn: async () => {
      const { data: draftedPlayers, error: draftedError } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId);

      if (draftedError) throw draftedError;
      const draftedIds = draftedPlayers?.map(p => String(p.player_id)) || [];

      let query = supabase
        .from('player_season_stats')
        .select('*')
        .gt('games_played', 0)
        .order('avg_pts', { ascending: false });

      if (draftedIds.length > 0) {
        query = query.filter('player_id', 'not.in', `(${draftedIds.join(',')})`);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    enabled: !!leagueId,
  });

  const { filteredPlayers, filterBarProps } = usePlayerFilter(players, scoringWeights);

  const handleDraft = (player: PlayerSeasonStats) => {
    if (!isMyTurn || !currentPick) return;
    draftPlayer({
      id: player.player_id,
      name: player.name,
      position: player.position,
      nba_team: player.nba_team,
    });
  };

  // Real-time updates when players are drafted
  useEffect(() => {
    const channel = supabase
      .channel(`league_players_${leagueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'league_players' },
        (payload) => {
          if ((payload.new as { league_id?: string })?.league_id === leagueId) {
            queryClient.invalidateQueries({ queryKey: ['availablePlayers', leagueId] });
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [leagueId, queryClient]);

  const renderPlayer = ({ item }: { item: PlayerSeasonStats }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : undefined;
    const headshotUrl = getPlayerHeadshotUrl(item.external_id_nba);
    const logoUrl = getTeamLogoUrl(item.nba_team);
    const badge = getInjuryBadge(item.status);

    return (
      <TouchableOpacity
        style={[styles.row, { borderBottomColor: c.border }]}
        onPress={() => setSelectedPlayer(item)}
        activeOpacity={0.7}
      >
        <View style={styles.portraitWrap}>
          {headshotUrl ? (
            <Image source={{ uri: headshotUrl }} style={styles.headshot} resizeMode="cover" />
          ) : (
            <View style={[styles.headshot, { backgroundColor: c.border }]} />
          )}
          <View style={styles.teamPill}>
            {logoUrl && (
              <Image source={{ uri: logoUrl }} style={styles.teamPillLogo} resizeMode="contain" />
            )}
            <Text style={styles.teamPillText}>{item.nba_team}</Text>
          </View>
        </View>

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <ThemedText type="defaultSemiBold" numberOfLines={1} style={{ flexShrink: 1, fontSize: 14 }}>
              {item.name}
            </ThemedText>
            {badge && (
              <View style={[styles.badge, { backgroundColor: badge.color }]}>
                <Text style={styles.badgeText}>{badge.label}</Text>
              </View>
            )}
          </View>
          <ThemedText style={[styles.posText, { color: c.secondaryText }]}>
            {formatPosition(item.position)}
          </ThemedText>
        </View>

        <View style={styles.rightSide}>
          <View style={styles.stats}>
            <ThemedText style={[styles.statLine, { color: c.secondaryText }]}>
              {item.avg_pts}/{item.avg_reb}/{item.avg_ast}
            </ThemedText>
            {fpts !== undefined && (
              <ThemedText style={[styles.fpts, { color: c.accent }]}>
                {fpts} FPTS
              </ThemedText>
            )}
          </View>
          <TouchableOpacity
            style={[styles.draftButton, (!isMyTurn || isDrafting) && styles.draftButtonDisabled]}
            onPress={() => handleDraft(item)}
            disabled={!isMyTurn || isDrafting}
          >
            <ThemedText style={[
              styles.draftButtonText,
              (!isMyTurn || isDrafting) && styles.draftButtonTextDisabled
            ]}>
              Draft
            </ThemedText>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  if (isLoading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <PlayerFilterBar {...filterBarProps} />
      <FlatList<PlayerSeasonStats>
        data={filteredPlayers}
        renderItem={renderPlayer}
        keyExtractor={(item) => item.player_id}
        contentContainerStyle={styles.listContent}
      />
      <PlayerDetailModal
        player={selectedPlayer}
        leagueId={leagueId}
        teamId={teamId}
        onClose={() => setSelectedPlayer(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    padding: 8,
  },
  loading: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  portraitWrap: {
    width: 52,
    height: 48,
    marginRight: 10,
  },
  headshot: {
    width: 52,
    height: 40,
    borderRadius: 6,
  },
  teamPill: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: 4,
    paddingVertical: 1,
    gap: 2,
  },
  teamPillLogo: {
    width: 10,
    height: 10,
  },
  teamPillText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  badge: {
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 3,
  },
  badgeText: {
    color: '#fff',
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  posText: {
    fontSize: 11,
    marginTop: 1,
  },
  rightSide: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  stats: {
    alignItems: 'flex-end',
  },
  statLine: {
    fontSize: 12,
  },
  fpts: {
    fontSize: 11,
    fontWeight: '600',
    marginTop: 1,
  },
  draftButton: {
    backgroundColor: '#0066cc',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  draftButtonText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  draftButtonDisabled: {
    backgroundColor: '#ccc',
  },
  draftButtonTextDisabled: {
    color: '#666',
  },
});
