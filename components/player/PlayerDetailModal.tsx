import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayerGameLog } from '@/hooks/usePlayerGameLog';
import { supabase } from '@/lib/supabase';
import { PlayerGameLog, PlayerSeasonStats } from '@/types/player';
import { Ionicons } from '@expo/vector-icons';
import { calculateAvgFantasyPoints, calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface PlayerDetailModalProps {
  player: PlayerSeasonStats | null;
  leagueId: string;
  teamId?: string;
  onClose: () => void;
  onRosterChange?: () => void;
  startInDropPicker?: boolean;
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statBox}>
      <ThemedText style={[styles.statLabel, { color }]}>{label}</ThemedText>
      <ThemedText type="defaultSemiBold">{value}</ThemedText>
    </View>
  );
}

export function PlayerDetailModal({ player, leagueId, teamId, onClose, onRosterChange, startInDropPicker }: PlayerDetailModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [isProcessing, setIsProcessing] = useState(false);
  const [showDropPicker, setShowDropPicker] = useState(false);

  useEffect(() => {
    if (player && startInDropPicker) setShowDropPicker(true);
  }, [player, startInDropPicker]);

  const { data: scoringWeights, isLoading: isLoadingScoring } = useLeagueScoring(leagueId);
  const { data: gameLog, isLoading: isLoadingGameLog } = usePlayerGameLog(
    player?.player_id ?? ''
  );

  // Check if this player is on the user's team and get their current slot
  const { data: ownershipInfo, isLoading: isLoadingOwnership } = useQuery({
    queryKey: ['playerOwnership', leagueId, teamId, player?.player_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('id, roster_slot, on_trade_block')
        .eq('league_id', leagueId)
        .eq('team_id', teamId!)
        .eq('player_id', player!.player_id)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return { isOnMyTeam: false, rosterSlot: null, onTradeBlock: false };
      return { isOnMyTeam: true, rosterSlot: data[0].roster_slot as string | null, onTradeBlock: data[0].on_trade_block as boolean };
    },
    enabled: !!player && !!teamId && !!leagueId,
  });

  const isOnMyTeam = ownershipInfo?.isOnMyTeam ?? false;
  const playerRosterSlot = ownershipInfo?.rosterSlot ?? null;
  const isOnTradeBlock = ownershipInfo?.onTradeBlock ?? false;

  // Get roster counts, max size, and IR capacity
  const { data: rosterInfo } = useQuery({
    queryKey: ['rosterInfo', leagueId, teamId],
    queryFn: async () => {
      const [allPlayersRes, irPlayersRes, leagueRes, irConfigRes] = await Promise.all([
        supabase
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId!),
        supabase
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId!)
          .eq('roster_slot', 'IR'),
        supabase
          .from('leagues')
          .select('roster_size')
          .eq('id', leagueId)
          .single(),
        supabase
          .from('league_roster_config')
          .select('slot_count')
          .eq('league_id', leagueId)
          .eq('position', 'IR')
          .maybeSingle(),
      ]);

      if (allPlayersRes.error) throw allPlayersRes.error;
      if (irPlayersRes.error) throw irPlayersRes.error;
      if (leagueRes.error) throw leagueRes.error;

      const irCount = irPlayersRes.count ?? 0;
      const activeCount = (allPlayersRes.count ?? 0) - irCount;
      return {
        activeCount,
        irCount,
        irSlotCount: irConfigRes.data?.slot_count ?? 0,
        maxSize: leagueRes.data?.roster_size ?? 13,
      };
    },
    enabled: !!teamId && !!leagueId,
  });

  // Fetch roster players for the drop picker (exclude IR — dropping them doesn't free active spots)
  const { data: rosterPlayers } = useQuery<PlayerSeasonStats[]>({
    queryKey: ['teamRoster', teamId],
    queryFn: async () => {
      const { data: leaguePlayers, error: lpError } = await supabase
        .from('league_players')
        .select('player_id, roster_slot')
        .eq('team_id', teamId!)
        .eq('league_id', leagueId);

      if (lpError) throw lpError;
      if (!leaguePlayers || leaguePlayers.length === 0) return [];

      const activePlayerIds = leaguePlayers
        .filter((lp) => lp.roster_slot !== 'IR')
        .map((lp) => lp.player_id);

      if (activePlayerIds.length === 0) return [];

      const { data, error } = await supabase
        .from('player_season_stats')
        .select('*')
        .in('player_id', activePlayerIds);

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

  const handleClose = () => {
    setShowDropPicker(false);
    onClose();
  };

  // Swipe-to-dismiss gesture
  const translateY = useRef(new Animated.Value(0)).current;
  const dismissRef = useRef<() => void>(handleClose);
  dismissRef.current = showDropPicker
    ? (startInDropPicker ? handleClose : () => setShowDropPicker(false))
    : handleClose;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 10,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          Animated.timing(translateY, {
            toValue: 500,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            dismissRef.current();
            translateY.setValue(0);
          });
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 8,
          }).start();
        }
      },
    })
  ).current;

  // Reset translate when switching between sub-modals
  useEffect(() => {
    translateY.setValue(0);
  }, [showDropPicker]);

  if (!player) return null;

  const rosterIsFull = rosterInfo
    ? rosterInfo.activeCount >= rosterInfo.maxSize
    : false;

  const canMoveToIR = rosterInfo
    ? (player.status === 'OUT' || player.status === 'SUSP') &&
      rosterInfo.irSlotCount > 0 &&
      rosterInfo.irCount < rosterInfo.irSlotCount
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

      // If dropping from the picker (add-and-drop), handle as a single transaction
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

        const { data: txn, error: txnError } = await supabase
          .from('league_transactions')
          .insert({
            league_id: leagueId,
            type: 'waiver',
            notes: `Added ${player.name} (dropped ${dropping.name})`,
          })
          .select('id')
          .single();
        if (txnError) throw txnError;

        await supabase.from('league_transaction_items').insert([
          { transaction_id: txn.id, player_id: player.player_id, team_to_id: teamId },
          { transaction_id: txn.id, player_id: dropping.player_id, team_from_id: teamId },
        ]);

        invalidateRosterQueries();
        setShowDropPicker(false);
        onClose();
      } else {
        // Pure drop (no add)
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
          team_from_id: teamId,
        });

        invalidateRosterQueries();
        onClose();
      }
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to drop player');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleMoveToIR = async () => {
    if (!teamId || !player) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('league_players')
        .update({ roster_slot: 'IR' })
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('player_id', player.player_id);
      if (error) throw error;
      invalidateRosterQueries();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to move player to IR');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleActivateFromIR = async () => {
    if (!teamId || !player) return;
    if (rosterInfo && rosterInfo.activeCount >= rosterInfo.maxSize) {
      Alert.alert(
        'Active Roster Full',
        'You must drop an active player before activating from IR.'
      );
      return;
    }
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('league_players')
        .update({ roster_slot: 'BE' })
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('player_id', player.player_id);
      if (error) throw error;
      invalidateRosterQueries();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to activate player');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleToggleTradeBlock = () => {
    if (!teamId || !player) return;
    const newValue = !isOnTradeBlock;
    const message = newValue
      ? `Add ${player.name} to the trade block? Other managers will see this player is available.`
      : `Remove ${player.name} from the trade block?`;
    Alert.alert(
      newValue ? 'Add to Trade Block' : 'Remove from Trade Block',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: newValue ? 'Add' : 'Remove',
          onPress: async () => {
            setIsProcessing(true);
            try {
              const { error } = await supabase
                .from('league_players')
                .update({ on_trade_block: newValue })
                .eq('league_id', leagueId)
                .eq('team_id', teamId)
                .eq('player_id', player.player_id);
              if (error) throw error;
              queryClient.invalidateQueries({ queryKey: ['playerOwnership', leagueId, teamId, player.player_id] });
              queryClient.invalidateQueries({ queryKey: ['tradeBlock', leagueId] });
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to update trade block');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  const canTransact = !!teamId && !hasActiveDraft && !isProcessing;
  const canAdd = canTransact;

  const formatGameDate = (dateStr?: string) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr + 'T00:00:00');
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  const statColumns = [
    'MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO',
    'FGM', 'FGA', '3PM', '3PA', 'FTM', 'FTA', 'PF',
  ] as const;

  const getStatValue = (item: PlayerGameLog, col: string) => {
    switch (col) {
      case 'MIN': return item.min;
      case 'PTS': return item.pts;
      case 'REB': return item.reb;
      case 'AST': return item.ast;
      case 'STL': return item.stl;
      case 'BLK': return item.blk;
      case 'TO': return item.tov;
      case 'FGM': return item.fgm;
      case 'FGA': return item.fga;
      case '3PM': return item['3pm'];
      case '3PA': return item['3pa'];
      case 'FTM': return item.ftm;
      case 'FTA': return item.fta;
      case 'PF': return item.pf;
      default: return 0;
    }
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
      <Modal visible animationType="slide" transparent>
        <View style={styles.overlay}>
          <Animated.View style={[styles.sheet, { backgroundColor: c.background, transform: [{ translateY }] }]}>
            <View {...panResponder.panHandlers}>
              <View style={[styles.header, { borderBottomColor: c.border }]}>
                <View style={styles.headerInfo}>
                  <ThemedText type="title" style={styles.playerName}>Drop a Player</ThemedText>
                  <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                    Your roster is full. Select a player to drop in order to add {player.name}.
                  </ThemedText>
                </View>
                <TouchableOpacity onPress={() => startInDropPicker ? handleClose() : setShowDropPicker(false)} style={styles.closeButton}>
                  <ThemedText style={styles.closeText}>✕</ThemedText>
                </TouchableOpacity>
              </View>
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
          </Animated.View>
        </View>
      </Modal>
    );
  }

  return (
    <Modal visible={!!player} animationType="slide" transparent>
      <View style={styles.overlay}>
        <Animated.View style={[styles.sheet, { backgroundColor: c.background, transform: [{ translateY }] }]}>
          {/* Header - swipe area */}
          <View {...panResponder.panHandlers}>
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              <View style={styles.headerInfo}>
                <ThemedText type="title" style={styles.playerName}>{player.name}</ThemedText>
                <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                  {formatPosition(player.position)} · {player.nba_team} · {player.games_played} GP
                  {(() => {
                    const badge = getInjuryBadge(player.status);
                    return badge ? (
                      <ThemedText style={[styles.outBadge, { color: badge.color }]}> · {badge.label}</ThemedText>
                    ) : null;
                  })()}
                </ThemedText>
              </View>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
                <ThemedText style={styles.closeText}>✕</ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView>
                {/* Action Buttons */}
                {teamId && isLoadingOwnership && (
                  <View style={styles.actionSection}>
                    <View style={[styles.skeletonButton, { backgroundColor: c.border }]} />
                  </View>
                )}
                {teamId && ownershipInfo !== undefined && (
                  <View style={styles.actionSection}>
                    {isOnMyTeam ? (
                      playerRosterSlot === 'IR' ? (
                        // Player is on IR: show Activate + Drop
                        <View style={styles.actionRow}>
                          <TouchableOpacity
                            style={[styles.activateButton, styles.actionRowButton, !canTransact && styles.buttonDisabled]}
                            onPress={handleActivateFromIR}
                            disabled={!canTransact}
                          >
                            {isProcessing ? (
                              <ActivityIndicator size="small" color="#fff" />
                            ) : (
                              <ThemedText style={styles.actionButtonText}>Activate</ThemedText>
                            )}
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.dropButton, styles.actionRowButton, !canTransact && styles.buttonDisabled]}
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
                            <ThemedText style={styles.actionButtonText}>Drop</ThemedText>
                          </TouchableOpacity>
                        </View>
                      ) : (
                        // Player is active: show Drop + optionally Move to IR
                        <View style={canMoveToIR ? styles.actionRow : undefined}>
                          <TouchableOpacity
                            style={[
                              styles.dropButton,
                              canMoveToIR && styles.actionRowButton,
                              !canTransact && styles.buttonDisabled,
                            ]}
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
                          {canMoveToIR && (
                            <TouchableOpacity
                              style={[styles.irButton, styles.actionRowButton, !canTransact && styles.buttonDisabled]}
                              onPress={handleMoveToIR}
                              disabled={!canTransact}
                            >
                              <ThemedText style={styles.actionButtonText}>Move to IR</ThemedText>
                            </TouchableOpacity>
                          )}
                        </View>
                      )
                    ) : (
                      <TouchableOpacity
                        style={[styles.addButton, !canAdd && styles.buttonDisabled]}
                        onPress={handleAddPlayer}
                        disabled={!canAdd}
                      >
                        {isProcessing ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <ThemedText style={styles.actionButtonText}>
                            {rosterIsFull ? 'Add / Drop' : 'Add Player'}
                          </ThemedText>
                        )}
                      </TouchableOpacity>
                    )}

                    {/* Trade Block toggle — only for players on my team */}
                    {isOnMyTeam && (
                      <TouchableOpacity
                        style={[styles.tradeBlockBtn, { borderColor: isOnTradeBlock ? '#dc3545' : c.accent }]}
                        onPress={handleToggleTradeBlock}
                        disabled={isProcessing}
                      >
                        <Ionicons
                          name={isOnTradeBlock ? 'close-circle-outline' : 'megaphone-outline'}
                          size={16}
                          color={isOnTradeBlock ? '#dc3545' : c.accent}
                        />
                        <ThemedText style={[styles.tradeBlockBtnText, { color: isOnTradeBlock ? '#dc3545' : c.accent }]}>
                          {isOnTradeBlock ? 'Remove from Trade Block' : 'Add to Trade Block'}
                        </ThemedText>
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
                {avgFpts === null && isLoadingScoring && (
                  <View style={[styles.fptsSection, { backgroundColor: c.activeCard, borderColor: c.activeBorder }]}>
                    <View style={[styles.skeletonBlock, { width: 120, backgroundColor: c.border, marginBottom: 4 }]} />
                    <View style={[styles.skeletonBlock, { width: 60, height: 40, backgroundColor: c.border }]} />
                  </View>
                )}
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

                {/* Game Log */}
                <View style={styles.section}>
                  <ThemedText type="subtitle" style={styles.sectionTitle}>
                    Game Log
                  </ThemedText>
                </View>

                {isLoadingGameLog && (
                  <View style={styles.gameLogContainer}>
                    <View style={styles.pinnedLeft}>
                      <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
                        <ThemedText style={[styles.gameCell, styles.gameCellDate, styles.gameHeaderText, { color: c.secondaryText }]}>DATE</ThemedText>
                        <ThemedText style={[styles.gameCell, styles.gameCellMatchup, styles.gameHeaderText, { color: c.secondaryText }]}>OPP</ThemedText>
                      </View>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <View key={i} style={[styles.gameRow, { borderBottomColor: c.border }]}>
                          <View style={[styles.skeletonBlock, styles.gameCellDate, { backgroundColor: c.border }]} />
                          <View style={[styles.skeletonBlock, styles.gameCellMatchup, { backgroundColor: c.border }]} />
                        </View>
                      ))}
                    </View>
                    <View style={styles.scrollableStats}>
                      <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
                        {statColumns.map((col) => (
                          <ThemedText key={col} style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>{col}</ThemedText>
                        ))}
                      </View>
                      {Array.from({ length: 6 }).map((_, i) => (
                        <View key={i} style={[styles.gameRow, { borderBottomColor: c.border }]}>
                          {statColumns.map((col) => (
                            <View key={col} style={[styles.skeletonBlock, { width: 38, backgroundColor: c.border }]} />
                          ))}
                        </View>
                      ))}
                    </View>
                    {scoringWeights && (
                      <View style={styles.pinnedRight}>
                        <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
                          <ThemedText style={[styles.gameCell, styles.gameCellFpts, styles.gameHeaderText, { color: c.accent }]}>FPTS</ThemedText>
                        </View>
                        {Array.from({ length: 6 }).map((_, i) => (
                          <View key={i} style={[styles.gameRow, { borderBottomColor: c.border }]}>
                            <View style={[styles.skeletonBlock, { width: 44, backgroundColor: c.border }]} />
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                )}

                {/* Game log table: DATE + OPP pinned left, stats scroll together, FPTS pinned right */}
                {!isLoadingGameLog && <View style={styles.gameLogContainer}>
                  {/* Pinned left: DATE + OPP */}
                  <View style={styles.pinnedLeft}>
                    <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
                      <ThemedText style={[styles.gameCell, styles.gameCellDate, styles.gameHeaderText, { color: c.secondaryText }]}>
                        DATE
                      </ThemedText>
                      <ThemedText style={[styles.gameCell, styles.gameCellMatchup, styles.gameHeaderText, { color: c.secondaryText }]}>
                        OPP
                      </ThemedText>
                    </View>
                    {(gameLog ?? []).map((item) => (
                      <View key={item.id} style={[styles.gameRow, { borderBottomColor: c.border }]}>
                        <ThemedText style={[styles.gameCell, styles.gameCellDate, { color: c.secondaryText }]} numberOfLines={1}>
                          {formatGameDate(item.game_date)}
                        </ThemedText>
                        <ThemedText style={[styles.gameCell, styles.gameCellMatchup, { color: c.secondaryText }]} numberOfLines={1}>
                          {item.matchup ? item.matchup.replace(/^vs\s*/i, '') : '—'}
                        </ThemedText>
                      </View>
                    ))}
                  </View>

                  {/* Scrollable middle: all stat columns scroll as one */}
                  <ScrollView horizontal showsHorizontalScrollIndicator style={styles.scrollableStats}>
                    <View>
                      <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
                        {statColumns.map((col) => (
                          <ThemedText
                            key={col}
                            style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}
                          >
                            {col}
                          </ThemedText>
                        ))}
                      </View>
                      {(gameLog ?? []).map((item) => {
                        const isDNP = item.min === 0;
                        return (
                          <View key={item.id} style={[styles.gameRow, { borderBottomColor: c.border }]}>
                            {statColumns.map((col) => (
                              <ThemedText
                                key={col}
                                style={[styles.gameCell, isDNP && styles.gameCellDNP]}
                              >
                                {getStatValue(item, col)}
                              </ThemedText>
                            ))}
                          </View>
                        );
                      })}
                    </View>
                  </ScrollView>

                  {/* Pinned right: FPTS */}
                  {scoringWeights && (
                    <View style={styles.pinnedRight}>
                      <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
                        <ThemedText style={[styles.gameCell, styles.gameCellFpts, styles.gameHeaderText, { color: c.accent }]}>
                          FPTS
                        </ThemedText>
                      </View>
                      {(gameLog ?? []).map((item) => {
                        const isDNP = item.min === 0;
                        const fpts = calculateGameFantasyPoints(item, scoringWeights);
                        return (
                          <View key={item.id} style={[styles.gameRow, { borderBottomColor: c.border }]}>
                            <ThemedText style={[styles.gameCell, styles.gameCellFpts, isDNP ? styles.gameCellDNP : { color: c.accent, fontWeight: '600' }]}>
                              {fpts}
                            </ThemedText>
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    minHeight: '80%',
    maxHeight: '92%',
    overflow: 'hidden',
    paddingBottom: 32,
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
  outBadge: {
    fontWeight: '700',
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
  actionRow: {
    flexDirection: 'row',
    gap: 8,
  },
  actionRowButton: {
    flex: 1,
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
  irButton: {
    backgroundColor: '#e67e22',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  activateButton: {
    backgroundColor: '#28a745',
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
  tradeBlockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 8,
    paddingVertical: 10,
    marginTop: 8,
  },
  tradeBlockBtnText: {
    fontSize: 14,
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
    width: 38,
    textAlign: 'center',
    fontSize: 13,
  },
  gameCellDate: {
    width: 42,
    textAlign: 'left',
  },
  gameCellMatchup: {
    width: 42,
    textAlign: 'left',
  },
  gameCellFpts: {
    width: 44,
  },
  gameCellDNP: {
    opacity: 0.35,
  },
  gameLogContainer: {
    flexDirection: 'row',
  },
  pinnedLeft: {
    flexShrink: 0,
  },
  pinnedRight: {
    flexShrink: 0,
  },
  scrollableStats: {
    flex: 1,
  },
  skeletonBlock: {
    height: 12,
    borderRadius: 4,
    opacity: 0.4,
  },
  skeletonButton: {
    height: 44,
    borderRadius: 8,
    opacity: 0.3,
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
