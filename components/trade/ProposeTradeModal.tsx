import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useReducer, useState } from 'react';
import { Alert, Modal, StyleSheet, TouchableOpacity, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaFrame,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';

import {
  CounterofferData,
  EditData,
  PreselectedPlayer,
  TradeState,
  tradeBuilderReducer,
} from '@/components/trade/tradeBuilderReducer';
import { TradeFloor } from '@/components/trade/TradeFloor';
import { TradePickerHeader } from '@/components/trade/TradePickerHeader';
import { TradablePickRow, TradePickPickerBody } from '@/components/trade/TradePickPickerBody';
import { TradePlayerPickerBody } from '@/components/trade/TradePlayerPickerBody';
import { TradeSubmitOverlay } from '@/components/trade/TradeSubmitOverlay';
import { TradeSwapPickerBody } from '@/components/trade/TradeSwapPickerBody';
import { BrandButton } from '@/components/ui/BrandButton';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { usePostTradeUpdate } from '@/hooks/chat/useTradeChat';
import { useColors } from '@/hooks/useColors';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useLockedTradeAssets, usePendingDropPlayerIds } from '@/hooks/useTeamRosterForTrade';
import { sendNotification } from '@/lib/notifications';
import { capture } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import { PlayerSeasonStats } from '@/types/player';
import { TradeBuilderTeam, estimatePickFpts } from '@/types/trade';
import { ms, s } from '@/utils/scale';
import { calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';

type PickerType = 'player' | 'pick' | 'swap';

interface ProposeTradeModalProps {
  leagueId: string;
  teamId: string;
  preselectedTeamId?: string;
  preselectedPlayer?: PreselectedPlayer;
  /** When true, trade executes immediately (both teams auto-accepted, no veto). Used in draft room. */
  instantExecute?: boolean;
  /** Pre-populate with an existing proposal's data for counteroffer */
  counterofferData?: CounterofferData;
  /** Pre-populate with an existing proposal's data for editing */
  editData?: EditData;
  /** When true, block submission (trade deadline has passed) */
  isPastDeadline?: boolean;
  onClose: () => void;
}

export function ProposeTradeModal({
  leagueId,
  teamId,
  preselectedTeamId,
  preselectedPlayer,
  instantExecute = false,
  counterofferData,
  editData,
  isPastDeadline = false,
  onClose,
}: ProposeTradeModalProps) {
  const c = useColors();
  const queryClient = useQueryClient();
  const postTradeUpdate = usePostTradeUpdate(leagueId);

  // fullScreen Modals don't propagate the outer SafeAreaProvider, so we
  // re-seed it inside each Modal with the outer tree's insets/frame —
  // otherwise the page header sits under the notch and the close ✕
  // becomes untappable.
  const outerInsets = useSafeAreaInsets();
  const outerFrame = useSafeAreaFrame();

  const [submitting, setSubmitting] = useState(false);
  const [overlay, setOverlay] = useState<{ visible: boolean; label: string } | null>(null);
  const [pickerFor, setPickerFor] = useState<{ teamId: string; type: PickerType } | null>(null);
  const [playerSearch, setPlayerSearch] = useState('');

  // Reset player search when picker context changes (each (team, type) pair
  // gets a fresh query — keeps the UX from leaking between contexts).
  useEffect(() => {
    setPlayerSearch('');
  }, [pickerFor?.teamId, pickerFor?.type]);

  const { data: lockedAssets } = useLockedTradeAssets(pickerFor?.teamId ?? null, leagueId);
  const { data: pendingDropIds } = usePendingDropPlayerIds(pickerFor?.teamId ?? null, leagueId);

  // Fetch all teams in the league
  const { data: leagueTeams } = useQuery({
    queryKey: queryKeys.leagueTeams(leagueId),
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

  // Fetch league settings for pick conditions + draft round count
  const { data: leagueSettings } = useQuery({
    queryKey: queryKeys.leagueTradeConditions(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('pick_conditions_enabled, draft_pick_trading_enabled, teams, max_future_seasons, rookie_draft_rounds, league_type, season, offseason_step, scoring_type')
        .eq('id', leagueId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const isCategories = leagueSettings?.scoring_type === 'h2h_categories';
  const isDynastyLeague = (leagueSettings?.league_type ?? 'dynasty') === 'dynasty';
  const pickConditionsEnabled = isDynastyLeague && (leagueSettings?.pick_conditions_enabled ?? false);
  const draftPickTradingEnabled = isDynastyLeague && (leagueSettings?.draft_pick_trading_enabled ?? false);
  const teamCount = leagueSettings?.teams ?? 10;
  const maxFutureSeasons = leagueSettings?.max_future_seasons ?? 3;
  const rookieDraftRounds = leagueSettings?.rookie_draft_rounds ?? 2;

  // Build valid seasons for swap picker — skip the current season if its draft already happened
  const validSeasons = useMemo(() => {
    const leagueSeason = leagueSettings?.season ?? CURRENT_NBA_SEASON;
    const leagueStartYear = parseInt(leagueSeason.split('-')[0], 10);
    const step = leagueSettings?.offseason_step as string | null;
    const draftDone = !step || step === 'rookie_draft_complete';
    const startYear = draftDone ? leagueStartYear + 1 : leagueStartYear;
    const seasons: string[] = [];
    const count = draftDone ? maxFutureSeasons : maxFutureSeasons + 1;
    for (let i = 0; i < count; i++) {
      const sy = startYear + i;
      const ey = (sy + 1) % 100;
      seasons.push(`${sy}-${String(ey).padStart(2, '0')}`);
    }
    return seasons;
  }, [leagueSettings?.season, leagueSettings?.offseason_step, maxFutureSeasons]);

  const myTeam = leagueTeams?.find((t) => t.id === teamId);

  const isCounteroffer = !!counterofferData;
  const isEdit = !!editData;
  const seedData = counterofferData ?? editData;

  const initialState: TradeState = {
    selectedTeamIds: preselectedTeamId ? [preselectedTeamId] : [],
    builderTeams: [],
    notes: isCounteroffer ? 'Counteroffer: ' : isEdit ? (editData.notes ?? '') : '',
  };
  const [state, dispatch] = useReducer(tradeBuilderReducer, initialState);

  // Seed builder teams once league teams load (runs once)
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !leagueTeams?.length || !myTeam) return;

    if (seedData) {
      dispatch({
        type: 'SEED_COUNTEROFFER',
        myTeamId: teamId,
        teams: seedData.teams,
        items: seedData.items,
      });
      setSeeded(true);

      const playerIds = seedData.items
        .filter((i) => i.player_id)
        .map((i) => i.player_id!);
      if (playerIds.length > 0 && scoringWeights) {
        supabase
          .from('player_season_stats')
          .select('*')
          .in('player_id', playerIds)
          .then(({ data }) => {
            if (!data) return;
            const fptsMap: Record<string, number> = {};
            const externalIdMap: Record<string, string | null> = {};
            for (const row of data) {
              if (!row.player_id) continue;
              fptsMap[row.player_id] = calculateAvgFantasyPoints(row as PlayerSeasonStats, scoringWeights);
              externalIdMap[row.player_id] = (row as PlayerSeasonStats).external_id_nba ?? null;
            }
            dispatch({ type: 'UPDATE_PLAYER_FPTS', fptsMap, externalIdMap });
          });
      }
      return;
    }

    const preselectedTeam = preselectedTeamId
      ? leagueTeams.find((t) => t.id === preselectedTeamId)
      : null;

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
  }, [leagueTeams, myTeam, seeded, teamId, preselectedTeamId, preselectedPlayer, scoringWeights, seedData]);

  const allBuilderTeams = state.builderTeams;
  const otherTeams = (leagueTeams ?? []).filter((t) => t.id !== teamId);
  const hasAssets = allBuilderTeams.some(
    (t) => t.sending_players.length > 0 || t.sending_picks.length > 0 || t.sending_swaps.length > 0,
  );

  const isSimpleTrade = state.selectedTeamIds.length === 1;

  const teamNameMap: Record<string, string> = {};
  for (const bt of allBuilderTeams) {
    teamNameMap[bt.team_id] = bt.team_name;
  }

  const fairness = computeFairness(allBuilderTeams, teamId, isSimpleTrade);
  const allTradeTeamIds = [teamId, ...state.selectedTeamIds];

  // Roster capacity warning — debounced live (was step-gated; now always-on
  // while assets exist).
  const { data: rosterWarnings } = useQuery<string[]>({
    queryKey: queryKeys.tradeRosterWarnings(
      leagueId,
      ...allTradeTeamIds,
      JSON.stringify(allBuilderTeams.map((t) => t.sending_players.map((p) => `${p.player_id}:${p.to_team_id}`))),
    ),
    queryFn: async () => {
      const netByTeam = new Map<string, number>();
      for (const bt of allBuilderTeams) {
        for (const p of bt.sending_players) {
          netByTeam.set(bt.team_id, (netByTeam.get(bt.team_id) ?? 0) - 1);
          const dest = p.to_team_id || allTradeTeamIds.find((id) => id !== bt.team_id) || '';
          if (dest) netByTeam.set(dest, (netByTeam.get(dest) ?? 0) + 1);
        }
      }
      const teamsGaining = [...netByTeam.entries()].filter(([, gain]) => gain > 0);
      if (teamsGaining.length === 0) return [];

      const { data: leagueData } = await supabase
        .from('leagues')
        .select('roster_size')
        .eq('id', leagueId)
        .single();
      const rosterSize = leagueData?.roster_size ?? 13;

      const warnings: string[] = [];
      for (const [tid, netGain] of teamsGaining) {
        const [allRes, irRes] = await Promise.all([
          supabase.from('league_players').select('id', { count: 'exact', head: true })
            .eq('league_id', leagueId).eq('team_id', tid),
          supabase.from('league_players').select('id', { count: 'exact', head: true })
            .eq('league_id', leagueId).eq('team_id', tid).eq('roster_slot', 'IR'),
        ]);
        const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
        if (activeCount + netGain > rosterSize) {
          const teamName = allBuilderTeams.find((t) => t.team_id === tid)?.team_name ?? 'A team';
          warnings.push(teamName);
        }
      }
      return warnings;
    },
    enabled: hasAssets,
    staleTime: 1000 * 30,
  });

  // ─── Submit ──────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (isPastDeadline) {
      Alert.alert('Trade Deadline', 'The trade deadline has passed. No new trades can be proposed.');
      return;
    }
    setSubmitting(true);
    try {
      const items: {
        player_id: string | null;
        draft_pick_id: string | null;
        from_team_id: string;
        to_team_id: string;
        protection_threshold?: number | null;
        pick_swap_season?: string | null;
        pick_swap_round?: number | null;
      }[] = [];

      if (isSimpleTrade) {
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

      const { data: proposal, error: propError } = await supabase
        .from('trade_proposals')
        .insert({
          league_id: leagueId,
          proposed_by_team_id: teamId,
          status: 'pending',
          notes: state.notes || null,
          counteroffer_of: counterofferData?.originalProposalId ?? null,
        })
        .select('id')
        .single();
      if (propError) throw propError;

      if (counterofferData?.originalProposalId || editData?.originalProposalId) {
        await supabase
          .from('trade_proposals')
          .update({ status: 'cancelled' })
          .eq('id', (counterofferData?.originalProposalId ?? editData?.originalProposalId)!);
      }

      const allTeamIds = [teamId, ...state.selectedTeamIds];
      const teamRows = allTeamIds.map((tid) => ({
        proposal_id: proposal.id,
        team_id: tid,
        status: tid === teamId ? 'accepted' : 'pending',
        responded_at: tid === teamId ? new Date().toISOString() : null,
      }));
      const { error: teamsError } = await supabase.from('trade_proposal_teams').insert(teamRows);
      if (teamsError) throw teamsError;

      const itemRows = items.map((item) => ({
        proposal_id: proposal.id,
        ...item,
      }));
      const { error: itemsError } = await supabase.from('trade_proposal_items').insert(itemRows);
      if (itemsError) throw itemsError;

      // Fire-and-forget bidding-war check
      supabase.rpc('check_bidding_wars', {
        p_proposal_id: proposal.id,
        p_league_id: leagueId,
      }).then(() => {}, () => {});

      if (instantExecute) {
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

        queryClient.invalidateQueries({ queryKey: queryKeys.tradeProposals(leagueId) });
        queryClient.invalidateQueries({ queryKey: ['pendingTradeCount'] });
        queryClient.invalidateQueries({ queryKey: ['tradablePicks'] });
        queryClient.invalidateQueries({ queryKey: ['draftOrder'] });
        setOverlay({ visible: true, label: 'Locked In.' });
        return;
      }

      const notifTitle = isCounteroffer ? 'Counteroffer Received' : isEdit ? 'Trade Updated' : 'Trade Proposed';
      const notifBody = isCounteroffer
        ? `${myTeam?.name ?? 'A team'} has countered your trade proposal.`
        : isEdit
          ? `${myTeam?.name ?? 'A team'} has updated their trade proposal.`
          : `${myTeam?.name ?? 'A team'} has proposed a trade. Review it now.`;
      sendNotification({
        league_id: leagueId,
        team_ids: state.selectedTeamIds,
        category: 'trades',
        title: notifTitle,
        body: notifBody,
        data: { screen: 'trades' },
      });

      queryClient.invalidateQueries({ queryKey: queryKeys.tradeProposals(leagueId) });
      queryClient.invalidateQueries({ queryKey: ['pendingTradeCount'] });

      const eventName = isCounteroffer ? 'trade_countered' : isEdit ? 'trade_edited' : 'trade_proposed';
      capture(eventName, {
        trade_teams: state.selectedTeamIds.length,
      });

      postTradeUpdate.mutate({
        proposalId: proposal.id,
        teamIds: allTeamIds,
        event: isCounteroffer ? 'countered' : 'proposed',
        teamName: myTeam?.name ?? 'A team',
        actingTeamId: null,
      });

      setOverlay({
        visible: true,
        label: isCounteroffer ? 'Counteroffer Sent.' : isEdit ? 'Trade Updated.' : 'Trade Sent.',
      });
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to propose trade');
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Asset toggle handlers ──────────────────

  const getDefaultDest = (senderTeamId: string) =>
    allTradeTeamIds.find((id) => id !== senderTeamId) ?? '';

  const handleTogglePlayer = (forTeamId: string, player: PlayerSeasonStats & { roster_slot?: string | null }, avgFpts: number) => {
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
          pro_team: player.pro_team,
          avg_fpts: avgFpts,
          external_id_nba: player.external_id_nba ?? null,
          to_team_id: getDefaultDest(forTeamId),
        },
      });
    }
  };

  const handleTogglePick = (forTeamId: string, pick: TradablePickRow) => {
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

  const handleAddSwap = (forTeamId: string, season: string, round: number, beneficiaryTeamId?: string) => {
    // Guard against the empty-string case from the swap picker — `??` only
    // coalesces null/undefined, so a falsy `''` would otherwise leak through.
    // No valid beneficiary means the swap can't be added at all.
    const beneficiaryId =
      (beneficiaryTeamId && beneficiaryTeamId !== forTeamId ? beneficiaryTeamId : null)
      ?? allTradeTeamIds.find((id) => id !== forTeamId)
      ?? null;
    if (!beneficiaryId) {
      Alert.alert('Add a partner first', 'Pick swaps need at least one other team in the trade.');
      return;
    }
    dispatch({
      type: 'ADD_SWAP',
      teamId: forTeamId,
      swap: {
        season,
        round,
        counterparty_team_id: forTeamId,
        beneficiary_team_id: beneficiaryId,
      },
    });
    setPickerFor(null);
  };

  // ─── Render ───────────────────────────────────────────────────

  const submitLabel = instantExecute
    ? 'Execute Trade'
    : isCounteroffer
      ? 'Send Counteroffer'
      : isEdit
        ? 'Update Trade'
        : 'Propose Trade';

  // Context-driven page title — replaces the prior "Make a Move." flavor
  // copy. The Alfa Slab + deck period rhythm stays, but the words now
  // tell the user what mode they're in.
  const pageTitle = instantExecute
    ? 'Draft Trade.'
    : isCounteroffer
      ? 'Counteroffer.'
      : isEdit
        ? 'Editing.'
        : 'New Proposal.';

  const pickerTeamBuilder = pickerFor ? allBuilderTeams.find((t) => t.team_id === pickerFor.teamId) : null;
  const pickerTeamName = pickerTeamBuilder?.team_name ?? '';

  return (
    <Modal
      visible
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaProvider initialMetrics={{ insets: outerInsets, frame: outerFrame }}>
      <SafeAreaView style={[styles.page, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
        {/* Page header — close ✕ + gold-rule eyebrow + Alfa Slab title. */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            style={styles.headerClose}
          >
            <Ionicons name="close" size={24} color={c.text} />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <View style={styles.headerEyebrowRow}>
              <View style={[styles.headerEyebrowRule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.headerEyebrow, { color: c.gold }]}
              >
                Front Office
              </ThemedText>
            </View>
            <ThemedText
              accessibilityRole="header"
              type="display"
              style={[styles.headerTitle, { color: c.text }]}
            >
              {pageTitle}
            </ThemedText>
          </View>
        </View>

        {/* Body */}
        {!seeded ? (
          <View style={styles.center}>
            <LogoSpinner />
          </View>
        ) : (
          <TradeFloor
            myTeamId={teamId}
            builderTeams={allBuilderTeams}
            otherTeams={otherTeams}
            selectedTeamIds={state.selectedTeamIds}
            teamNameMap={teamNameMap}
            isCategories={!!isCategories}
            pickConditionsEnabled={pickConditionsEnabled}
            fairness={fairness}
            rosterWarnings={rosterWarnings}
            hasAssets={hasAssets}
            notes={state.notes}
            onNotesChange={(notes) => dispatch({ type: 'SET_NOTES', notes })}
            notesSeeded={isCounteroffer || isEdit}
            isCounteroffer={isCounteroffer}
            isEdit={isEdit}
            onToggleTeam={(team) =>
              dispatch({ type: 'TOGGLE_TEAM', teamId: team.id, teamName: team.name, myTeamId: teamId })
            }
            onOpenPicker={(tid, type) => setPickerFor({ teamId: tid, type })}
            onRemovePlayer={(forTeamId, playerId) =>
              dispatch({ type: 'REMOVE_PLAYER', teamId: forTeamId, playerId })
            }
            onRemovePick={(forTeamId, pickId) =>
              dispatch({ type: 'REMOVE_PICK', teamId: forTeamId, pickId })
            }
            onRemoveSwap={(forTeamId, season, round) =>
              dispatch({ type: 'REMOVE_SWAP', teamId: forTeamId, season, round })
            }
            onSetPlayerDest={(forTeamId, playerId, toTeamId) =>
              dispatch({ type: 'SET_PLAYER_DEST', teamId: forTeamId, playerId, toTeamId })
            }
            onSetPickDest={(forTeamId, pickId, toTeamId) =>
              dispatch({ type: 'SET_PICK_DEST', teamId: forTeamId, pickId, toTeamId })
            }
          />
        )}

        {/* Footer — Cancel left, Submit right (primary, fills remaining width). */}
        <View style={[styles.footer, { borderTopColor: c.border, backgroundColor: c.background }]}>
          <BrandButton
            label="Cancel"
            variant="secondary"
            onPress={onClose}
            accessibilityLabel="Cancel"
          />
          <View style={styles.footerSubmitWrap}>
            <BrandButton
              label={submitLabel}
              icon="send"
              variant="primary"
              size="large"
              fullWidth
              loading={submitting}
              disabled={submitting || !hasAssets || !seeded}
              onPress={handleSubmit}
              accessibilityLabel={instantExecute ? 'Execute trade' : 'Propose trade'}
            />
          </View>
        </View>
      </SafeAreaView>
      </SafeAreaProvider>

      {/* Asset picker — fullscreen modal stacked on top of the propose page. */}
      <Modal
        visible={!!pickerFor}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setPickerFor(null)}
      >
        <SafeAreaProvider initialMetrics={{ insets: outerInsets, frame: outerFrame }}>
        <SafeAreaView style={[styles.page, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
          {pickerFor?.type === 'player' && (
            <>
              <TradePickerHeader
                eyebrow="Players"
                title={pickerTeamName}
                onBack={() => setPickerFor(null)}
              />
              <TradePlayerPickerBody
                teamId={pickerFor.teamId}
                leagueId={leagueId}
                selectedPlayerIds={pickerTeamBuilder?.sending_players.map((p) => p.player_id) ?? []}
                lockedPlayerIds={lockedAssets?.lockedPlayerIds}
                pendingDropPlayerIds={pendingDropIds}
                onToggle={(player, avgFpts) => handleTogglePlayer(pickerFor.teamId, player, avgFpts)}
                isCategories={isCategories}
                search={playerSearch}
                onSearchChange={setPlayerSearch}
              />
            </>
          )}
          {pickerFor?.type === 'pick' && (
            <>
              <TradePickerHeader
                eyebrow="Picks"
                title={pickerTeamName}
                onBack={() => setPickerFor(null)}
              />
              <TradePickPickerBody
                teamId={pickerFor.teamId}
                leagueId={leagueId}
                selectedPickIds={pickerTeamBuilder?.sending_picks.map((p) => p.draft_pick_id) ?? []}
                pickProtections={Object.fromEntries(
                  (pickerTeamBuilder?.sending_picks ?? []).map((p) => [p.draft_pick_id, p.protection_threshold]),
                )}
                pickConditionsEnabled={pickConditionsEnabled}
                draftPickTradingEnabled={draftPickTradingEnabled}
                lockedPickIds={lockedAssets?.lockedPickIds}
                teamCount={teamCount}
                onToggle={(pick) => handleTogglePick(pickerFor.teamId, pick)}
                onSetProtection={(pickId, threshold) =>
                  dispatch({ type: 'SET_PICK_PROTECTION', teamId: pickerFor.teamId, pickId, threshold })
                }
              />
            </>
          )}
          {pickerFor?.type === 'swap' && (
            <>
              <TradePickerHeader
                eyebrow="Pick Swap"
                title={pickerTeamName}
                doneLabel="Cancel"
                onBack={() => setPickerFor(null)}
              />
              <TradeSwapPickerBody
                validSeasons={validSeasons}
                rookieDraftRounds={rookieDraftRounds}
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
                onAdd={(season, round, beneficiaryId) =>
                  handleAddSwap(pickerFor.teamId, season, round, beneficiaryId)
                }
              />
            </>
          )}
        </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      <TradeSubmitOverlay
        visible={overlay?.visible ?? false}
        label={overlay?.label ?? ''}
        onDone={() => {
          setOverlay(null);
          if (instantExecute) {
            Alert.alert('Trade Completed', 'The trade has been executed.');
          }
          onClose();
        }}
      />
    </Modal>
  );
}

// ─── Helpers ────────────────────────────────────────────────────

function computeFairness(
  builderTeams: TradeBuilderTeam[],
  myTeamId: string,
  isSimple: boolean,
): { teamName: string; netFpts: number }[] {
  void myTeamId;
  if (isSimple) {
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
  page: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  headerClose: { padding: s(2) },
  headerCenter: {
    flex: 1,
    gap: s(2),
  },
  headerEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  headerEyebrowRule: { height: 2, width: s(14) },
  headerEyebrow: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
  headerTitle: {
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: s(10),
  },
  footerSubmitWrap: { flex: 1 },
});
