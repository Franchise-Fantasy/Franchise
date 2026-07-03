import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode,
} from 'react';

import { useToast } from '@/context/ToastProvider';
import type { PlayerSeasonStats } from '@/types/player';

export const MIN_COMPARE = 2;
export const MAX_COMPARE = 4;

/**
 * A player picked for comparison. Carries a self-contained identity snapshot so
 * the compare screen can always render header chrome (headshot, name, team)
 * even for players outside the top-600 season-stats fetch (deep free agents,
 * other-team rostered players). `seasonStats` is attached when the entry
 * surface already has the full row, so the screen prefers it before looking the
 * player up in the shared pool.
 */
export interface CompareCandidate {
  player_id: string;
  name: string;
  position: string;
  pro_team: string;
  // Widened to accept the matchup board's numeric ids; only used for the
  // headshot lookup, which already accepts string | number | null.
  external_id_nba: string | number | null;
  /** Full season-stats row, when the source screen already has it. */
  seasonStats?: PlayerSeasonStats;
  /** "FA" or an owning team's name, derived at selection time (optional). */
  ownerTag?: string | null;
}

interface CompareSelectionValue {
  isCompareMode: boolean;
  setCompareMode: (on: boolean) => void;
  selected: CompareCandidate[];
  selectedIds: Set<string>;
  toggle: (candidate: CompareCandidate) => void;
  remove: (playerId: string) => void;
  clear: () => void;
  min: number;
  max: number;
}

type Action =
  | { type: 'SET_MODE'; on: boolean }
  | { type: 'TOGGLE'; candidate: CompareCandidate }
  | { type: 'REMOVE'; playerId: string }
  | { type: 'CLEAR' };

interface State {
  isCompareMode: boolean;
  selected: CompareCandidate[];
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'SET_MODE':
      // Leaving compare mode clears the selection so it can't linger invisibly.
      return action.on
        ? { ...state, isCompareMode: true }
        : { isCompareMode: false, selected: [] };
    case 'TOGGLE': {
      const exists = state.selected.some((p) => p.player_id === action.candidate.player_id);
      if (exists) {
        return {
          ...state,
          selected: state.selected.filter((p) => p.player_id !== action.candidate.player_id),
        };
      }
      if (state.selected.length >= MAX_COMPARE) return state; // capped — handled with a toast in `toggle`
      return { ...state, selected: [...state.selected, action.candidate] };
    }
    case 'REMOVE':
      return {
        ...state,
        selected: state.selected.filter((p) => p.player_id !== action.playerId),
      };
    case 'CLEAR':
      return { ...state, selected: [] };
    default:
      return state;
  }
}

const CompareSelectionContext = createContext<CompareSelectionValue | null>(null);

export function CompareSelectionProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, { isCompareMode: false, selected: [] });
  const { showToast } = useToast();

  const setCompareMode = useCallback((on: boolean) => dispatch({ type: 'SET_MODE', on }), []);

  const toggle = useCallback(
    (candidate: CompareCandidate) => {
      const alreadySelected = state.selected.some((p) => p.player_id === candidate.player_id);
      if (!alreadySelected && state.selected.length >= MAX_COMPARE) {
        showToast('info', `Compare up to ${MAX_COMPARE} players`);
        return;
      }
      dispatch({ type: 'TOGGLE', candidate });
    },
    [state.selected, showToast],
  );

  const remove = useCallback((playerId: string) => dispatch({ type: 'REMOVE', playerId }), []);
  const clear = useCallback(() => dispatch({ type: 'CLEAR' }), []);

  const selectedIds = useMemo(
    () => new Set(state.selected.map((p) => p.player_id)),
    [state.selected],
  );

  const value = useMemo<CompareSelectionValue>(
    () => ({
      isCompareMode: state.isCompareMode,
      setCompareMode,
      selected: state.selected,
      selectedIds,
      toggle,
      remove,
      clear,
      min: MIN_COMPARE,
      max: MAX_COMPARE,
    }),
    [state.isCompareMode, state.selected, selectedIds, setCompareMode, toggle, remove, clear],
  );

  return (
    <CompareSelectionContext.Provider value={value}>
      {children}
    </CompareSelectionContext.Provider>
  );
}

export function useCompareSelection(): CompareSelectionValue {
  const ctx = useContext(CompareSelectionContext);
  if (!ctx) {
    throw new Error('useCompareSelection must be used within a CompareSelectionProvider');
  }
  return ctx;
}
