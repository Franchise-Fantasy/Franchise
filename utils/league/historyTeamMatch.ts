import type { HistoryTeam } from '@/hooks/useImportScreenshot';
import { normalizePlayoffResult } from '@/types/playoff';

/** Normalize a team name for fuzzy matching — strips accents, punctuation, casing. */
function normalize(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[._'-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Best-effort match of an extracted/historical team name to one of the league's
 * current team names. Mirrors the importer's server-side matcher (exact →
 * normalized → substring → word-prefix) but returns the league team NAME so the
 * caller can rewrite the history row to exact-match on the server. Returns null
 * when nothing is a confident match — the row then shows as "unmatched" for the
 * commissioner to reconcile in the History step.
 */
export function matchHistoryTeamName(name: string, teamNames: string[]): string | null {
  if (teamNames.includes(name)) return name;
  const norm = normalize(name);
  if (!norm) return null;
  const normed = teamNames.map((t) => ({ name: t, norm: normalize(t) }));
  const exactNorm = normed.find((t) => t.norm === norm);
  if (exactNorm) return exactNorm.name;
  const contains = normed.find((t) => t.norm.includes(norm) || norm.includes(t.norm));
  if (contains) return contains.name;
  const words = norm.split(' ');
  const wordMatch = normed.find((t) => {
    const tw = t.norm.split(' ');
    return words.some((w) => w.length >= 3 && tw.some((x) => x.startsWith(w) || w.startsWith(x)));
  });
  return wordMatch?.name ?? null;
}

/**
 * Reconcile freshly-extracted standings before they're shown/saved:
 *  - seed each row's original name into `source_name`,
 *  - rewrite `team_name` to the matched league team so the importer's
 *    exact-match path attaches the row to the right franchise (deduped — a
 *    league team already claimed by an earlier row can't be auto-assigned
 *    twice; the later row stays unmatched for manual reconciliation), and
 *  - normalize `playoff_result` to a known placement (drops OCR inventions
 *    like "semifinalist" rather than rendering them raw).
 * Unmatched rows keep their original name. Runs with empty `teamNames` too so
 * placement normalization still happens before teams are known.
 */
export function applyDefaultTeamMatches(teams: HistoryTeam[], teamNames: string[]): HistoryTeam[] {
  const used = new Set<string>();
  return teams.map((t) => {
    const source = t.source_name ?? t.team_name;
    const playoff_result = normalizePlayoffResult(t.playoff_result);
    if (teamNames.length === 0) return { ...t, source_name: source, playoff_result };
    let matched = matchHistoryTeamName(source, teamNames);
    if (matched && used.has(matched)) matched = null;
    if (matched) used.add(matched);
    return { ...t, source_name: source, team_name: matched ?? source, playoff_result };
  });
}
