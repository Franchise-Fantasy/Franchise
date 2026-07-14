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
  // Move the DB's primary position to the front
  const reordered = [primary, ...eligible.filter(p => p !== primary)];
  return reordered.join('/');
};

/**
 * Returns "F. LastName" — first initial + period + remainder of full name.
 * Used in tight horizontal layouts (free-agent rows, matchup player cells)
 * where the full first name would clip.
 */
function abbreviateFirstName(name: string): string {
  const idx = name.indexOf(' ');
  if (idx <= 0) return name;
  return `${name[0]}. ${name.slice(idx + 1)}`;
}

/** Returns the ordinal suffix for a number ("st", "nd", "rd", "th"). */
function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0]!;
}

/**
 * Lowercases and strips diacritics for accent-blind search matching, so typing
 * "doncic" finds "Dončić". Fold BOTH the query and the candidate. NFD splits
 * letters from their combining marks (č → c + ̌); the stroked letters and
 * dotless ı never decompose, so they're mapped by hand. Server-side search
 * (search_players_fuzzy) gets the same behavior from Postgres `unaccent`.
 */
function foldSearchText(text: string): string {
  return text
    .toLowerCase() // first: Đ→đ, Ł→ł, İ→i+U+0307 so one lowercase map suffices
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/ł/g, 'l')
    .replace(/ø/g, 'o')
    .replace(/ı/g, 'i');
}

export { formatPosition, abbreviateFirstName, ordinalSuffix, foldSearchText };
