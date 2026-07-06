import { applyDefaultTeamMatches, matchHistoryTeamName } from '@/utils/league/historyTeamMatch';
import { normalizePlayoffResult } from '@/types/playoff';

// Minimal HistoryTeam factory (only the fields the reconciler touches).
const team = (over: Partial<{ team_name: string; playoff_result: string | null; source_name: string | null }>) => ({
  team_name: over.team_name ?? '',
  wins: null,
  losses: null,
  ties: null,
  points_for: null,
  points_against: null,
  standing: null,
  playoff_result: over.playoff_result ?? null,
  source_name: over.source_name ?? null,
});

describe('matchHistoryTeamName', () => {
  const teams = ['Splash Bros', 'Dubs Dynasty', "Béla's Crew"];

  it('matches case-insensitively and ignores punctuation', () => {
    expect(matchHistoryTeamName('splash bros', teams)).toBe('Splash Bros');
    expect(matchHistoryTeamName('Dubs Dynasty!!', teams)).toBe('Dubs Dynasty');
  });

  it('strips accents and apostrophes', () => {
    expect(matchHistoryTeamName('Belas Crew', teams)).toBe("Béla's Crew");
  });

  it('returns null when nothing is a confident match', () => {
    expect(matchHistoryTeamName('Totally Unknown', teams)).toBeNull();
    expect(matchHistoryTeamName('', teams)).toBeNull();
  });
});

describe('applyDefaultTeamMatches', () => {
  const teams = ['Splash Bros', 'Dubs Dynasty'];

  it('rewrites team_name to the league team and preserves the original in source_name', () => {
    const [row] = applyDefaultTeamMatches([team({ team_name: 'splash bros' })], teams);
    expect(row.team_name).toBe('Splash Bros');
    expect(row.source_name).toBe('splash bros');
  });

  it('does not assign the same league team to two rows', () => {
    const out = applyDefaultTeamMatches(
      [team({ team_name: 'Splash Bros' }), team({ team_name: 'Splash Brothers' })],
      teams,
    );
    expect(out[0].team_name).toBe('Splash Bros');
    // Second row wanted the same team — stays unmatched (keeps its own name).
    expect(out[1].team_name).toBe('Splash Brothers');
  });

  it('normalizes stray playoff values and drops inventions', () => {
    const out = applyDefaultTeamMatches(
      [team({ team_name: 'Dubs Dynasty', playoff_result: 'semifinalist' })],
      teams,
    );
    expect(out[0].playoff_result).toBeNull();
  });
});

describe('normalizePlayoffResult', () => {
  it('maps synonyms to canonical placements', () => {
    expect(normalizePlayoffResult('Champions')).toBe('champion');
    expect(normalizePlayoffResult('runner-up')).toBe('runner_up');
    expect(normalizePlayoffResult('3rd')).toBe('third_place');
    expect(normalizePlayoffResult('4th')).toBe('fourth_place');
    expect(normalizePlayoffResult('DNQ')).toBe('missed_playoffs');
  });

  it('returns null for unknown / empty values', () => {
    expect(normalizePlayoffResult('semifinalist')).toBeNull();
    expect(normalizePlayoffResult(null)).toBeNull();
    expect(normalizePlayoffResult('')).toBeNull();
  });
});
