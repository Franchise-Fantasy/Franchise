import { TradeFairnessBar } from '@/components/trade/TradeFairnessBar';
import { TradePickPicker } from '@/components/trade/TradePickPicker';
import { TradePlayerPicker } from '@/components/trade/TradePlayerPicker';
import { TradeSwapPicker } from '@/components/trade/TradeSwapPicker';
import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLockedTradeAssets } from '@/hooks/useTeamRosterForTrade';
import { sendNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';
import {
  TradeBuilderPick,
  TradeBuilderPlayer,
  TradeBuilderSwap,
  TradeBuilderTeam,
  estimatePickFpts,
  formatPickLabel,
  formatProtection,
} from '@/types/trade';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useReducer, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface PreselectedPlayer {
  player_id: string;
  name: string;
  position: string;
  nba_team: string;
  avg_fpts?: number;
}

interface ProposeTradeModalProps {
  leagueId: string;
  teamId: string;
  preselectedTeamId?: string;
  preselectedPlayer?: PreselectedPlayer;
  /** When true, trade executes immediately (both teams auto-accepted, no veto). Used in draft room. */
  instantExecute?: boolean;
  onClose: () => void;
}

// --- State ---

interface TradeState {
  step: number; // 0=teams, 1=assets, 2=review
  selectedTeamIds: string[];
  builderTeams: TradeBuilderTeam[];
  notes: string;
}

type TradeAction =
  | { type: 'SEED_MY_TEAM'; teamId: string; teamName: string; partnerTeamId?: string; partnerTeamName?: string; preselectedPlayer?: PreselectedPlayer }
  | { type: 'TOGGLE_TEAM'; teamId: string; teamName: string; myTeamId: string }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'ADD_PLAYER'; teamId: string; player: TradeBuilderPlayer }
  | { type: 'REMOVE_PLAYER'; teamId: string; playerId: string }
  | { type: 'ADD_PICK'; teamId: string; pick: TradeBuilderPick }
  | { type: 'REMOVE_PICK'; teamId: string; pickId: string }
  | { type: 'SET_PLAYER_DEST'; teamId: string; playerId: string; toTeamId: string }
  | { type: 'SET_PICK_DEST'; teamId: string; pickId: string; toTeamId: string }
  | { type: 'SET_PICK_PROTECTION'; teamId: string; pickId: string; threshold: number | undefined }
  | { type: 'ADD_SWAP'; teamId: string; swap: TradeBuilderSwap }
  | { type: 'REMOVE_SWAP'; teamId: string; season: string; round: number }
  | { type: 'SET_NOTES'; notes: string };

function reducer(state: TradeState, action: TradeAction): TradeState {
  switch (action.type) {
    case 'SEED_MY_TEAM': {
      // One-time initialization: add my team (and optional preselected partner) to builder
      const builderTeams: TradeBuilderTeam[] = [
        { team_id: action.teamId, team_name: action.teamName, sending_players: [], sending_picks: [], sending_swaps: [] },
      ];
      const selectedTeamIds: string[] = [];
      if (action.partnerTeamId && action.partnerTeamName) {
        const sendingPlayers: TradeBuilderPlayer[] = [];
        if (action.preselectedPlayer) {
          sendingPlayers.push({
            player_id: action.preselectedPlayer.player_id,
            name: action.preselectedPlayer.name,
            position: action.preselectedPlayer.position,
            nba_team: action.preselectedPlayer.nba_team,
            avg_fpts: action.preselectedPlayer.avg_fpts ?? 0,
            to_team_id: action.teamId, // goes to my team
          });
        }
        builderTeams.push({
          team_id: action.partnerTeamId,
          team_name: action.partnerTeamName,
          sending_players: sendingPlayers,
          sending_picks: [],
          sending_swaps: [],
        });
        selectedTeamIds.push(action.partnerTeamId);
      }
      return { ...state, builderTeams, selectedTeamIds };
    }
    case 'TOGGLE_TEAM': {
      const exists = state.selectedTeamIds.includes(action.teamId);
      const selectedTeamIds = exists
        ? state.selectedTeamIds.filter((id) => id !== action.teamId)
        : [...state.selectedTeamIds, action.teamId];

      if (exists) {
        // Removing a team — remove their builder entry, fix any asset destinations pointing at them
        const remaining = selectedTeamIds.filter((id) => id !== action.myTeamId);
        const fallbackDest = remaining[0] ?? action.myTeamId;
        const builderTeams = state.builderTeams
          .filter((t) => t.team_id !== action.teamId)
          .map((t) => ({
            ...t,
            sending_players: t.sending_players.map((p) =>
              p.to_team_id === action.teamId ? { ...p, to_team_id: fallbackDest } : p
            ),
            sending_picks: t.sending_picks.map((pk) =>
              pk.to_team_id === action.teamId ? { ...pk, to_team_id: fallbackDest } : pk
            ),
          }));
        return { ...state, selectedTeamIds, builderTeams };
      } else {
        // Adding a team — create their builder entry
        const builderTeams = [
          ...state.builderTeams,
          {
            team_id: action.teamId,
            team_name: action.teamName,
            sending_players: [],
            sending_picks: [],
            sending_swaps: [],
          },
        ];
        return { ...state, selectedTeamIds, builderTeams };
      }
    }
    case 'NEXT_STEP':
      return { ...state, step: Math.min(state.step + 1, 2) };
    case 'PREV_STEP':
      return { ...state, step: Math.max(state.step - 1, 0) };
    case 'ADD_PLAYER': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_players: [...t.sending_players, action.player] }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'REMOVE_PLAYER': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_players: t.sending_players.filter((p) => p.player_id !== action.playerId) }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'ADD_PICK': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_picks: [...t.sending_picks, action.pick] }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'REMOVE_PICK': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_picks: t.sending_picks.filter((p) => p.draft_pick_id !== action.pickId) }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'SET_PLAYER_DEST': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_players: t.sending_players.map((p) =>
              p.player_id === action.playerId ? { ...p, to_team_id: action.toTeamId } : p
            ) }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'SET_PICK_DEST': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_picks: t.sending_picks.map((pk) =>
              pk.draft_pick_id === action.pickId ? { ...pk, to_team_id: action.toTeamId } : pk
            ) }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'SET_PICK_PROTECTION': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_picks: t.sending_picks.map((pk) =>
              pk.draft_pick_id === action.pickId ? { ...pk, protection_threshold: action.threshold } : pk
            ) }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'ADD_SWAP': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_swaps: [...t.sending_swaps, action.swap] }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'REMOVE_SWAP': {
      const builderTeams = state.builderTeams.map((t) =>
        t.team_id === action.teamId
          ? { ...t, sending_swaps: t.sending_swaps.filter((s) => !(s.season === action.season && s.round === action.round)) }
          : t
      );
      return { ...state, builderTeams };
    }
    case 'SET_NOTES':
      return { ...state, notes: action.notes };
    default:
      return state;
  }
}

// --- Component ---

export function ProposeTradeModal({
  leagueId,
  teamId,
  preselectedTeamId,
  preselectedPlayer,
  instantExecute = false,
  onClose,
}: ProposeTradeModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();

  const [submitting, setSubmitting] = useState(false);
  // Inline picker state: null = show assets, { type, teamId } = show picker inline
  const [pickerFor, setPickerFor] = useState<{ type: 'player' | 'pick' | 'swap'; teamId: string } | null>(null);

  // Fetch locked assets for the team currently in the picker
  const { data: lockedAssets } = useLockedTradeAssets(pickerFor?.teamId ?? null, leagueId);

  // Fetch all teams in the league
  const { data: leagueTeams } = useQuery({
    queryKey: ['leagueTeams', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name')
        .eq('league_id', leagueId)
        .order('name');
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
  });

  // Fetch league settings for pick conditions
  const { data: leagueSettings } = useQuery({
    queryKey: ['leagueTradeConditions', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('pick_conditions_enabled, draft_pick_trading_enabled, teams, max_future_seasons, rookie_draft_rounds, league_type')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const isDynastyLeague = (leagueSettings?.league_type ?? 'dynasty') === 'dynasty';
  const pickConditionsEnabled = isDynastyLeague && (leagueSettings?.pick_conditions_enabled ?? false);
  const draftPickTradingEnabled = isDynastyLeague && (leagueSettings?.draft_pick_trading_enabled ?? false);
  const teamCount = leagueSettings?.teams ?? 10;
  const maxFutureSeasons = leagueSettings?.max_future_seasons ?? 3;
  const rookieDraftRounds = leagueSettings?.rookie_draft_rounds ?? 2;

  // Build valid seasons for swap picker
  const validSeasons = (() => {
    const currentStartYear = parseInt(CURRENT_NBA_SEASON.split('-')[0], 10);
    const seasons: string[] = [];
    for (let i = 0; i <= maxFutureSeasons; i++) {
      const sy = currentStartYear + i;
      const ey = (sy + 1) % 100;
      seasons.push(`${sy}-${String(ey).padStart(2, '0')}`);
    }
    return seasons;
  })();

  // Find my team name
  const myTeam = leagueTeams?.find((t) => t.id === teamId);

  const [state, dispatch] = useReducer(reducer, {
    step: preselectedTeamId ? 1 : 0,
    selectedTeamIds: preselectedTeamId ? [preselectedTeamId] : [],
    builderTeams: [],
    notes: '',
  });

  // Seed builder teams once league teams load (runs once)
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !leagueTeams?.length || !myTeam) return;
    const preselectedTeam = preselectedTeamId
      ? leagueTeams.find((t) => t.id === preselectedTeamId)
      : null;

    // If a player is preselected, fetch their stats and compute avg_fpts before seeding
    if (preselectedPlayer) {
      let cancelled = false;
      supabase
        .from('player_season_stats')
        .select('*')
        .eq('player_id', preselectedPlayer.player_id)
        .maybeSingle()
        .then(({ data }) => {
          if (cancelled) return;
          const avgFpts = data && scoringWeights
            ? calculateAvgFantasyPoints(data as PlayerSeasonStats, scoringWeights)
            : 0;
          dispatch({
            type: 'SEED_MY_TEAM',
            teamId: teamId,
            teamName: myTeam.name,
            partnerTeamId: preselectedTeam?.id,
            partnerTeamName: preselectedTeam?.name,
            preselectedPlayer: { ...preselectedPlayer, avg_fpts: avgFpts },
          });
          setSeeded(true);
        });
      return () => { cancelled = true; };
    } else {
      dispatch({
        type: 'SEED_MY_TEAM',
        teamId: teamId,
        teamName: myTeam.name,
        partnerTeamId: preselectedTeam?.id,
        partnerTeamName: preselectedTeam?.name,
      });
      setSeeded(true);
    }
  }, [leagueTeams, myTeam, seeded, teamId, preselectedTeamId, preselectedPlayer, scoringWeights]);

  // allBuilderTeams: just use reducer state (seeding ensures my team is present)
  const allBuilderTeams = state.builderTeams;

  const otherTeams = (leagueTeams ?? []).filter((t) => t.id !== teamId);
  const hasAssets = allBuilderTeams.some(
    (t) => t.sending_players.length > 0 || t.sending_picks.length > 0 || t.sending_swaps.length > 0
  );

  const isSimpleTrade = state.selectedTeamIds.length === 1;
  const isMultiTeam = state.selectedTeamIds.length > 1;

  // Build a name lookup from builder teams
  const teamNameMap: Record<string, string> = {};
  for (const bt of allBuilderTeams) {
    teamNameMap[bt.team_id] = bt.team_name;
  }

  // Compute fairness using actual destination assignments
  const fairness = computeFairness(allBuilderTeams, teamId, isSimpleTrade);

  // All team IDs in the trade (for destination picker options)
  const allTradeTeamIds = [teamId, ...state.selectedTeamIds];

  // --- Submit ---
  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const items: Array<{
        player_id: string | null;
        draft_pick_id: string | null;
        from_team_id: string;
        to_team_id: string;
        protection_threshold?: number | null;
        pick_swap_season?: string | null;
        pick_swap_round?: number | null;
      }> = [];

      if (isSimpleTrade) {
        // 2-team trade: my sends go to other team, their sends go to me
        const otherTeamId = state.selectedTeamIds[0];
        const myBuilder = allBuilderTeams.find((t) => t.team_id === teamId);
        const otherBuilder = allBuilderTeams.find((t) => t.team_id === otherTeamId);

        for (const p of myBuilder?.sending_players ?? []) {
          items.push({ player_id: p.player_id, draft_pick_id: null, from_team_id: teamId, to_team_id: otherTeamId });
        }
        for (const pk of myBuilder?.sending_picks ?? []) {
          items.push({ player_id: null, draft_pick_id: pk.draft_pick_id, from_team_id: teamId, to_team_id: otherTeamId, protection_threshold: pk.protection_threshold ?? null });
        }
        for (const sw of myBuilder?.sending_swaps ?? []) {
          items.push({ player_id: null, draft_pick_id: null, from_team_id: sw.counterparty_team_id, to_team_id: sw.beneficiary_team_id, pick_swap_season: sw.season, pick_swap_round: sw.round });
        }
        for (const p of otherBuilder?.sending_players ?? []) {
          items.push({ player_id: p.player_id, draft_pick_id: null, from_team_id: otherTeamId, to_team_id: teamId });
        }
        for (const pk of otherBuilder?.sending_picks ?? []) {
          items.push({ player_id: null, draft_pick_id: pk.draft_pick_id, from_team_id: otherTeamId, to_team_id: teamId, protection_threshold: pk.protection_threshold ?? null });
        }
        for (const sw of otherBuilder?.sending_swaps ?? []) {
          items.push({ player_id: null, draft_pick_id: null, from_team_id: sw.counterparty_team_id, to_team_id: sw.beneficiary_team_id, pick_swap_season: sw.season, pick_swap_round: sw.round });
        }
      } else {
        // Multi-team: use each asset's explicit to_team_id destination
        for (const bt of allBuilderTeams) {
          for (const p of bt.sending_players) {
            items.push({ player_id: p.player_id, draft_pick_id: null, from_team_id: bt.team_id, to_team_id: p.to_team_id });
          }
          for (const pk of bt.sending_picks) {
            items.push({ player_id: null, draft_pick_id: pk.draft_pick_id, from_team_id: bt.team_id, to_team_id: pk.to_team_id, protection_threshold: pk.protection_threshold ?? null });
          }
          for (const sw of bt.sending_swaps) {
            items.push({ player_id: null, draft_pick_id: null, from_team_id: sw.counterparty_team_id, to_team_id: sw.beneficiary_team_id, pick_swap_season: sw.season, pick_swap_round: sw.round });
          }
        }
      }

      if (items.length === 0) {
        Alert.alert('No assets selected');
        setSubmitting(false);
        return;
      }

      if (instantExecute && state.selectedTeamIds.length > 1) {
        Alert.alert('Draft Trades', 'Only 2-team trades can be executed during the draft.');
        setSubmitting(false);
        return;
      }

      // 1. Create proposal
      const { data: proposal, error: propError } = await supabase
        .from('trade_proposals')
        .insert({
          league_id: leagueId,
          proposed_by_team_id: teamId,
          status: 'pending',
          notes: state.notes || null,
        })
        .select('id')
        .single();
      if (propError) throw propError;

      // 2. Create proposal teams (proposer = accepted, others = pending)
      const allTeamIds = [teamId, ...state.selectedTeamIds];
      const teamRows = allTeamIds.map((tid) => ({
        proposal_id: proposal.id,
        team_id: tid,
        status: tid === teamId ? 'accepted' : 'pending',
        responded_at: tid === teamId ? new Date().toISOString() : null,
      }));
      const { error: teamsError } = await supabase.from('trade_proposal_teams').insert(teamRows);
      if (teamsError) throw teamsError;

      // 3. Create proposal items
      const itemRows = items.map((item) => ({
        proposal_id: proposal.id,
        ...item,
      }));
      const { error: itemsError } = await supabase.from('trade_proposal_items').insert(itemRows);
      if (itemsError) throw itemsError;

      if (instantExecute) {
        // Draft room trades: set all teams accepted and execute immediately
        const { error: acceptError } = await supabase
          .from('trade_proposal_teams')
          .update({ status: 'accepted', responded_at: new Date().toISOString() })
          .eq('proposal_id', proposal.id);
        if (acceptError) throw acceptError;

        const { error: statusError } = await supabase
          .from('trade_proposals')
          .update({ status: 'accepted', accepted_at: new Date().toISOString() })
          .eq('id', proposal.id);
        if (statusError) throw statusError;

        const { error: execError } = await supabase.functions.invoke('execute-trade', {
          body: { proposal_id: proposal.id },
        });
        if (execError) throw execError;

        queryClient.invalidateQueries({ queryKey: ['tradeProposals', leagueId] });
        queryClient.invalidateQueries({ queryKey: ['pendingTradeCount'] });
        queryClient.invalidateQueries({ queryKey: ['tradablePicks'] });
        queryClient.invalidateQueries({ queryKey: ['draftOrder'] });
        Alert.alert('Trade Completed', 'The trade has been executed.');
        onClose();
        return;
      }

      // Normal flow: notify the other teams about the proposal
      sendNotification({
        league_id: leagueId,
        team_ids: state.selectedTeamIds,
        category: 'trades',
        title: 'Trade Proposed',
        body: `${myTeam?.name ?? 'A team'} has proposed a trade. Review it now.`,
        data: { screen: 'trades' },
      });

      queryClient.invalidateQueries({ queryKey: ['tradeProposals', leagueId] });
      queryClient.invalidateQueries({ queryKey: ['pendingTradeCount'] });
      onClose();
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to propose trade');
    } finally {
      setSubmitting(false);
    }
  };

  // --- Player/Pick toggle handlers ---
  // Default destination for a new asset: first team in the trade that isn't the sender
  const getDefaultDest = (senderTeamId: string) =>
    allTradeTeamIds.find((id) => id !== senderTeamId) ?? '';

  const handleTogglePlayer = (forTeamId: string) => (player: PlayerSeasonStats, avgFpts: number) => {
    const builder = allBuilderTeams.find((t) => t.team_id === forTeamId);
    const exists = builder?.sending_players.some((p) => p.player_id === player.player_id);
    if (exists) {
      dispatch({ type: 'REMOVE_PLAYER', teamId: forTeamId, playerId: player.player_id });
    } else {
      dispatch({
        type: 'ADD_PLAYER',
        teamId: forTeamId,
        player: {
          player_id: player.player_id,
          name: player.name,
          position: player.position,
          nba_team: player.nba_team,
          avg_fpts: avgFpts,
          to_team_id: getDefaultDest(forTeamId),
        },
      });
    }
  };

  const handleTogglePick = (forTeamId: string) => (pick: any) => {
    const builder = allBuilderTeams.find((t) => t.team_id === forTeamId);
    const exists = builder?.sending_picks.some((p) => p.draft_pick_id === pick.id);
    if (exists) {
      dispatch({ type: 'REMOVE_PICK', teamId: forTeamId, pickId: pick.id });
    } else {
      dispatch({
        type: 'ADD_PICK',
        teamId: forTeamId,
        pick: {
          draft_pick_id: pick.id,
          season: pick.season,
          round: pick.round,
          original_team_name: pick.original_team_name,
          estimated_fpts: estimatePickFpts(pick.round),
          to_team_id: getDefaultDest(forTeamId),
        },
      });
    }
  };

  // --- Render helpers ---

  const pickerTeamBuilder = pickerFor ? allBuilderTeams.find((t) => t.team_id === pickerFor.teamId) : null;
  const pickerTeamName = pickerTeamBuilder?.team_name ?? '';

  // Destination options for a given team (everyone except themselves)
  const getDestinationOptions = (forTeamId: string) =>
    allTradeTeamIds.filter((id) => id !== forTeamId);

  return (
    <Modal visible animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={[styles.sheet, { backgroundColor: c.background }]} accessibilityViewIsModal={true}>

          {/* If a picker is active, show it inline instead of the normal content */}
          {pickerFor ? (
            pickerFor.type === 'player' ? (
              <TradePlayerPicker
                teamId={pickerFor.teamId}
                teamName={pickerTeamName}
                leagueId={leagueId}
                selectedPlayerIds={
                  pickerTeamBuilder?.sending_players.map((p) => p.player_id) ?? []
                }
                lockedPlayerIds={lockedAssets?.lockedPlayerIds}
                onToggle={handleTogglePlayer(pickerFor.teamId)}
                onBack={() => setPickerFor(null)}
              />
            ) : pickerFor.type === 'pick' ? (
              <TradePickPicker
                teamId={pickerFor.teamId}
                teamName={pickerTeamName}
                leagueId={leagueId}
                selectedPickIds={
                  pickerTeamBuilder?.sending_picks.map((p) => p.draft_pick_id) ?? []
                }
                pickProtections={
                  Object.fromEntries(
                    (pickerTeamBuilder?.sending_picks ?? []).map((p) => [p.draft_pick_id, p.protection_threshold])
                  )
                }
                pickConditionsEnabled={pickConditionsEnabled}
                draftPickTradingEnabled={draftPickTradingEnabled}
                lockedPickIds={lockedAssets?.lockedPickIds}
                teamCount={teamCount}
                onToggle={handleTogglePick(pickerFor.teamId)}
                onSetProtection={(pickId, threshold) =>
                  dispatch({ type: 'SET_PICK_PROTECTION', teamId: pickerFor.teamId, pickId, threshold })
                }
                onBack={() => setPickerFor(null)}
              />
            ) : (
              <TradeSwapPicker
                validSeasons={validSeasons}
                rookieDraftRounds={rookieDraftRounds}
                counterpartyTeamId={pickerFor.teamId}
                counterpartyTeamName={pickerTeamName}
                {...(isSimpleTrade
                  ? {
                      beneficiaryTeamId: allTradeTeamIds.find((id) => id !== pickerFor.teamId) ?? teamId,
                      beneficiaryTeamName: teamNameMap[allTradeTeamIds.find((id) => id !== pickerFor.teamId) ?? teamId] ?? '',
                    }
                  : {
                      beneficiaryOptions: allTradeTeamIds
                        .filter((id) => id !== pickerFor.teamId)
                        .map((id) => ({ id, name: teamNameMap[id] ?? 'Unknown' })),
                    }
                )}
                onAdd={(season, round, selectedBeneficiaryId) => {
                  const beneficiaryId = selectedBeneficiaryId ?? allTradeTeamIds.find((id) => id !== pickerFor.teamId) ?? teamId;
                  dispatch({
                    type: 'ADD_SWAP',
                    teamId: pickerFor.teamId,
                    swap: {
                      season,
                      round,
                      counterparty_team_id: pickerFor.teamId,
                      beneficiary_team_id: beneficiaryId,
                    },
                  });
                  setPickerFor(null);
                }}
                onBack={() => setPickerFor(null)}
              />
            )
          ) : (
            <>
              {/* Header */}
              <View style={[styles.header, { borderBottomColor: c.border }]}>
                <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.headerTitle}>
                  {state.step === 0 ? 'Select Teams' : state.step === 1 ? 'Select Assets' : (instantExecute ? 'Confirm & Execute' : 'Review Trade')}
                </ThemedText>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
                  <ThemedText style={styles.closeText}>✕</ThemedText>
                </TouchableOpacity>
              </View>

              {/* Step 0: Team selection */}
              {state.step === 0 && (
                <FlatList
                  data={otherTeams}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.listContent}
                  renderItem={({ item }) => {
                    const selected = state.selectedTeamIds.includes(item.id);
                    return (
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={item.name}
                        accessibilityState={{ selected }}
                        style={[
                          styles.teamRow,
                          { borderBottomColor: c.border },
                          selected && { backgroundColor: c.activeCard },
                        ]}
                        onPress={() => dispatch({ type: 'TOGGLE_TEAM', teamId: item.id, teamName: item.name, myTeamId: teamId })}
                      >
                        <ThemedText type="defaultSemiBold">{item.name}</ThemedText>
                        <ThemedText style={styles.check}>{selected ? '✓' : ''}</ThemedText>
                      </TouchableOpacity>
                    );
                  }}
                />
              )}

              {/* Step 1: Asset selection — team cards scroll, fairness pinned below */}
              {state.step === 1 && !seeded && (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator size="large" />
                </View>
              )}
              {state.step === 1 && seeded && (
                <View style={styles.assetLayout}>
                  <ScrollView contentContainerStyle={styles.assetScroll} showsVerticalScrollIndicator={false}>
                    {allBuilderTeams.map((bt) => {
                      const isMe = bt.team_id === teamId;
                      const destOptions = getDestinationOptions(bt.team_id);

                      return (
                        <View key={bt.team_id} style={[styles.teamCard, { backgroundColor: c.card }]}>
                          {/* Card header: title left, add icons right */}
                          <View style={styles.cardHeader}>
                            <ThemedText accessibilityRole="header" type="defaultSemiBold" style={styles.cardTitle} numberOfLines={1}>
                              {isMe ? 'You Send' : `${bt.team_name} Sends`}
                            </ThemedText>
                            <View style={styles.addIcons}>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`Add player from ${bt.team_name}`}
                                onPress={() => setPickerFor({ type: 'player', teamId: bt.team_id })}
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 4 }}
                              >
                                <Ionicons name="person-add-outline" size={18} color={c.accent} />
                              </TouchableOpacity>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`Add pick from ${bt.team_name}`}
                                onPress={() => setPickerFor({ type: 'pick', teamId: bt.team_id })}
                                hitSlop={{ top: 8, bottom: 8, left: 4, right: 4 }}
                              >
                                <Ionicons name="document-text-outline" size={18} color={c.accent} />
                              </TouchableOpacity>
                              {pickConditionsEnabled && (
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  accessibilityLabel={`Add pick swap from ${bt.team_name}`}
                                  onPress={() => setPickerFor({ type: 'swap', teamId: bt.team_id })}
                                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                                >
                                  <Ionicons name="swap-horizontal-outline" size={18} color={c.accent} />
                                </TouchableOpacity>
                              )}
                            </View>
                          </View>

                          {/* Compact asset list — players */}
                          {bt.sending_players.map((p) => (
                            <View key={p.player_id} style={[styles.assetRow, { borderTopColor: c.border }]}>
                              <ThemedText style={styles.assetName} numberOfLines={1}>
                                {p.name}
                              </ThemedText>
                              {/* Per-asset destination chip (multi-team only) */}
                              {isMultiTeam && (
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  accessibilityLabel={`Change destination for ${p.name}, currently ${teamNameMap[p.to_team_id] ?? '?'}`}
                                  style={[styles.assetDestChip, { backgroundColor: c.accent }]}
                                  onPress={() => {
                                    const idx = destOptions.indexOf(p.to_team_id);
                                    const next = destOptions[(idx + 1) % destOptions.length];
                                    dispatch({ type: 'SET_PLAYER_DEST', teamId: bt.team_id, playerId: p.player_id, toTeamId: next });
                                  }}
                                >
                                  <ThemedText style={styles.assetDestChipText} numberOfLines={1}>
                                    → {teamNameMap[p.to_team_id] ?? '?'}
                                  </ThemedText>
                                </TouchableOpacity>
                              )}
                              <ThemedText style={[styles.assetMeta, { color: c.secondaryText }]}>
                                {p.position}
                              </ThemedText>
                              <ThemedText style={[styles.assetFpts, { color: c.accent }]}>
                                {p.avg_fpts}
                              </ThemedText>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${p.name}`}
                                onPress={() => dispatch({ type: 'REMOVE_PLAYER', teamId: bt.team_id, playerId: p.player_id })}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <ThemedText style={styles.removeBtn}>✕</ThemedText>
                              </TouchableOpacity>
                            </View>
                          ))}

                          {/* Compact asset list — picks */}
                          {bt.sending_picks.map((pk) => (
                            <View key={pk.draft_pick_id} style={[styles.assetRow, { borderTopColor: c.border }]}>
                              <ThemedText style={styles.assetName} numberOfLines={1}>
                                {formatPickLabel(pk.season, pk.round)}
                              </ThemedText>
                              {pk.protection_threshold && (
                                <View style={styles.protectionBadge}>
                                  <ThemedText style={styles.protectionBadgeText}>
                                    Top-{pk.protection_threshold}
                                  </ThemedText>
                                </View>
                              )}
                              {isMultiTeam && (
                                <TouchableOpacity
                                  accessibilityRole="button"
                                  accessibilityLabel={`Change destination for ${formatPickLabel(pk.season, pk.round)}, currently ${teamNameMap[pk.to_team_id] ?? '?'}`}
                                  style={[styles.assetDestChip, { backgroundColor: c.accent }]}
                                  onPress={() => {
                                    const idx = destOptions.indexOf(pk.to_team_id);
                                    const next = destOptions[(idx + 1) % destOptions.length];
                                    dispatch({ type: 'SET_PICK_DEST', teamId: bt.team_id, pickId: pk.draft_pick_id, toTeamId: next });
                                  }}
                                >
                                  <ThemedText style={styles.assetDestChipText} numberOfLines={1}>
                                    → {teamNameMap[pk.to_team_id] ?? '?'}
                                  </ThemedText>
                                </TouchableOpacity>
                              )}
                              <ThemedText style={[styles.assetMeta, { color: c.secondaryText }]}>
                                {pk.original_team_name ? `via ${pk.original_team_name}` : 'Pick'}
                              </ThemedText>
                              <ThemedText style={[styles.assetFpts, { color: c.secondaryText }]}>
                                ~{pk.estimated_fpts}
                              </ThemedText>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${formatPickLabel(pk.season, pk.round)}`}
                                onPress={() => dispatch({ type: 'REMOVE_PICK', teamId: bt.team_id, pickId: pk.draft_pick_id })}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <ThemedText style={styles.removeBtn}>✕</ThemedText>
                              </TouchableOpacity>
                            </View>
                          ))}

                          {/* Compact asset list — swaps */}
                          {bt.sending_swaps.map((sw) => (
                            <View key={`${sw.season}-${sw.round}`} style={[styles.assetRow, { borderTopColor: c.border }]}>
                              <Ionicons name="swap-horizontal" size={14} color={c.accent} style={{ marginRight: 4 }} />
                              <ThemedText style={styles.assetName} numberOfLines={1}>
                                {formatPickLabel(sw.season, sw.round)} swap
                              </ThemedText>
                              <ThemedText style={[styles.assetMeta, { color: c.secondaryText }]}>
                                {teamNameMap[sw.beneficiary_team_id] ?? '?'} gets better
                              </ThemedText>
                              <TouchableOpacity
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${formatPickLabel(sw.season, sw.round)} swap`}
                                onPress={() => dispatch({ type: 'REMOVE_SWAP', teamId: bt.team_id, season: sw.season, round: sw.round })}
                                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                              >
                                <ThemedText style={styles.removeBtn}>✕</ThemedText>
                              </TouchableOpacity>
                            </View>
                          ))}

                          {/* Empty state hint */}
                          {bt.sending_players.length === 0 && bt.sending_picks.length === 0 && bt.sending_swaps.length === 0 && (
                            <ThemedText style={[styles.emptyHint, { color: c.secondaryText }]}>
                              Tap icons above to add assets
                            </ThemedText>
                          )}
                        </View>
                      );
                    })}
                  </ScrollView>

                  {/* Pinned fairness bar */}
                  {hasAssets && (
                    <View style={[styles.pinnedFairness, { borderTopColor: c.border }]}>
                      <TradeFairnessBar teams={fairness} />
                    </View>
                  )}
                </View>
              )}

              {/* Step 2: Review */}
              {state.step === 2 && (
                <View style={styles.assetLayout}>
                  <ScrollView contentContainerStyle={styles.assetScroll} showsVerticalScrollIndicator={false}>
                    {allBuilderTeams.map((bt) => {
                      const isMe = bt.team_id === teamId;

                      return (
                        <View key={bt.team_id} style={[styles.reviewCard, { backgroundColor: c.card }]}>
                          <ThemedText type="defaultSemiBold" style={styles.reviewTitle}>
                            {isMe ? 'You Send' : `${bt.team_name} Sends`}
                          </ThemedText>
                          {bt.sending_players.map((p) => {
                            const dest = isSimpleTrade
                              ? (isMe ? teamNameMap[state.selectedTeamIds[0]] : myTeam?.name ?? 'Unknown')
                              : teamNameMap[p.to_team_id];
                            return (
                              <View key={p.player_id} style={styles.reviewItemRow}>
                                <ThemedText style={styles.reviewItem}>
                                  {p.name} ({p.avg_fpts} FPTS)
                                </ThemedText>
                                {isMultiTeam && dest && (
                                  <ThemedText style={[styles.reviewDest, { color: c.secondaryText }]}>
                                    → {dest}
                                  </ThemedText>
                                )}
                              </View>
                            );
                          })}
                          {bt.sending_picks.map((pk) => {
                            const dest = isSimpleTrade
                              ? (isMe ? teamNameMap[state.selectedTeamIds[0]] : myTeam?.name ?? 'Unknown')
                              : teamNameMap[pk.to_team_id];
                            return (
                              <View key={pk.draft_pick_id} style={styles.reviewItemRow}>
                                <ThemedText style={styles.reviewItem}>
                                  {formatPickLabel(pk.season, pk.round)} (~{pk.estimated_fpts} FPTS)
                                </ThemedText>
                                {pk.protection_threshold && (
                                  <View style={styles.protectionBadge}>
                                    <ThemedText style={styles.protectionBadgeText}>
                                      Top-{pk.protection_threshold}
                                    </ThemedText>
                                  </View>
                                )}
                                {isMultiTeam && dest && (
                                  <ThemedText style={[styles.reviewDest, { color: c.secondaryText }]}>
                                    → {dest}
                                  </ThemedText>
                                )}
                              </View>
                            );
                          })}
                          {bt.sending_swaps.map((sw) => (
                            <View key={`${sw.season}-${sw.round}`} style={styles.reviewItemRow}>
                              <Ionicons name="swap-horizontal" size={14} color={c.accent} style={{ marginRight: 4 }} />
                              <ThemedText style={styles.reviewItem}>
                                {formatPickLabel(sw.season, sw.round)} swap — {teamNameMap[sw.beneficiary_team_id] ?? '?'} gets better pick
                              </ThemedText>
                            </View>
                          ))}
                          {bt.sending_players.length === 0 && bt.sending_picks.length === 0 && bt.sending_swaps.length === 0 && (
                            <ThemedText style={[styles.reviewItem, { color: c.secondaryText }]}>
                              No assets
                            </ThemedText>
                          )}
                        </View>
                      );
                    })}

                    <TextInput
                      accessibilityLabel="Trade note"
                      style={[styles.notesInput, { backgroundColor: c.cardAlt, color: c.text, borderColor: c.border }]}
                      placeholder="Add a note (optional)"
                      placeholderTextColor={c.secondaryText}
                      value={state.notes}
                      onChangeText={(v) => dispatch({ type: 'SET_NOTES', notes: v })}
                      multiline
                    />
                  </ScrollView>

                  {/* Pinned fairness bar */}
                  {hasAssets && (
                    <View style={[styles.pinnedFairness, { borderTopColor: c.border }]}>
                      <TradeFairnessBar teams={fairness} />
                    </View>
                  )}
                </View>
              )}

              {/* Navigation */}
              <View style={[styles.navRow, { borderTopColor: c.border }]}>
                {state.step > 0 ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    style={[styles.navBtn, { borderColor: c.border }]}
                    onPress={() => dispatch({ type: 'PREV_STEP' })}
                  >
                    <ThemedText style={styles.navBtnText}>Back</ThemedText>
                  </TouchableOpacity>
                ) : (
                  <View />
                )}

                {state.step < 2 ? (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel="Next"
                    accessibilityState={{ disabled: (state.step === 0 && state.selectedTeamIds.length === 0) || (state.step === 1 && !hasAssets) }}
                    style={[
                      styles.navBtn,
                      {
                        backgroundColor:
                          (state.step === 0 && state.selectedTeamIds.length > 0) ||
                          (state.step === 1 && hasAssets)
                            ? c.accent
                            : c.buttonDisabled,
                      },
                    ]}
                    disabled={
                      (state.step === 0 && (state.selectedTeamIds.length === 0 || !seeded)) ||
                      (state.step === 1 && !hasAssets)
                    }
                    onPress={() => dispatch({ type: 'NEXT_STEP' })}
                  >
                    <ThemedText style={[styles.navBtnText, { color: '#fff' }]}>Next</ThemedText>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={instantExecute ? 'Execute trade' : 'Propose trade'}
                    accessibilityState={{ disabled: submitting }}
                    style={[styles.navBtn, { backgroundColor: '#28a745' }]}
                    onPress={handleSubmit}
                    disabled={submitting}
                  >
                    {submitting ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <ThemedText style={[styles.navBtnText, { color: '#fff' }]}>{instantExecute ? 'Execute Trade' : 'Propose Trade'}</ThemedText>
                    )}
                  </TouchableOpacity>
                )}
              </View>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

// --- Helpers ---

function computeFairness(
  builderTeams: TradeBuilderTeam[],
  myTeamId: string,
  isSimple: boolean
): Array<{ teamName: string; netFpts: number }> {
  if (isSimple) {
    // 2-team: straightforward swap
    return builderTeams.map((bt) => {
      const sent = bt.sending_players.reduce((s, p) => s + p.avg_fpts, 0)
        + bt.sending_picks.reduce((s, p) => s + p.estimated_fpts, 0);
      let received = 0;
      for (const other of builderTeams) {
        if (other.team_id === bt.team_id) continue;
        received += other.sending_players.reduce((s, p) => s + p.avg_fpts, 0);
        received += other.sending_picks.reduce((s, p) => s + p.estimated_fpts, 0);
      }
      return { teamName: bt.team_name, netFpts: received - sent };
    });
  }

  // Multi-team: use per-asset to_team_id destinations
  const receivedByTeam: Record<string, number> = {};
  const sentByTeam: Record<string, number> = {};

  for (const bt of builderTeams) {
    for (const p of bt.sending_players) {
      sentByTeam[bt.team_id] = (sentByTeam[bt.team_id] ?? 0) + p.avg_fpts;
      receivedByTeam[p.to_team_id] = (receivedByTeam[p.to_team_id] ?? 0) + p.avg_fpts;
    }
    for (const pk of bt.sending_picks) {
      sentByTeam[bt.team_id] = (sentByTeam[bt.team_id] ?? 0) + pk.estimated_fpts;
      receivedByTeam[pk.to_team_id] = (receivedByTeam[pk.to_team_id] ?? 0) + pk.estimated_fpts;
    }
  }

  return builderTeams.map((bt) => ({
    teamName: bt.team_name,
    netFpts: (receivedByTeam[bt.team_id] ?? 0) - (sentByTeam[bt.team_id] ?? 0),
  }));
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    maxHeight: '92%',
    minHeight: '70%',
    paddingBottom: 32,
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerTitle: {
    fontSize: 16,
  },
  closeText: {
    fontSize: 18,
    padding: 4,
  },
  listContent: {
    paddingVertical: 4,
    paddingBottom: 24,
  },
  teamRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  check: {
    fontSize: 18,
    fontWeight: '700',
    color: '#28a745',
  },

  // Step 1 — asset layout with pinned fairness
  assetLayout: {
    flex: 1,
  },
  assetScroll: {
    padding: 12,
    paddingBottom: 8,
  },

  // Team card (compact)
  teamCard: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  cardTitle: {
    fontSize: 13,
    flex: 1,
  },
  addIcons: {
    flexDirection: 'row',
    gap: 14,
  },

  // Per-asset destination chip
  assetDestChip: {
    borderRadius: 10,
    paddingHorizontal: 7,
    paddingVertical: 2,
    marginRight: 4,
  },
  assetDestChipText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#fff',
  },

  // Compact asset rows (single line)
  assetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  assetName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
  },
  assetMeta: {
    fontSize: 11,
    marginHorizontal: 6,
  },
  assetFpts: {
    fontSize: 12,
    fontWeight: '600',
    marginRight: 6,
  },
  removeBtn: {
    fontSize: 13,
    padding: 4,
    color: '#dc3545',
  },
  protectionBadge: {
    backgroundColor: '#d4920040',
    borderRadius: 4,
    paddingHorizontal: 5,
    paddingVertical: 1,
    marginRight: 4,
  },
  protectionBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#d49200',
  },

  emptyHint: {
    fontSize: 12,
    textAlign: 'center',
    paddingVertical: 8,
  },

  // Pinned fairness bar
  pinnedFairness: {
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
  },

  // Review step
  reviewCard: {
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  reviewTitle: {
    fontSize: 13,
    marginBottom: 4,
  },
  reviewItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reviewDest: {
    fontSize: 11,
  },
  reviewItem: {
    fontSize: 13,
    paddingVertical: 2,
    paddingLeft: 2,
  },
  notesInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 10,
    fontSize: 14,
    minHeight: 50,
    marginTop: 4,
    textAlignVertical: 'top',
  },

  // Navigation
  navRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  navBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
