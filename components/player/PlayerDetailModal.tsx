import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayerGameLog } from '@/hooks/usePlayerGameLog';
import { supabase } from '@/lib/supabase';
import { PlayerGameLog, PlayerSeasonStats } from '@/types/player';
import { calculateAvgFantasyPoints, calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

interface PlayerDetailModalProps {
  player: PlayerSeasonStats | null;
  leagueId: string;
  teamId?: string;
  onClose: () => void;
  onRosterChange?: () => void;
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statBox}>
      <ThemedText style={[styles.statLabel, { color }]}>{label}</ThemedText>
      <ThemedText type="defaultSemiBold">{value}</ThemedText>
    </View>
  );
}

export function PlayerDetailModal({ player, leagueId, teamId, onClose, onRosterChange }: PlayerDetailModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [isProcessing, setIsProcessing] = useState(false);
  const [showDropPicker, setShowDropPicker] = useState(false);

  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { data: gameLog, isLoading: isLoadingGameLog } = usePlayerGameLog(
    player?.player_id ?? ''
  );

  // Check if this player is on the user's team
  const { data: isOnMyTeam } = useQuery({
    queryKey: ['playerOwnership', leagueId, teamId, player?.player_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('id')
        .eq('league_id', leagueId)
        .eq('team_id', teamId!)
        .eq('player_id', player!.player_id)
        .limit(1);

      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!player && !!teamId && !!leagueId,
  });

  // Get current roster count and roster size limit
  const { data: rosterInfo } = useQuery({
    queryKey: ['rosterInfo', leagueId, teamId],
    queryFn: async () => {
      const [rosterCountRes, leagueRes] = await Promise.all([
        supabase
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId!),
        supabase
          .from('leagues')
          .select('roster_size')
          .eq('id', leagueId)
          .single(),
      ]);

      if (rosterCountRes.error) throw rosterCountRes.error;
      if (leagueRes.error) throw leagueRes.error;

      return {
        currentCount: rosterCountRes.count ?? 0,
        maxSize: leagueRes.data?.roster_size ?? 13,
      };
    },
    enabled: !!teamId && !!leagueId,
  });

  // Fetch roster players for the drop picker
  const { data: rosterPlayers } = useQuery<PlayerSeasonStats[]>({
    queryKey: ['teamRoster', teamId],
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('team_id', teamId!)
        .eq('league_id', leagueId);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const playerIds = leaguePlayers.map(lp => lp.player_id);
      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', playerIds);

      if (error) throw error;
      return data as PlayerSeasonStats[];
    },
    enabled: !!teamId && !!leagueId && showDropPicker,
  });

  // Check for active draft
  const { data: hasActiveDraft } = useQuery({
    queryKey: ['hasActiveDraft', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('id')
        .eq('league_id', leagueId)
        .neq('status', 'complete')
        .limit(1);

      if (error) throw error;
      return (data?.length ?? 0) > 0;
    },
    enabled: !!leagueId && !!teamId,
  });

  if (!player) return null;

  const rosterIsFull = rosterInfo
    ? rosterInfo.currentCount >= rosterInfo.maxSize
    : false;

  const avgFpts = scoringWeights
    ? calculateAvgFantasyPoints(player, scoringWeights)
    : null;

  const fgPct = player.avg_fga > 0
    ? ((player.avg_fgm / player.avg_fga) * 100).toFixed(1)
    : '0.0';
  const threePct = player.avg_3pa > 0
    ? ((player.avg_3pm / player.avg_3pa) * 100).toFixed(1)
    : '0.0';
  const ftPct = player.avg_fta > 0
    ? ((player.avg_ftm / player.avg_fta) * 100).toFixed(1)
    : '0.0';

  const invalidateRosterQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['freeAgents', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['teamRoster', teamId] });
    queryClient.invalidateQueries({ queryKey: ['rosterInfo', leagueId, teamId] });
    queryClient.invalidateQueries({ queryKey: ['playerOwnership', leagueId, teamId] });
    onRosterChange?.();
  };

  const handleAddPlayer = async () => {
    if (!teamId || !player) return;

    if (rosterIsFull) {
      setShowDropPicker(true);
      return;
    }

    setIsProcessing(true);
    try {
      const { error: lpError } = await supabase.from('league_players').insert({
        league_id: leagueId,
        player_id: player.player_id,
        team_id: teamId,
        acquired_via: 'free_agent',
        acquired_at: new Date().toISOString(),
        position: player.position,
      });
      if (lpError) throw lpError;

      const { data: txn, error: txnError } = await supabase
        .from('league_transactions')
        .insert({
          league_id: leagueId,
          type: 'waiver',
          notes: `Added ${player.name} from free agency`,
        })
        .select('id')
        .single();
      if (txnError) throw txnError;

      await supabase.from('league_transaction_items').insert({
        transaction_id: txn.id,
        player_id: player.player_id,
        team_to_id: teamId,
      });

      invalidateRosterQueries();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to add player');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDropPlayer = async (playerToDrop?: PlayerSeasonStats) => {
    const dropping = playerToDrop ?? player;
    if (!teamId || !dropping) return;

    setIsProcessing(true);
    try {
      const { error: delError } = await supabase
        .from('league_players')
        .delete()
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('player_id', dropping.player_id);
      if (delError) throw delError;

      const { data: txn, error: txnError } = await supabase
        .from('league_transactions')
        .insert({
          league_id: leagueId,
          type: 'waiver',
          notes: `Dropped ${dropping.name}`,
        })
        .select('id')
        .single();
      if (txnError) throw txnError;

      await supabase.from('league_transaction_items').insert({
        transaction_id: txn.id,
        player_id: dropping.player_id,
        team_to_id: null,
      });

      invalidateRosterQueries();

      // If dropping from the picker (add-and-drop), now add the new player
      if (playerToDrop && player) {
        const { error: addError } = await supabase.from('league_players').insert({
          league_id: leagueId,
          player_id: player.player_id,
          team_id: teamId,
          acquired_via: 'free_agent',
          acquired_at: new Date().toISOString(),
          position: player.position,
        });
        if (addError) throw addError;

        const { data: addTxn, error: addTxnError } = await supabase
          .from('league_transactions')
          .insert({
            league_id: leagueId,
            type: 'waiver',
            notes: `Added ${player.name} from free agency (dropped ${dropping.name})`,
          })
          .select('id')
          .single();
        if (addTxnError) throw addTxnError;

        await supabase.from('league_transaction_items').insert({
          transaction_id: addTxn.id,
          player_id: player.player_id,
          team_to_id: teamId,
        });

        invalidateRosterQueries();
        setShowDropPicker(false);
        onClose();
      } else {
        onClose();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to drop player');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    setShowDropPicker(false);
    onClose();
  };

  const canTransact = !!teamId && !hasActiveDraft && !isProcessing;

  const renderGameRow = ({ item }: { item: PlayerGameLog }) => {
    const gameFpts = scoringWeights
      ? calculateGameFantasyPoints(item, scoringWeights)
      : null;

    return (
      <View style={[styles.gameRow, { borderBottomColor: c.border }]}>
        <ThemedText style={[styles.gameCell, styles.gameCellWide, { color: c.secondaryText }]} numberOfLines={1}>
          {item.matchup ?? item.game_date ?? '—'}
        </ThemedText>
        <ThemedText style={styles.gameCell}>{item.pts}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.reb}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.ast}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.stl}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.blk}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.tov}</ThemedText>
        {gameFpts !== null && (
          <ThemedText style={[styles.gameCell, { color: c.accent, fontWeight: '600' }]}>
            {gameFpts}
          </ThemedText>
        )}
      </View>
    );
  };

  const renderDropPickerItem = ({ item }: { item: PlayerSeasonStats }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : null;

    return (
      <TouchableOpacity
        style={[styles.dropPickerRow, { borderBottomColor: c.border }]}
        onPress={() => {
          Alert.alert(
            'Confirm Transaction',
            `Drop ${item.name} to add ${player.name}?`,
            [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Confirm', style: 'destructive', onPress: () => handleDropPlayer(item) },
            ]
          );
        }}
        disabled={isProcessing}
      >
        <View style={styles.dropPickerInfo}>
          <ThemedText type="defaultSemiBold" numberOfLines={1}>{item.name}</ThemedText>
          <ThemedText style={[styles.dropPickerSub, { color: c.secondaryText }]}>
            {formatPosition(item.position)} · {item.nba_team}
          </ThemedText>
        </View>
        {fpts !== null && (
          <ThemedText style={[styles.dropPickerFpts, { color: c.accent }]}>
            {fpts} FPTS
          </ThemedText>
        )}
      </TouchableOpacity>
    );
  };

  // Drop picker sub-modal
  if (showDropPicker) {
    return (
      <Modal visible animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
          <View style={[styles.header, { borderBottomColor: c.border }]}>
            <View style={styles.headerInfo}>
              <ThemedText type="title" style={styles.playerName}>Drop a Player</ThemedText>
              <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                Your roster is full. Select a player to drop in order to add {player.name}.
              </ThemedText>
            </View>
            <TouchableOpacity onPress={() => setShowDropPicker(false)} style={styles.closeButton}>
              <ThemedText style={styles.closeText}>✕</ThemedText>
            </TouchableOpacity>
          </View>

          {isProcessing ? (
            <ActivityIndicator style={styles.loading} />
          ) : (
            <FlatList
              data={rosterPlayers ?? []}
              renderItem={renderDropPickerItem}
              keyExtractor={(item) => item.player_id}
              contentContainerStyle={styles.dropPickerList}
            />
          )}
        </SafeAreaView>
      </Modal>
    );
  }

  return (
    <Modal visible={!!player} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <View style={styles.headerInfo}>
            <ThemedText type="title" style={styles.playerName}>{player.name}</ThemedText>
            <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
              {formatPosition(player.position)} · {player.nba_team} · {player.games_played} GP
            </ThemedText>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <ThemedText style={styles.closeText}>✕</ThemedText>
          </TouchableOpacity>
        </View>

        <FlatList
          data={gameLog ?? []}
          renderItem={renderGameRow}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <>
              {/* Add / Drop Button */}
              {teamId && isOnMyTeam !== undefined && (
                <View style={styles.actionSection}>
                  {isOnMyTeam ? (
                    <TouchableOpacity
                      style={[styles.dropButton, !canTransact && styles.buttonDisabled]}
                      onPress={() => {
                        Alert.alert(
                          'Drop Player',
                          `Are you sure you want to drop ${player.name}?`,
                          [
                            { text: 'Cancel', style: 'cancel' },
                            { text: 'Drop', style: 'destructive', onPress: () => handleDropPlayer() },
                          ]
                        );
                      }}
                      disabled={!canTransact}
                    >
                      {isProcessing ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <ThemedText style={styles.actionButtonText}>Drop Player</ThemedText>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity
                      style={[styles.addButton, !canTransact && styles.buttonDisabled]}
                      onPress={handleAddPlayer}
                      disabled={!canTransact}
                    >
                      {isProcessing ? (
                        <ActivityIndicator size="small" color="#fff" />
                      ) : (
                        <ThemedText style={styles.actionButtonText}>
                          {rosterIsFull ? 'Add Player (Drop Required)' : 'Add Player'}
                        </ThemedText>
                      )}
                    </TouchableOpacity>
                  )}
                  {hasActiveDraft && (
                    <ThemedText style={[styles.draftWarning, { color: c.secondaryText }]}>
                      Roster moves are locked during the draft.
                    </ThemedText>
                  )}
                </View>
              )}

              {/* Fantasy Points Summary */}
              {avgFpts !== null && (
                <View style={[styles.fptsSection, { backgroundColor: c.activeCard, borderColor: c.activeBorder }]}>
                  <ThemedText style={[styles.fptsLabel, { color: c.secondaryText }]}>
                    Avg Fantasy Points
                  </ThemedText>
                  <ThemedText style={[styles.fptsValue, { color: c.activeText }]}>
                    {avgFpts}
                  </ThemedText>
                </View>
              )}

              {/* Season Averages */}
              <View style={styles.section}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Season Averages
                </ThemedText>
                <View style={[styles.statsGrid, { backgroundColor: c.card }]}>
                  <StatBox label="PPG" value={String(player.avg_pts)} color={c.secondaryText} />
                  <StatBox label="RPG" value={String(player.avg_reb)} color={c.secondaryText} />
                  <StatBox label="APG" value={String(player.avg_ast)} color={c.secondaryText} />
                  <StatBox label="SPG" value={String(player.avg_stl)} color={c.secondaryText} />
                  <StatBox label="BPG" value={String(player.avg_blk)} color={c.secondaryText} />
                  <StatBox label="TPG" value={String(player.avg_tov)} color={c.secondaryText} />
                  <StatBox label="FG%" value={`${fgPct}%`} color={c.secondaryText} />
                  <StatBox label="3P%" value={`${threePct}%`} color={c.secondaryText} />
                  <StatBox label="FT%" value={`${ftPct}%`} color={c.secondaryText} />
                  <StatBox label="MPG" value={String(player.avg_min)} color={c.secondaryText} />
                </View>
              </View>

              {/* Game Log Header */}
              <View style={styles.section}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Game Log
                </ThemedText>
                <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
                  <ThemedText style={[styles.gameCell, styles.gameCellWide, styles.gameHeaderText, { color: c.secondaryText }]}>
                    GAME
                  </ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>PTS</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>REB</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>AST</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>STL</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>BLK</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>TO</ThemedText>
                  {scoringWeights && (
                    <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>FPTS</ThemedText>
                  )}
                </View>
              </View>

              {isLoadingGameLog && <ActivityIndicator style={styles.loading} />}
            </>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 22,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    marginTop: -4,
    marginRight: -4,
  },
  closeText: {
    fontSize: 18,
  },
  actionSection: {
    paddingHorizontal: 16,
    paddingTop: 16,
  },
  addButton: {
    backgroundColor: '#28a745',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  dropButton: {
    backgroundColor: '#dc3545',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  draftWarning: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 6,
  },
  fptsSection: {
    margin: 16,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  fptsLabel: {
    fontSize: 13,
  },
  fptsValue: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 8,
    padding: 8,
  },
  statBox: {
    width: '20%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gameHeader: {
    paddingBottom: 6,
  },
  gameHeaderText: {
    fontSize: 10,
    fontWeight: '600',
  },
  gameCell: {
    width: 40,
    textAlign: 'center',
    fontSize: 13,
  },
  gameCellWide: {
    flex: 1,
    textAlign: 'left',
  },
  loading: {
    padding: 20,
  },
  dropPickerList: {
    padding: 8,
  },
  dropPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  dropPickerInfo: {
    flex: 1,
  },
  dropPickerSub: {
    fontSize: 12,
    marginTop: 2,
  },
  dropPickerFpts: {
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 12,
  },
});
