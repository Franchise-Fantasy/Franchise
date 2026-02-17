import { PlayerCard } from '@/components/player/PlayerCard';
import { PlayerDetailModal } from '@/components/player/PlayerDetailModal';
import { PlayerFilterBar } from '@/components/player/PlayerFilterBar';
import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useDraftPlayer } from '@/hooks/useDraftPlayer';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayerFilter } from '@/hooks/usePlayerFilter';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, TouchableOpacity } from 'react-native';

interface AvailablePlayersProps {
  draftId: string;
  leagueId: string;
  currentPick: { id: string; current_team_id: string } | null;
  teamId: string;
}

export function AvailablePlayers({ draftId, leagueId, currentPick, teamId }: AvailablePlayersProps) {
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

    return () => { channel.unsubscribe(); };
  }, [leagueId, queryClient]);

  const renderPlayer = ({ item }: { item: PlayerSeasonStats }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : undefined;

    return (
      <PlayerCard
        player={item}
        fantasyPoints={fpts}
        onPress={() => setSelectedPlayer(item)}
        rightElement={
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
        }
      />
    );
  };

  if (isLoading) {
    return (
      <ThemedView style={styles.container}>
        <ActivityIndicator style={styles.loading} />
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
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
        onClose={() => setSelectedPlayer(null)}
      />
    </ThemedView>
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
  draftButton: {
    backgroundColor: '#0066cc',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginLeft: 8,
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
