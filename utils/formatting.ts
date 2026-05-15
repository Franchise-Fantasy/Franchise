import { getEligiblePositions } from '@/utils/roster/rosterSlots';

// WNBA positions come from BDL as bare letters ("G", "F", "C"). Combo
// positions like "G-F" / "F-C" should display verbatim — the spectrum
// expansion in getEligiblePositions is for eligibility checks (so a G
// player can fill a G slot) and isn't appropriate as a display label.
const WNBA_BARE_POSITION_TOKENS = new Set(['G', 'F']);

const formatPosition = (position?: string | null): string => {
  if (!position) return '—';
  const parts = position.split('-');
  if (parts.length <= 1) return parts[0] ?? '—';

  // WNBA combo positions: show the raw tokens, not the NBA spectrum expansion.
  if (parts.some((p) => WNBA_BARE_POSITION_TOKENS.has(p))) {
    return parts.join('/');
  }

  // NBA combos: keep DB order (primary first), expand the range between them
  const eligible = getEligiblePositions(position);
  const primary = parts[0];
  const reordered = [primary, ...eligible.filter(p => p !== primary)];
  return reordered.join('/');
};

export { formatPosition };
