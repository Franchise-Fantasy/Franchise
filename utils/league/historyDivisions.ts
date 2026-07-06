import type { HistoryTeam } from '@/hooks/useImportScreenshot';

/**
 * Maps each team's extracted division label (free text, e.g. "East Division")
 * to the 1/2 numbering `team_seasons.division` stores, matching `teams.division`.
 * Labels are mapped in order of first appearance — the first distinct label seen
 * becomes 1, the second becomes 2. A screenshot with more than two divisions
 * drops the extras (null) rather than guess at a 3-way split the schema doesn't support.
 */
export function assignHistoryDivisions(teams: HistoryTeam[]): (1 | 2 | null)[] {
  const labels: string[] = [];
  return teams.map((t) => {
    if (!t.division) return null;
    let idx = labels.indexOf(t.division);
    if (idx === -1) {
      if (labels.length >= 2) return null;
      labels.push(t.division);
      idx = labels.length - 1;
    }
    return (idx + 1) as 1 | 2;
  });
}
