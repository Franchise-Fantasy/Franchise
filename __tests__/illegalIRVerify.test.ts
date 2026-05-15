// Verification of PR 3 — illegalIR pure helpers extracted to
// utils/roster/illegalIRShared.ts. Test the shared module directly; the
// client wrapper utils/roster/illegalIR.ts imports `react-native` (Alert)
// which Jest doesn't transform — but its re-exports are validated by tsc.

import {
  extractIllegalIRPlayers,
  formatIllegalIRError,
  IR_ELIGIBLE_STATUSES,
  isIrEligibleStatus,
  type IllegalIRPlayer,
} from '@/utils/roster/illegalIRShared';

describe('IR_ELIGIBLE_STATUSES content', () => {
  it('contains the four canonical eligible statuses', () => {
    expect(IR_ELIGIBLE_STATUSES.has('OUT')).toBe(true);
    expect(IR_ELIGIBLE_STATUSES.has('SUSP')).toBe(true);
    expect(IR_ELIGIBLE_STATUSES.has('DOUBT')).toBe(true);
    expect(IR_ELIGIBLE_STATUSES.has('QUES')).toBe(true);
  });

  it('excludes "healthy" statuses', () => {
    expect(IR_ELIGIBLE_STATUSES.has('active')).toBe(false);
    expect(IR_ELIGIBLE_STATUSES.has('PROB')).toBe(false);
    expect(IR_ELIGIBLE_STATUSES.has('')).toBe(false);
  });
});

describe('isIrEligibleStatus', () => {
  it('returns true for eligible statuses', () => {
    expect(isIrEligibleStatus('OUT')).toBe(true);
    expect(isIrEligibleStatus('SUSP')).toBe(true);
    expect(isIrEligibleStatus('DOUBT')).toBe(true);
    expect(isIrEligibleStatus('QUES')).toBe(true);
  });

  it('returns false for healthy / null / undefined', () => {
    expect(isIrEligibleStatus('active')).toBe(false);
    expect(isIrEligibleStatus('PROB')).toBe(false);
    expect(isIrEligibleStatus(null)).toBe(false);
    expect(isIrEligibleStatus(undefined)).toBe(false);
  });
});

describe('formatIllegalIRError', () => {
  it('empty input returns empty string', () => {
    expect(formatIllegalIRError([])).toBe('');
  });

  it('single player uses singular phrasing', () => {
    const players: IllegalIRPlayer[] = [
      { player_id: 'p1', name: 'Player One', status: 'active' },
    ];
    expect(formatIllegalIRError(players)).toBe(
      'Player One is on IR but no longer injured. Move them off IR before making other roster moves.',
    );
  });

  it('multiple players uses plural phrasing', () => {
    const players: IllegalIRPlayer[] = [
      { player_id: 'p1', name: 'Player One', status: 'active' },
      { player_id: 'p2', name: 'Player Two', status: 'PROB' },
    ];
    expect(formatIllegalIRError(players)).toBe(
      'Player One, Player Two are on IR but no longer injured. Move them off IR before making other roster moves.',
    );
  });
});

describe('extractIllegalIRPlayers (the pure logic)', () => {
  it('filters out IR-eligible statuses', () => {
    const result = extractIllegalIRPlayers([
      { id: 'p1', name: 'Sick One', status: 'OUT' },
      { id: 'p2', name: 'Healthy One', status: 'active' },
    ]);
    expect(result).toEqual([
      { player_id: 'p2', name: 'Healthy One', status: 'active' },
    ]);
  });

  it('respects exempt list', () => {
    const result = extractIllegalIRPlayers(
      [
        { id: 'p1', name: 'Healthy One', status: 'active' },
        { id: 'p2', name: 'Healthy Two', status: 'PROB' },
      ],
      ['p1'],
    );
    expect(result).toEqual([
      { player_id: 'p2', name: 'Healthy Two', status: 'PROB' },
    ]);
  });

  it('handles null/missing names', () => {
    const result = extractIllegalIRPlayers([
      { id: 'p1', name: null, status: 'active' },
    ]);
    expect(result).toEqual([
      { player_id: 'p1', name: 'Unknown', status: 'active' },
    ]);
  });
});
