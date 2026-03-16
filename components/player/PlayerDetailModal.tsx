import { ThemedText } from '@/components/ThemedText';
import { PlayerGameLog } from '@/components/player/PlayerGameLog';
import { PlayerInsightsCard } from '@/components/player/PlayerInsights';
import { Colors } from '@/constants/Colors';
import { useToast } from '@/context/ToastProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayerGameLog } from '@/hooks/usePlayerGameLog';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { isOnline } from '@/utils/network';
import { toDateStr } from '@/utils/dates';
import { PlayerSeasonStats } from '@/types/player';
import { Ionicons } from '@expo/vector-icons';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/injuryBadge';
import { useTodayGameTimes, isGameStarted } from '@/utils/gameStarted';
import { useLivePlayerStats, liveToGameLog, formatGameInfo } from '@/utils/nbaLive';
import { getPlayerHeadshotUrl, getTeamLogoUrl } from '@/utils/playerHeadshot';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { isTaxiEligible } from '@/utils/taxiEligibility';
import { useWatchlist } from '@/hooks/useWatchlist';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
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
  /** When provided, the drop picker calls this instead of doing an instant add-and-drop */
  onDropForClaim?: (dropPlayer: PlayerSeasonStats) => void;
  /** When provided, the Add/Claim button calls this instead of doing an instant add */
  onClaimPlayer?: () => void;
  /** Pre-fetched owner team name from parent — avoids flash while ownership query loads */
  ownerTeamName?: string;
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statBox} accessibilityLabel={`${label}: ${value}`}>
      <ThemedText style={[styles.statLabel, { color }]}>{label}</ThemedText>
      <ThemedText type="defaultSemiBold">{value}</ThemedText>
    </View>
  );
}

export function PlayerDetailModal({ player, leagueId, teamId, onClose, onRosterChange, startInDropPicker, onDropForClaim, onClaimPlayer, ownerTeamName }: PlayerDetailModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { isWatchlisted, toggleWatchlist } = useWatchlist();

  const [isProcessing, setIsProcessing] = useState(false);
  const [showDropPicker, setShowDropPicker] = useState(false);
  const [insightsWindow, setInsightsWindow] = useState(10);
  const [showWindowPicker, setShowWindowPicker] = useState(false);
  const [tradeBlockPromptVisible, setTradeBlockPromptVisible] = useState(false);
  const [tradeBlockNoteInput, setTradeBlockNoteInput] = useState('');

  useEffect(() => {
    if (player && startInDropPicker) setShowDropPicker(true);
  }, [player, startInDropPicker]);

  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { data: gameLog, isLoading: isLoadingGameLog } = usePlayerGameLog(
    player?.player_id ?? ''
  );

  // Fetch scoring type for insights branching
  const { data: leagueScoringType } = useQuery({
    queryKey: ['leagueScoringType', leagueId],
    queryFn: async () => {
      const { data } = await supabase
        .from('leagues')
        .select('scoring_type')
        .eq('id', leagueId)
        .single();
      return data?.scoring_type as string | null;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 30,
  });
  const isCategories = leagueScoringType === 'h2h_categories';

  // Check if this player is on the user's team and get their current slot
  const { data: ownershipInfo } = useQuery({
    queryKey: ['playerOwnership', leagueId, teamId, player?.player_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('id, roster_slot, on_trade_block, trade_block_note')
        .eq('league_id', leagueId)
        .eq('team_id', teamId!)
        .eq('player_id', player!.player_id)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return { isOnMyTeam: false, rosterSlot: null, onTradeBlock: false };
      return { isOnMyTeam: true, rosterSlot: data[0].roster_slot as string | null, onTradeBlock: data[0].on_trade_block as boolean, tradeBlockNote: (data[0].trade_block_note as string | null) ?? '' };
    },
    enabled: !!player && !!teamId && !!leagueId,
  });

  const isOnMyTeam = ownershipInfo?.isOnMyTeam ?? false;
  const playerRosterSlot = ownershipInfo?.rosterSlot ?? null;
  const isOnTradeBlock = ownershipInfo?.onTradeBlock ?? false;

  // Check if player is owned by another team — use prop from parent if available, otherwise query
  const { data: queriedOwnerInfo, isLoading: ownershipLoading } = useQuery({
    queryKey: ['playerLeagueOwnership', leagueId, player?.player_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('league_players')
        .select('team_id')
        .eq('league_id', leagueId)
        .eq('player_id', player!.player_id)
        .limit(1);

      if (error) throw error;
      if (!data || data.length === 0) return null;

      const ownerTeamId = data[0].team_id as string;
      const { data: team } = await supabase
        .from('teams')
        .select('name')
        .eq('id', ownerTeamId)
        .single();

      return { teamName: (team?.name as string) ?? 'Unknown' };
    },
    // Skip the query if parent already told us the answer
    enabled: !!player && !!leagueId && ownerTeamName === undefined,
  });

  // Use prop if available, otherwise fall back to query result
  const resolvedOwnerName = ownerTeamName ?? queriedOwnerInfo?.teamName ?? null;
  const isOwnedByOther = !isOnMyTeam && !!resolvedOwnerName;
  const isFreeAgent = ownerTeamName !== undefined
    ? !isOnMyTeam && !resolvedOwnerName
    : !isOnMyTeam && !ownershipLoading && !queriedOwnerInfo;

  // Get roster counts, max size, IR capacity, and waiver settings
  const { data: rosterInfo } = useQuery({
    queryKey: ['rosterInfo', leagueId, teamId],
    queryFn: async () => {
      const [allPlayersRes, irPlayersRes, taxiPlayersRes, leagueRes, irConfigRes, taxiConfigRes] = await Promise.all([
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
          .from('league_players')
          .select('id', { count: 'exact', head: true })
          .eq('league_id', leagueId)
          .eq('team_id', teamId!)
          .eq('roster_slot', 'TAXI'),
        supabase
          .from('leagues')
          .select('roster_size, waiver_type, waiver_period_days, taxi_slots, taxi_max_experience, season, offseason_step')
          .eq('id', leagueId)
          .single(),
        supabase
          .from('league_roster_config')
          .select('slot_count')
          .eq('league_id', leagueId)
          .eq('position', 'IR')
          .maybeSingle(),
        supabase
          .from('league_roster_config')
          .select('slot_count')
          .eq('league_id', leagueId)
          .eq('position', 'TAXI')
          .maybeSingle(),
      ]);

      if (allPlayersRes.error) throw allPlayersRes.error;
      if (irPlayersRes.error) throw irPlayersRes.error;
      if (leagueRes.error) throw leagueRes.error;

      const irCount = irPlayersRes.count ?? 0;
      const taxiCount = taxiPlayersRes.count ?? 0;
      const activeCount = (allPlayersRes.count ?? 0) - irCount - taxiCount;
      return {
        activeCount,
        irCount,
        irSlotCount: irConfigRes.data?.slot_count ?? 0,
        taxiCount,
        taxiSlotCount: taxiConfigRes.data?.slot_count ?? 0,
        taxiMaxExperience: leagueRes.data?.taxi_max_experience as number | null,
        season: leagueRes.data?.season as string,
        maxSize: leagueRes.data?.roster_size ?? 13,
        waiverType: (leagueRes.data?.waiver_type ?? 'none') as 'standard' | 'faab' | 'none',
        waiverPeriodDays: leagueRes.data?.waiver_period_days ?? 2,
        offseasonStep: leagueRes.data?.offseason_step as string | null,
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

  // Check if weekly acquisition limit is reached
  // Returns the count of adds this week (same shape as FreeAgentList's query
  // which shares the cache key ['weeklyAdds', leagueId, teamId])
  const { data: weeklyAddsCount } = useQuery({
    queryKey: ['weeklyAdds', leagueId, teamId],
    queryFn: async () => {
      const now = new Date();
      const day = now.getDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const monday = new Date(now);
      monday.setDate(now.getDate() + mondayOffset);
      const weekStart = monday.toISOString().split('T')[0];

      const { count, error } = await supabase
        .from('league_transactions')
        .select('id, league_transaction_items!inner(team_to_id)', { count: 'exact', head: true })
        .eq('league_id', leagueId)
        .eq('team_id', teamId!)
        .eq('type', 'waiver')
        .not('league_transaction_items.team_to_id', 'is', null)
        .gte('created_at', weekStart + 'T00:00:00');
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!leagueId && !!teamId && !isOnMyTeam,
  });

  const { data: weeklyAcqLimit } = useQuery({
    queryKey: ['weeklyAcqLimit', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('weekly_acquisition_limit')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data?.weekly_acquisition_limit as number | null;
    },
    enabled: !!leagueId && !isOnMyTeam,
  });

  const addsExhausted = weeklyAcqLimit != null && (weeklyAddsCount ?? 0) >= weeklyAcqLimit;

  // How many games has this player's team played so far this season?
  const { data: teamGamesPlayed } = useQuery({
    queryKey: ['teamGamesPlayed', player?.nba_team],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { count, error } = await supabase
        .from('nba_schedule')
        .select('id', { count: 'exact', head: true })
        .eq('season', CURRENT_NBA_SEASON)
        .or(`home_team.eq.${player!.nba_team},away_team.eq.${player!.nba_team}`)
        .lte('game_date', today);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!player,
  });

  // Game lock detection
  const gameTimeMap = useTodayGameTimes(!!player);
  const playerGameStarted = player ? isGameStarted(player.nba_team, gameTimeMap) : false;

  // Live stats for today's game
  const playerIdArr = player ? [player.player_id] : [];
  const liveMap = useLivePlayerStats(playerIdArr, !!player);
  const liveStats = player ? liveMap.get(player.player_id) ?? null : null;

  // Next 3 upcoming games
  const { data: upcomingGames } = useQuery({
    queryKey: ['upcomingGames', player?.nba_team],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data, error } = await supabase
        .from('nba_schedule')
        .select('game_date, home_team, away_team, game_time_utc')
        .eq('season', CURRENT_NBA_SEASON)
        .or(`home_team.eq.${player!.nba_team},away_team.eq.${player!.nba_team}`)
        .gte('game_date', today)
        .order('game_date', { ascending: true })
        .limit(4);
      if (error) throw error;
      return (data ?? []).map((g) => {
        const isHome = g.home_team === player!.nba_team;
        return {
          game_date: g.game_date as string,
          opponent: isHome ? g.away_team : g.home_team,
          prefix: isHome ? 'vs' : '@',
          game_time_utc: g.game_time_utc as string | null,
        };
      });
    },
    enabled: !!player?.nba_team,
    staleTime: 1000 * 60 * 60,
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

  // Check if this free agent player is on waivers
  const { data: playerOnWaivers } = useQuery({
    queryKey: ['playerOnWaivers', leagueId, player?.player_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('league_waivers')
        .select('id')
        .eq('league_id', leagueId)
        .eq('player_id', player!.player_id)
        .gt('on_waivers_until', new Date().toISOString())
        .limit(1);
      return (data?.length ?? 0) > 0;
    },
    enabled: !!player && !!leagueId && !isOnMyTeam && rosterInfo?.waiverType === 'standard',
  });

  if (!player) return null;

  const waiverType = rosterInfo?.waiverType ?? 'none';
  const needsWaiverClaim = waiverType === 'faab' || (waiverType === 'standard' && (playerOnWaivers ?? false));

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
    queryClient.invalidateQueries({ queryKey: ['allPlayers', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['leagueOwnership', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['teamRoster', teamId] });
    queryClient.invalidateQueries({ queryKey: ['rosterInfo', leagueId, teamId] });
    queryClient.invalidateQueries({ queryKey: ['freeAgentRosterInfo', leagueId, teamId] });
    queryClient.invalidateQueries({ queryKey: ['playerOwnership', leagueId, teamId] });
    queryClient.invalidateQueries({ queryKey: ['leagueRosterStats', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['weeklyAdds', leagueId, teamId] });
    onRosterChange?.();
  };

  // Submit a waiver claim natively (used when no external callback is provided)
  const submitWaiverClaim = async (dropPlayerId?: string) => {
    if (!teamId || !player) return;
    const { data: wp } = await supabase
      .from('waiver_priority')
      .select('priority')
      .eq('league_id', leagueId)
      .eq('team_id', teamId)
      .single();

    const { error } = await supabase.from('waiver_claims').insert({
      league_id: leagueId,
      team_id: teamId,
      player_id: player.player_id,
      drop_player_id: dropPlayerId ?? null,
      bid_amount: 0,
      priority: wp?.priority ?? 99,
    });
    if (error) throw error;

    queryClient.invalidateQueries({ queryKey: ['pendingClaims', leagueId, teamId] });
    queryClient.invalidateQueries({ queryKey: ['faabRemaining', leagueId, teamId] });
    queryClient.invalidateQueries({ queryKey: ['waiverOrder', leagueId] });
    Alert.alert('Claim Submitted', `Waiver claim for ${player.name} submitted.`);
  };

  const handleAddPlayer = async () => {
    if (!teamId || !player) return;
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }

    // If this player requires a waiver claim, delegate to the claim callback
    // or handle natively if no callback provided
    if (needsWaiverClaim) {
      if (rosterIsFull) {
        setShowDropPicker(true);
        return;
      }
      if (onClaimPlayer) {
        onClaimPlayer();
        return;
      }
      // No callback — handle the claim natively
      setIsProcessing(true);
      try {
        await submitWaiverClaim();
        onClose();
      } catch (err: any) {
        Alert.alert('Error', err.message ?? 'Failed to submit claim');
      } finally {
        setIsProcessing(false);
      }
      return;
    }

    if (rosterIsFull) {
      setShowDropPicker(true);
      return;
    }

    setIsProcessing(true);
    try {
      // Re-check roster limit before adding
      const [allRes, irRes, leagueRes] = await Promise.all([
        supabase.from('league_players').select('id', { count: 'exact', head: true }).eq('league_id', leagueId).eq('team_id', teamId!),
        supabase.from('league_players').select('id', { count: 'exact', head: true }).eq('league_id', leagueId).eq('team_id', teamId!).eq('roster_slot', 'IR'),
        supabase.from('leagues').select('roster_size').eq('id', leagueId).single(),
      ]);
      const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
      const maxSize = leagueRes.data?.roster_size ?? 13;
      if (activeCount >= maxSize) {
        queryClient.invalidateQueries({ queryKey: ['rosterInfo', leagueId, teamId] });
        setShowDropPicker(true);
        setIsProcessing(false);
        return;
      }

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
          team_id: teamId,
        })
        .select('id')
        .single();
      if (txnError) throw txnError;

      await supabase.from('league_transaction_items').insert({
        transaction_id: txn.id,
        player_id: player.player_id,
        team_to_id: teamId,
      });

      // Fire-and-forget notification to league
      (async () => {
        const { data: team } = await supabase.from('teams').select('name').eq('id', teamId).single();
        sendNotification({
          league_id: leagueId,
          category: 'roster_moves',
          title: 'Roster Move',
          body: `${team?.name ?? 'A team'} added ${player.name}`,
          data: { screen: 'activity' },
        });
      })();

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
    if (!(await isOnline())) { showToast('error', 'No internet connection'); return; }

    setIsProcessing(true);
    try {
      // For add-and-drop, check weekly acquisition limit before proceeding
      if (playerToDrop && player) {
        const { data: limitData } = await supabase
          .from('leagues')
          .select('weekly_acquisition_limit')
          .eq('id', leagueId)
          .single();
        const wkLimit = limitData?.weekly_acquisition_limit as number | null;
        if (wkLimit != null) {
          const now = new Date();
          const day = now.getDay();
          const mondayOffset = day === 0 ? -6 : 1 - day;
          const monday = new Date(now);
          monday.setDate(now.getDate() + mondayOffset);
          const weekStart = monday.toISOString().split('T')[0];

          const { count: addsThisWeek } = await supabase
            .from('league_transactions')
            .select('id, league_transaction_items!inner(team_to_id)', { count: 'exact', head: true })
            .eq('league_id', leagueId)
            .eq('team_id', teamId)
            .eq('type', 'waiver')
            .not('league_transaction_items.team_to_id', 'is', null)
            .gte('created_at', weekStart + 'T00:00:00');

          if ((addsThisWeek ?? 0) >= wkLimit) {
            invalidateRosterQueries();
            Alert.alert('Add Limit Reached', `You've used all ${wkLimit} adds for this week.`);
            setIsProcessing(false);
            return;
          }
        }
      }
      // Snapshot the player's current slot before deleting so they still
      // appear on prior days of the week. A 'DROPPED' sentinel on today
      // ensures they disappear from today onward.
      const today = toDateStr(new Date());
      const { data: lpRow } = await supabase
        .from('league_players')
        .select('roster_slot')
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('player_id', dropping.player_id)
        .single();
      const slot = lpRow?.roster_slot ?? 'BE';

      const { data: week } = await supabase
        .from('league_schedule')
        .select('start_date')
        .eq('league_id', leagueId)
        .lte('start_date', today)
        .gte('end_date', today)
        .single();

      if (week) {
        await supabase.from('daily_lineups').upsert(
          { league_id: leagueId, team_id: teamId, player_id: dropping.player_id, lineup_date: week.start_date, roster_slot: slot },
          { onConflict: 'team_id,player_id,lineup_date', ignoreDuplicates: true },
        );
        await supabase.from('daily_lineups').upsert(
          { league_id: leagueId, team_id: teamId, player_id: dropping.player_id, lineup_date: today, roster_slot: 'DROPPED' },
          { onConflict: 'team_id,player_id,lineup_date' },
        );
        // Remove any future lineup entries so the dropped player doesn't appear on future dates
        await supabase.from('daily_lineups').delete()
          .eq('league_id', leagueId)
          .eq('team_id', teamId)
          .eq('player_id', dropping.player_id)
          .gt('lineup_date', today);
      }

      const { error: delError } = await supabase
        .from('league_players')
        .delete()
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('player_id', dropping.player_id);
      if (delError) throw delError;

      // Put dropped player on waivers if league has waivers enabled
      const wt = rosterInfo?.waiverType ?? 'none';
      const wpDays = rosterInfo?.waiverPeriodDays ?? 2;
      if (wt !== 'none' && wpDays > 0) {
        // Round up to the next 6 AM UTC boundary after the waiver period expires
        // so the displayed time matches the actual cron processing time
        const raw = new Date();
        raw.setDate(raw.getDate() + wpDays);
        const until = new Date(Date.UTC(
          raw.getUTCFullYear(), raw.getUTCMonth(), raw.getUTCDate(), 6, 0, 0, 0
        ));
        // If the raw time is already past 6 AM UTC on that day, push to next day
        if (raw.getTime() > until.getTime()) {
          until.setUTCDate(until.getUTCDate() + 1);
        }
        await supabase.from('league_waivers').insert({
          league_id: leagueId,
          player_id: dropping.player_id,
          on_waivers_until: until.toISOString(),
          dropped_by_team_id: teamId,
        });
      }

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
            team_id: teamId,
          })
          .select('id')
          .single();
        if (txnError) throw txnError;

        await supabase.from('league_transaction_items').insert([
          { transaction_id: txn.id, player_id: player.player_id, team_to_id: teamId },
          { transaction_id: txn.id, player_id: dropping.player_id, team_from_id: teamId },
        ]);

        // Fire-and-forget notification to league
        (async () => {
          const { data: team } = await supabase.from('teams').select('name').eq('id', teamId).single();
          sendNotification({
            league_id: leagueId,
            category: 'roster_moves',
            title: 'Roster Move',
            body: `${team?.name ?? 'A team'} added ${player.name} (dropped ${dropping.name})`,
            data: { screen: 'activity' },
          });
        })();

        invalidateRosterQueries();
        queryClient.invalidateQueries({ queryKey: ['leagueWaivers', leagueId] });
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
            team_id: teamId,
          })
          .select('id')
          .single();
        if (txnError) throw txnError;

        await supabase.from('league_transaction_items').insert({
          transaction_id: txn.id,
          player_id: dropping.player_id,
          team_from_id: teamId,
        });

        // Fire-and-forget notification to league
        (async () => {
          const { data: team } = await supabase.from('teams').select('name').eq('id', teamId).single();
          sendNotification({
            league_id: leagueId,
            category: 'roster_moves',
            title: 'Roster Move',
            body: `${team?.name ?? 'A team'} dropped ${dropping.name}`,
            data: { screen: 'activity' },
          });
        })();

        invalidateRosterQueries();
        queryClient.invalidateQueries({ queryKey: ['leagueWaivers', leagueId] });
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

  const handleMoveToTaxi = async () => {
    if (!teamId || !player) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('league_players')
        .update({ roster_slot: 'TAXI' })
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('player_id', player.player_id);
      if (error) throw error;
      invalidateRosterQueries();
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to move player to taxi squad');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePromoteFromTaxi = () => {
    if (!teamId || !player) return;
    Alert.alert(
      'Promote from Taxi',
      `Move ${player.name} to bench? This is permanent — they cannot return to the taxi squad.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Promote',
          onPress: async () => {
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
              Alert.alert('Error', err.message ?? 'Failed to promote player');
            } finally {
              setIsProcessing(false);
            }
          },
        },
      ]
    );
  };

  const handleToggleTradeBlock = () => {
    if (!teamId || !player) return;
    if (!isOnTradeBlock) {
      // Adding — show prompt for asking price / note
      setTradeBlockNoteInput(ownershipInfo?.tradeBlockNote ?? '');
      setTradeBlockPromptVisible(true);
    } else {
      // Removing
      Alert.alert(
        'Remove from Trade Block',
        `Remove ${player.name} from the trade block?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Remove', onPress: () => submitTradeBlockUpdate(false, null) },
        ]
      );
    }
  };

  const submitTradeBlockUpdate = async (newValue: boolean, note: string | null) => {
    if (!teamId || !player) return;
    setIsProcessing(true);
    try {
      const { error } = await supabase
        .from('league_players')
        .update({ on_trade_block: newValue, trade_block_note: note })
        .eq('league_id', leagueId)
        .eq('team_id', teamId)
        .eq('player_id', player.player_id);
      if (error) throw error;
      queryClient.setQueryData(
        ['playerOwnership', leagueId, teamId, player.player_id],
        (old: any) => old ? { ...old, onTradeBlock: newValue, tradeBlockNote: note ?? '' } : old,
      );
      queryClient.invalidateQueries({ queryKey: ['tradeBlock', leagueId] });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to update trade block');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleQueueDrop = async () => {
    if (!teamId || !player || !leagueId) return;
    setIsProcessing(true);
    try {
      const { data: existing } = await supabase
        .from('pending_transactions')
        .select('id')
        .eq('team_id', teamId)
        .eq('player_id', player.player_id)
        .eq('status', 'pending')
        .limit(1);

      if (existing && existing.length > 0) {
        Alert.alert('Already Queued', `${player.name} is already queued to be dropped.`);
        return;
      }

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const executeAfter = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

      const { error } = await supabase.from('pending_transactions').insert({
        league_id: leagueId,
        team_id: teamId,
        player_id: player.player_id,
        action_type: 'drop',
        execute_after: executeAfter,
        status: 'pending',
      });
      if (error) throw error;

      Alert.alert('Drop Queued', `${player.name} will be dropped tomorrow.`);
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to queue drop');
    } finally {
      setIsProcessing(false);
    }
  };

  const isOffseason = rosterInfo?.offseasonStep != null;
  const canTransact = !!teamId && !hasActiveDraft && !isProcessing && !isOffseason;
  const canAdd = canTransact && !addsExhausted;

  const renderDropPickerItem = ({ item, index }: { item: PlayerSeasonStats; index: number }) => {
    const fpts = scoringWeights
      ? calculateAvgFantasyPoints(item, scoringWeights)
      : null;
    const dropPickerData = (rosterPlayers ?? []).filter(p => !isGameStarted(p.nba_team, gameTimeMap));

    return (
      <TouchableOpacity
        style={[styles.dropPickerRow, { borderBottomColor: c.border }, index === dropPickerData.length - 1 && { borderBottomWidth: 0 }]}
        accessibilityRole="button"
        accessibilityLabel={`Drop ${item.name}, ${formatPosition(item.position)}, ${item.nba_team}${fpts !== null ? `, ${fpts} fantasy points` : ''}`}
        onPress={() => {
          if (onDropForClaim) {
            Alert.alert(
              'Select Drop for Claim',
              `Drop ${item.name} when your claim for ${player.name} processes?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Confirm', onPress: () => { onDropForClaim(item); handleClose(); } },
              ]
            );
          } else if (needsWaiverClaim) {
            // No external callback but player needs a claim — submit natively
            Alert.alert(
              'Select Drop for Claim',
              `Drop ${item.name} when your claim for ${player.name} processes?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Submit Claim', onPress: async () => {
                  setIsProcessing(true);
                  try {
                    await submitWaiverClaim(item.player_id);
                    handleClose();
                  } catch (err: any) {
                    Alert.alert('Error', err.message ?? 'Failed to submit claim');
                  } finally {
                    setIsProcessing(false);
                  }
                }},
              ]
            );
          } else {
            Alert.alert(
              'Confirm Transaction',
              `Drop ${item.name} to add ${player.name}?`,
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Confirm', style: 'destructive', onPress: () => handleDropPlayer(item) },
              ]
            );
          }
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
          <Animated.View style={[styles.sheet, { backgroundColor: c.background, transform: [{ translateY }] }]} accessibilityViewIsModal={true}>
            <View {...panResponder.panHandlers}>
              <View style={[styles.header, { borderBottomColor: c.border }]}>
                <View style={styles.headerInfo}>
                  <ThemedText type="title" style={styles.playerName} accessibilityRole="header">Drop a Player</ThemedText>
                  <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                    Your roster is full. Select a player to drop in order to add {player.name}.
                  </ThemedText>
                </View>
                <TouchableOpacity onPress={() => startInDropPicker ? handleClose() : setShowDropPicker(false)} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close">
                  <ThemedText style={styles.closeText}>✕</ThemedText>
                </TouchableOpacity>
              </View>
            </View>

            {isProcessing ? (
              <ActivityIndicator style={styles.loading} />
            ) : (
              <FlatList
                data={(rosterPlayers ?? []).filter(p => !isGameStarted(p.nba_team, gameTimeMap))}
                renderItem={renderDropPickerItem}
                keyExtractor={(item) => item.player_id}
                contentContainerStyle={styles.dropPickerList}
                maxToRenderPerBatch={10}
                windowSize={5}
                ListEmptyComponent={
                  <View style={{ padding: 20, alignItems: 'center' }}>
                    <ThemedText style={{ color: c.secondaryText, textAlign: 'center' }}>
                      All your roster players have games in progress. Try again later.
                    </ThemedText>
                  </View>
                }
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
        <Animated.View style={[styles.sheet, { backgroundColor: c.background, transform: [{ translateY }] }]} accessibilityViewIsModal={true}>
          {/* Header - swipe area */}
          <View {...panResponder.panHandlers}>
            <View style={[styles.header, { borderBottomColor: c.border }]}>
              {(() => {
                const headshotUrl = getPlayerHeadshotUrl(player.external_id_nba, '1040x760');
                return headshotUrl ? (
                  <Image
                    source={{ uri: headshotUrl }}
                    style={styles.headerHeadshot}
                    resizeMode="cover"
                    accessibilityLabel={`${player.name} headshot`}
                  />
                ) : null;
              })()}
              <View style={styles.headerInfo}>
                <View style={styles.nameRow}>
                  <ThemedText type="title" style={styles.playerName} numberOfLines={1}>{player.name}</ThemedText>
                  {/* Compact action buttons — right of name */}
                  {teamId && ownershipInfo !== undefined && (
                    <View style={styles.headerActions}>
                      {isOnMyTeam ? (
                        <>
                          {playerRosterSlot === 'IR' && (
                            <TouchableOpacity
                              style={[styles.headerBtn, styles.headerBtnActivate, (!canTransact || playerGameStarted) && styles.buttonDisabled]}
                              onPress={handleActivateFromIR}
                              disabled={!canTransact || playerGameStarted}
                              accessibilityRole="button"
                              accessibilityLabel={`Activate ${player.name} from IR`}
                            >
                              {isProcessing ? <ActivityIndicator size="small" color="#fff" /> : (
                                <ThemedText style={styles.headerBtnText}>Activate</ThemedText>
                              )}
                            </TouchableOpacity>
                          )}
                          {playerRosterSlot === 'TAXI' && (
                            <TouchableOpacity
                              style={[styles.headerBtn, styles.headerBtnActivate, !canTransact && styles.buttonDisabled]}
                              onPress={handlePromoteFromTaxi}
                              disabled={!canTransact}
                              accessibilityRole="button"
                              accessibilityLabel={`Promote ${player.name} from taxi squad`}
                            >
                              {isProcessing ? <ActivityIndicator size="small" color="#fff" /> : (
                                <ThemedText style={styles.headerBtnText}>Promote</ThemedText>
                              )}
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={[
                              styles.headerBtn,
                              playerGameStarted ? styles.headerBtnQueue : styles.headerBtnDrop,
                              !canTransact && styles.buttonDisabled,
                            ]}
                            accessibilityRole="button"
                            accessibilityLabel={playerGameStarted ? `Queue drop for ${player.name}` : `Drop ${player.name}`}
                            onPress={() => {
                              if (playerGameStarted) {
                                handleQueueDrop();
                              } else {
                                Alert.alert(
                                  'Drop Player',
                                  `Are you sure you want to drop ${player.name}?`,
                                  [
                                    { text: 'Cancel', style: 'cancel' },
                                    { text: 'Drop', style: 'destructive', onPress: () => handleDropPlayer() },
                                  ]
                                );
                              }
                            }}
                            disabled={!canTransact}
                          >
                            {isProcessing && playerRosterSlot !== 'IR' ? <ActivityIndicator size="small" color="#fff" /> : (
                              <ThemedText style={styles.headerBtnText}>
                                {playerGameStarted ? 'Queue' : 'Drop'}
                              </ThemedText>
                            )}
                          </TouchableOpacity>
                          {canMoveToIR && !playerGameStarted && playerRosterSlot !== 'IR' && playerRosterSlot !== 'TAXI' && (
                            <TouchableOpacity
                              style={[styles.headerBtn, styles.headerBtnIR, !canTransact && styles.buttonDisabled]}
                              onPress={handleMoveToIR}
                              disabled={!canTransact}
                              accessibilityRole="button"
                              accessibilityLabel={`Move ${player.name} to IR`}
                            >
                              <ThemedText style={styles.headerBtnText}>IR</ThemedText>
                            </TouchableOpacity>
                          )}
                          {rosterInfo && rosterInfo.taxiSlotCount > 0 && rosterInfo.taxiCount < rosterInfo.taxiSlotCount
                            && playerRosterSlot !== 'TAXI' && playerRosterSlot !== 'IR'
                            && (!playerRosterSlot || playerRosterSlot === 'BE')
                            && isTaxiEligible(player.nba_draft_year, rosterInfo.season, rosterInfo.taxiMaxExperience) && (
                            <TouchableOpacity
                              style={[styles.headerBtn, styles.headerBtnTaxi, !canTransact && styles.buttonDisabled]}
                              onPress={handleMoveToTaxi}
                              disabled={!canTransact}
                              accessibilityRole="button"
                              accessibilityLabel={`Move ${player.name} to taxi squad`}
                            >
                              <ThemedText style={styles.headerBtnText}>Taxi</ThemedText>
                            </TouchableOpacity>
                          )}
                          <TouchableOpacity
                            style={[styles.headerBtn, isOnTradeBlock ? styles.headerBtnTradeBlockActive : styles.headerBtnTradeBlock, isProcessing && styles.buttonDisabled]}
                            onPress={handleToggleTradeBlock}
                            disabled={isProcessing}
                            accessibilityRole="button"
                            accessibilityLabel={isOnTradeBlock ? `Remove ${player.name} from trade block` : `Add ${player.name} to trade block`}
                          >
                            <Ionicons
                              name={isOnTradeBlock ? 'megaphone' : 'megaphone-outline'}
                              size={12}
                              color="#fff"
                            />
                          </TouchableOpacity>
                        </>
                      ) : isFreeAgent ? (
                        <TouchableOpacity
                          style={[styles.headerBtn, needsWaiverClaim ? styles.headerBtnClaim : styles.headerBtnAdd, !canAdd && styles.buttonDisabled]}
                          onPress={handleAddPlayer}
                          disabled={!canAdd}
                          accessibilityRole="button"
                          accessibilityLabel={needsWaiverClaim ? `Claim ${player.name}` : `Add ${player.name}`}
                        >
                          {isProcessing ? <ActivityIndicator size="small" color="#fff" /> : (
                            <ThemedText style={styles.headerBtnText}>{needsWaiverClaim ? 'Claim' : 'Add'}</ThemedText>
                          )}
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  )}
                </View>
                <View style={styles.subtitleRow}>
                  {(() => {
                    const logoUrl = getTeamLogoUrl(player.nba_team);
                    return logoUrl ? (
                      <Image source={{ uri: logoUrl }} style={styles.modalTeamLogo} resizeMode="contain" />
                    ) : null;
                  })()}
                  <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
                    {formatPosition(player.position)} · {isOnMyTeam ? (
                      <ThemedText style={[styles.subtitle, { color: c.accent }]}>Your team</ThemedText>
                    ) : isOwnedByOther ? (
                      <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>{resolvedOwnerName}</ThemedText>
                    ) : (
                      <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>{player.nba_team}</ThemedText>
                    )} · {player.games_played}{teamGamesPlayed ? `/${teamGamesPlayed}` : ''} GP
                    {(() => {
                      const badge = getInjuryBadge(player.status);
                      return badge ? (
                        <ThemedText style={[styles.outBadge, { color: badge.color }]}> · {badge.label}</ThemedText>
                      ) : null;
                    })()}
                  </ThemedText>
                  {hasActiveDraft && (
                    <ThemedText style={[styles.headerWarning, { color: c.secondaryText }]}> · Draft locked</ThemedText>
                  )}
                  {isOffseason && !hasActiveDraft && (
                    <ThemedText style={[styles.headerWarning, { color: c.secondaryText }]}> · Offseason locked</ThemedText>
                  )}
                  <TouchableOpacity
                    onPress={() => toggleWatchlist(player.player_id)}
                    hitSlop={8}
                    style={{ marginLeft: 4 }}
                    accessibilityRole="button"
                    accessibilityLabel={isWatchlisted(player.player_id) ? `Remove ${player.name} from watchlist` : `Add ${player.name} to watchlist`}
                  >
                    <Ionicons
                      name={isWatchlisted(player.player_id) ? 'eye' : 'eye-outline'}
                      size={18}
                      color={isWatchlisted(player.player_id) ? '#007AFF' : c.secondaryText}
                    />
                  </TouchableOpacity>
                </View>
              </View>
              <TouchableOpacity onPress={handleClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close player details">
                <ThemedText style={styles.closeText}>✕</ThemedText>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView contentContainerStyle={styles.scrollContent}>
                {/* Season Averages */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <ThemedText type="subtitle" style={styles.sectionTitle}>
                      Season Averages
                    </ThemedText>
                    {avgFpts !== null && !isCategories && (
                      <ThemedText style={[styles.fptsInline, { color: c.accent }]}>
                        {avgFpts} FPTS
                      </ThemedText>
                    )}
                  </View>
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

                {/* Player Insights */}
                <View style={styles.section}>
                  <View style={styles.sectionHeader}>
                    <ThemedText type="subtitle" style={styles.sectionTitle}>
                      Player Insights
                    </ThemedText>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <View>
                        <TouchableOpacity
                          onPress={() => setShowWindowPicker((v) => !v)}
                          style={[styles.windowPickerBtn, { borderColor: c.border }]}
                          accessibilityRole="button"
                          accessibilityLabel={`Trend window: last ${insightsWindow} games. Tap to change.`}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        >
                          <Ionicons name="filter-outline" size={14} color={c.secondaryText} />
                          <ThemedText style={[styles.windowPickerLabel, { color: c.secondaryText }]}>
                            {insightsWindow}
                          </ThemedText>
                        </TouchableOpacity>
                        {showWindowPicker && (
                          <>
                            <TouchableOpacity
                              style={styles.windowDropdownBackdrop}
                              activeOpacity={1}
                              onPress={() => setShowWindowPicker(false)}
                              accessibilityLabel="Close window picker"
                            />
                            <View style={[styles.windowDropdown, { backgroundColor: c.card, borderColor: c.border }]}>
                              {[5, 10, 15, 25, 50].map((w) => (
                                <TouchableOpacity
                                  key={w}
                                  onPress={() => { setInsightsWindow(w); setShowWindowPicker(false); }}
                                  style={[
                                    styles.windowDropdownItem,
                                    w === insightsWindow && { backgroundColor: c.accent },
                                  ]}
                                  accessibilityRole="button"
                                  accessibilityState={{ selected: w === insightsWindow }}
                                  accessibilityLabel={`Last ${w} games`}
                                >
                                  <ThemedText style={[
                                    styles.windowDropdownText,
                                    { color: c.secondaryText },
                                    w === insightsWindow && { color: '#fff' },
                                  ]}>
                                    {w}
                                  </ThemedText>
                                </TouchableOpacity>
                              ))}
                            </View>
                          </>
                        )}
                      </View>
                      <TouchableOpacity
                        onPress={() => Alert.alert(
                          'Player Insights',
                          isCategories
                            ? 'Strengths — Per-category consistency, sorted by reliability:\n'
                              + '• Rock Solid: Very consistent output\n'
                              + '• Steady: Reliable most nights\n'
                              + '• Variable: Notable swings\n'
                              + '• Boom or Bust: Huge range\n\n'
                              + '↓ — Indicates an inverse stat (lower is better, e.g. turnovers).\n\n'
                              + 'Trends — How each category is trending recently vs the season average:\n'
                              + '• Scorching / Hot: Trending up\n'
                              + '• Stable: Playing as expected\n'
                              + '• Cold / Frigid: Trending down\n\n'
                              + 'For inverse stats, trend colors are flipped — a downward trend (fewer turnovers) shows green.\n\n'
                              + 'Use the filter icon to change how many recent games are used for the trend calculation.'
                            : 'Consistency — How predictable this player\'s scoring is, based on game-to-game variability:\n'
                              + '• Rock Solid: Very consistent output\n'
                              + '• Steady: Reliable most nights\n'
                              + '• Variable: Notable swings\n'
                              + '• Boom or Bust: Huge range\n\n'
                              + '± FPTS/game — Standard deviation. Lower = more consistent.\n\n'
                              + 'Trend — Compares the recent average to the season average, relative to the player\'s own variability:\n'
                              + '• Scorching: Well above normal\n'
                              + '• Hot: Trending up\n'
                              + '• Stable: Playing as expected\n'
                              + '• Cold: Trending down\n'
                              + '• Frigid: Well below normal\n\n'
                              + 'Range Bar — Shows the full scoring range (low to high). The shaded area is the 25th–75th percentile (where most games land). The marker is the season average.\n\n'
                              + 'Floor — 25th percentile. On a bad night, expect around this.\n\n'
                              + 'Ceiling — 75th percentile. On a good night, expect around this.\n\n'
                              + 'Minutes — Whether playing time is trending up or down recently.\n\n'
                              + 'Home / Away — Average FPTS split by home and away games.\n\n'
                              + 'Back-to-Back — Performance on the 2nd game of back-to-backs vs rest games.\n\n'
                              + 'Bounce-Back Rate — How often the player recovers to their average after a bad game (below 25th percentile).\n\n'
                              + 'Use the filter icon to change how many recent games are used for the trend calculation.',
                        )}
                        accessibilityRole="button"
                        accessibilityLabel="Player insights info"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="information-circle-outline" size={18} color={c.secondaryText} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
                <PlayerInsightsCard
                  games={gameLog}
                  scoringWeights={scoringWeights}
                  seasonAvg={avgFpts}
                  recentWindow={insightsWindow}
                  colors={{ border: c.border, secondaryText: c.secondaryText, accent: c.accent, card: c.card }}
                  scoringType={leagueScoringType ?? undefined}
                />

                {/* Game Log */}
                <View style={styles.section}>
                  <ThemedText type="subtitle" style={styles.sectionTitle}>
                    Game Log
                  </ThemedText>
                </View>

                <PlayerGameLog
                  gameLog={gameLog}
                  isLoading={isLoadingGameLog}
                  scoringWeights={scoringWeights}
                  upcomingGames={upcomingGames}
                  liveStats={liveStats}
                  liveToGameLog={liveToGameLog}
                  formatGameInfo={formatGameInfo}
                  playerName={player?.name ?? ''}
                  colors={{ border: c.border, secondaryText: c.secondaryText, accent: c.accent }}
                />
          </ScrollView>

          {/* Trade block note prompt — rendered inside the main modal */}
          {tradeBlockPromptVisible && (
            <KeyboardAvoidingView
              style={styles.tradeBlockPromptOverlay}
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
              <View style={[styles.tradeBlockPromptCard, { backgroundColor: c.card }]}>
                <ThemedText type="defaultSemiBold" style={styles.tradeBlockPromptTitle} accessibilityRole="header">
                  Add to Trade Block
                </ThemedText>
                <ThemedText style={[styles.tradeBlockPromptDesc, { color: c.secondaryText }]}>
                  What are you looking for? (optional)
                </ThemedText>
                <TextInput
                  style={[styles.tradeBlockPromptInput, { color: c.text, borderColor: c.border, backgroundColor: c.background }]}
                  value={tradeBlockNoteInput}
                  onChangeText={setTradeBlockNoteInput}
                  placeholder='e.g. "2nd Rounder", "Wing player"'
                  placeholderTextColor={c.secondaryText}
                  maxLength={100}
                  autoFocus
                  accessibilityLabel="Asking price or trade note"
                />
                <View style={styles.tradeBlockPromptButtons}>
                  <TouchableOpacity
                    style={[styles.tradeBlockPromptBtn, { borderColor: c.border }]}
                    onPress={() => setTradeBlockPromptVisible(false)}
                    accessibilityRole="button"
                    accessibilityLabel="Cancel"
                  >
                    <ThemedText>Cancel</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.tradeBlockPromptBtn, styles.tradeBlockPromptBtnConfirm]}
                    onPress={() => {
                      setTradeBlockPromptVisible(false);
                      submitTradeBlockUpdate(true, tradeBlockNoteInput.trim() || null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Add to trade block"
                  >
                    <ThemedText style={{ color: '#fff', fontWeight: '600' }}>Add</ThemedText>
                  </TouchableOpacity>
                </View>
              </View>
            </KeyboardAvoidingView>
          )}
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
  headerHeadshot: {
    width: 72,
    height: 54,
    borderRadius: 6,
    marginRight: 12,
    backgroundColor: 'transparent',
  },
  headerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 22,
    flexShrink: 1,
  },
  subtitleRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: 4,
    marginTop: 2,
  },
modalTeamLogo: {
    width: 14,
    height: 14,
    opacity: 0.6,
  },
  subtitle: {
    fontSize: 13,
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
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  headerBtn: {
    height: 26,
    paddingHorizontal: 10,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerBtnAdd: {
    backgroundColor: '#28a745',
  },
  headerBtnClaim: {
    backgroundColor: '#D4A017',
  },
  headerBtnDrop: {
    backgroundColor: '#dc3545',
  },
  headerBtnQueue: {
    backgroundColor: '#e67e22',
  },
  headerBtnIR: {
    backgroundColor: '#e67e22',
  },
  headerBtnTaxi: {
    backgroundColor: '#8e44ad',
  },
  headerBtnActivate: {
    backgroundColor: '#28a745',
  },
  headerBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  headerBtnTradeBlock: {
    backgroundColor: '#6c757d',
  },
  headerBtnTradeBlockActive: {
    backgroundColor: '#e67e22',
  },
  headerWarning: {
    fontSize: 10,
    marginTop: 2,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  scrollContent: {
    paddingTop: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  fptsInline: {
    fontSize: 14,
    fontWeight: '700',
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
  windowPickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
  },
  windowPickerLabel: {
    fontSize: 11,
    fontWeight: '600',
  },
  windowDropdownBackdrop: {
    position: 'absolute',
    top: 0,
    left: -1000,
    right: -1000,
    bottom: -1000,
    zIndex: 9,
  },
  windowDropdown: {
    position: 'absolute',
    top: '100%',
    right: 0,
    marginTop: 4,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 4,
    zIndex: 10,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    minWidth: 52,
  },
  windowDropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    alignItems: 'center',
  },
  windowDropdownText: {
    fontSize: 13,
    fontWeight: '600',
  },
  tradeBlockPromptOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    zIndex: 100,
  },
  tradeBlockPromptCard: {
    borderRadius: 14,
    padding: 20,
    width: '100%',
    maxWidth: 340,
  },
  tradeBlockPromptTitle: {
    fontSize: 17,
    marginBottom: 4,
  },
  tradeBlockPromptDesc: {
    fontSize: 13,
    marginBottom: 12,
  },
  tradeBlockPromptInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 16,
  },
  tradeBlockPromptButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  tradeBlockPromptBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  tradeBlockPromptBtnConfirm: {
    backgroundColor: '#e67e22',
  },
});
