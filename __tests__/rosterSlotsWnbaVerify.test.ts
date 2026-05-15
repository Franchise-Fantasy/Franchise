// Temporary WNBA verification test for PR 4. Confirms the refactored
// position-eligibility primitives behave correctly for bare-letter WNBA
// tokens (G, F, C, G-F, F-C) — these were silently broken under OLD HEAD's
// POSITION_SPECTRUM.indexOf logic and are now active across the client.

import {
  getEligiblePositions,
  isEligibleForSlot,
} from '@/utils/roster/rosterSlots';

describe('WNBA bare-letter tokens: getEligiblePositions', () => {
  it('G expands to PG/SG (so a G player can fill a G slot)', () => {
    expect(getEligiblePositions('G')).toEqual(['PG', 'SG']);
  });

  it('F expands to SF/PF (so an F player can fill an F slot)', () => {
    expect(getEligiblePositions('F')).toEqual(['SF', 'PF']);
  });

  it('C stays C', () => {
    expect(getEligiblePositions('C')).toEqual(['C']);
  });

  it('G-F covers PG through PF', () => {
    expect(getEligiblePositions('G-F')).toEqual(['PG', 'SG', 'SF', 'PF']);
  });

  it('F-C covers SF through C', () => {
    expect(getEligiblePositions('F-C')).toEqual(['SF', 'PF', 'C']);
  });
});

describe('WNBA: isEligibleForSlot with bare-letter player positions', () => {
  it('G player → G slot ✓', () => {
    expect(isEligibleForSlot('G', 'G')).toBe(true);
  });

  it('F player → F slot ✓', () => {
    expect(isEligibleForSlot('F', 'F')).toBe(true);
  });

  it('C player → C slot ✓', () => {
    expect(isEligibleForSlot('C', 'C')).toBe(true);
  });

  it('G player → F slot ✗', () => {
    expect(isEligibleForSlot('G', 'F')).toBe(false);
  });

  it('G player → C slot ✗', () => {
    expect(isEligibleForSlot('G', 'C')).toBe(false);
  });

  it('G-F player → G slot ✓ (combo includes G eligibility)', () => {
    expect(isEligibleForSlot('G-F', 'G')).toBe(true);
  });

  it('G-F player → F slot ✓', () => {
    expect(isEligibleForSlot('G-F', 'F')).toBe(true);
  });

  it('G-F player → C slot ✗', () => {
    expect(isEligibleForSlot('G-F', 'C')).toBe(false);
  });

  it('F-C player → F slot ✓', () => {
    expect(isEligibleForSlot('F-C', 'F')).toBe(true);
  });

  it('F-C player → C slot ✓', () => {
    expect(isEligibleForSlot('F-C', 'C')).toBe(true);
  });

  it('F-C player → G slot ✗', () => {
    expect(isEligibleForSlot('F-C', 'G')).toBe(false);
  });
});

describe('WNBA-aware formatPosition', () => {
  // We import lazily to avoid an unused-import warning if jest hoists.
  const { formatPosition } = require('@/utils/formatting');

  it('single "G" displays verbatim', () => {
    expect(formatPosition('G')).toBe('G');
  });

  it('single "F" displays verbatim', () => {
    expect(formatPosition('F')).toBe('F');
  });

  it('"G-F" combo displays verbatim (not the NBA spectrum expansion)', () => {
    expect(formatPosition('G-F')).toBe('G/F');
  });

  it('"F-C" combo displays verbatim', () => {
    expect(formatPosition('F-C')).toBe('F/C');
  });

  it('NBA "PG-SG" still expands properly', () => {
    expect(formatPosition('PG-SG')).toBe('PG/SG');
  });

  it('NBA "SF-PG" still expands the spectrum', () => {
    expect(formatPosition('SF-PG')).toBe('SF/PG/SG');
  });
});
