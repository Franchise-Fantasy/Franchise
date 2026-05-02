/**
 * Trade builder reducer — drives the single-pane `TradeFloor` compose
 * surface. State persists across mounts so counteroffer/edit seeded
 * data lands without an explicit step transition.
 *
 * State semantics:
 * - `selectedTeamIds`: every OTHER team in the trade (excludes "me")
 * - `builderTeams`: per-team sending lists. Always contains my team
 *   plus one entry per selected partner. Asset destinations
 *   (`to_team_id`) are tracked per-asset for multi-team trades.
 * - `notes`: optional free-text note attached to the proposal
 */
import type { TradeProposalRow } from '@/hooks/useTrades';
import {
  TradeBuilderPick,
  TradeBuilderPlayer,
  TradeBuilderSwap,
  TradeBuilderTeam,
  estimatePickFpts,
} from '@/types/trade';

export interface PreselectedPlayer {
  player_id: string;
  name: string;
  position: string;
  pro_team: string;
  avg_fpts?: number;
}

export interface CounterofferData {
  originalProposalId: string;
  teams: TradeProposalRow['teams'];
  items: TradeProposalRow['items'];
}

export interface EditData {
  originalProposalId: string;
  teams: TradeProposalRow['teams'];
  items: TradeProposalRow['items'];
  notes: string | null;
}

export interface TradeState {
  selectedTeamIds: string[];
  builderTeams: TradeBuilderTeam[];
  notes: string;
}

export type TradeAction =
  | { type: 'SEED_MY_TEAM'; teamId: string; teamName: string; partnerTeamId?: string; partnerTeamName?: string; preselectedPlayer?: PreselectedPlayer }
  | { type: 'SEED_COUNTEROFFER'; myTeamId: string; teams: TradeProposalRow['teams']; items: TradeProposalRow['items'] }
  | { type: 'TOGGLE_TEAM'; teamId: string; teamName: string; myTeamId: string }
  | { type: 'ADD_PLAYER'; teamId: string; player: TradeBuilderPlayer }
  | { type: 'REMOVE_PLAYER'; teamId: string; playerId: string }
  | { type: 'ADD_PICK'; teamId: string; pick: TradeBuilderPick }
  | { type: 'REMOVE_PICK'; teamId: string; pickId: string }
  | { type: 'SET_PLAYER_DEST'; teamId: string; playerId: string; toTeamId: string }
  | { type: 'SET_PICK_DEST'; teamId: string; pickId: string; toTeamId: string }
  | { type: 'SET_PICK_PROTECTION'; teamId: string; pickId: string; threshold: number | undefined }
  | { type: 'ADD_SWAP'; teamId: string; swap: TradeBuilderSwap }
  | { type: 'REMOVE_SWAP'; teamId: string; season: string; round: number }
  | { type: 'SET_NOTES'; notes: string }
  | { type: 'UPDATE_PLAYER_FPTS'; fptsMap: Record<string, number>; externalIdMap?: Record<string, string | null> };

export function tradeBuilderReducer(state: TradeState, action: TradeAction): TradeState {
  switch (action.type) {
    case 'SEED_MY_TEAM': {
      const mySendingPlayers: TradeBuilderPlayer[] = [];
      if (action.preselectedPlayer && !action.partnerTeamId) {
        mySendingPlayers.push({
          player_id: action.preselectedPlayer.player_id,
          name: action.preselectedPlayer.name,
          position: action.preselectedPlayer.position,
          pro_team: action.preselectedPlayer.pro_team,
          avg_fpts: action.preselectedPlayer.avg_fpts ?? 0,
          to_team_id: '',
        });
      }
      const builderTeams: TradeBuilderTeam[] = [
        { team_id: action.teamId, team_name: action.teamName, sending_players: mySendingPlayers, sending_picks: [], sending_swaps: [] },
      ];
      const selectedTeamIds: string[] = [];
      if (action.partnerTeamId && action.partnerTeamName) {
        const sendingPlayers: TradeBuilderPlayer[] = [];
        if (action.preselectedPlayer) {
          sendingPlayers.push({
            player_id: action.preselectedPlayer.player_id,
            name: action.preselectedPlayer.name,
            position: action.preselectedPlayer.position,
            pro_team: action.preselectedPlayer.pro_team,
            avg_fpts: action.preselectedPlayer.avg_fpts ?? 0,
            to_team_id: action.teamId,
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
    case 'SEED_COUNTEROFFER': {
      const selectedTeamIds = action.teams
        .filter((t) => t.team_id !== action.myTeamId)
        .map((t) => t.team_id);

      const builderTeams: TradeBuilderTeam[] = action.teams.map((t) => ({
        team_id: t.team_id,
        team_name: t.team_name,
        sending_players: [],
        sending_picks: [],
        sending_swaps: [],
      }));

      for (const item of action.items) {
        const bt = builderTeams.find((t) => t.team_id === item.from_team_id);
        if (!bt) continue;

        if (item.pick_swap_season) {
          bt.sending_swaps.push({
            season: item.pick_swap_season,
            round: item.pick_swap_round!,
            beneficiary_team_id: item.to_team_id,
            counterparty_team_id: item.from_team_id,
          });
        } else if (item.player_id) {
          bt.sending_players.push({
            player_id: item.player_id,
            name: item.player_name ?? '',
            position: item.player_position ?? '',
            pro_team: item.player_pro_team ?? '',
            avg_fpts: 0,
            to_team_id: item.to_team_id,
          });
        } else if (item.draft_pick_id) {
          bt.sending_picks.push({
            draft_pick_id: item.draft_pick_id,
            season: item.pick_season ?? '',
            round: item.pick_round ?? 1,
            original_team_name: item.pick_original_team_name ?? '',
            estimated_fpts: estimatePickFpts(item.pick_round ?? 1),
            to_team_id: item.to_team_id,
            protection_threshold: item.protection_threshold ?? undefined,
          });
        }
      }

      return { ...state, selectedTeamIds, builderTeams };
    }
    case 'TOGGLE_TEAM': {
      const exists = state.selectedTeamIds.includes(action.teamId);
      const selectedTeamIds = exists
        ? state.selectedTeamIds.filter((id) => id !== action.teamId)
        : [...state.selectedTeamIds, action.teamId];

      if (exists) {
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
    case 'UPDATE_PLAYER_FPTS': {
      const builderTeams = state.builderTeams.map((t) => ({
        ...t,
        sending_players: t.sending_players.map((p) => ({
          ...p,
          avg_fpts: action.fptsMap[p.player_id] ?? p.avg_fpts,
          external_id_nba:
            action.externalIdMap && p.player_id in action.externalIdMap
              ? action.externalIdMap[p.player_id]
              : p.external_id_nba,
        })),
      }));
      return { ...state, builderTeams };
    }
    default:
      return state;
  }
}
