// Pure, dependency-free injury-status helpers used by poll-injuries to describe
// a status transition in a push notification. Import-free so jest can unit-test
// it directly (same pattern as newsText.ts / nflStats.ts).

export const INJURY_STATUS_LABEL: Record<string, string> = {
  OUT: 'Out',
  SUSP: 'Suspended',
  DOUBT: 'Doubtful',
  QUES: 'Questionable',
  PROB: 'Probable',
  active: 'Active',
};

// Severity ladder — higher means less likely to play. Picks the upgrade/downgrade
// verb. OUT and SUSP tie: both mean "not playing", so neither is a downgrade of
// the other.
const SEVERITY: Record<string, number> = {
  active: 0,
  PROB: 1,
  QUES: 2,
  DOUBT: 3,
  OUT: 4,
  SUSP: 4,
};

/** e.g. "Darius Acuff upgraded from Questionable to Probable" */
export function describeInjuryTransition(name: string, from: string, to: string): string {
  const fromLabel = INJURY_STATUS_LABEL[from] ?? from;
  const toLabel = INJURY_STATUS_LABEL[to] ?? to;

  if (to === 'active') return `${name} cleared to play (was ${fromLabel})`;
  if (from === 'active') return `${name} listed as ${toLabel}`;

  const fromSev = SEVERITY[from] ?? 0;
  const toSev = SEVERITY[to] ?? 0;
  if (toSev === fromSev) return `${name} now ${toLabel}`;

  return `${name} ${toSev > fromSev ? 'downgraded' : 'upgraded'} from ${fromLabel} to ${toLabel}`;
}
