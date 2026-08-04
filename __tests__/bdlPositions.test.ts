import { coerceBdlPosition } from '../utils/sports/bdlPositions';

describe('coerceBdlPosition', () => {
  it('returns null for empty input', () => {
    expect(coerceBdlPosition(null, 'nba')).toBeNull();
    expect(coerceBdlPosition(undefined, 'nba')).toBeNull();
    expect(coerceBdlPosition('', 'nba')).toBeNull();
    expect(coerceBdlPosition('   ', 'nba')).toBeNull();
  });

  describe('basketball (nba + wnba)', () => {
    // BDL's basketball feeds are coarse-only. Bare letters must pass
    // through verbatim — mapping "G" → "SG" is fabricated specificity and
    // is the bug that left the NBA pool with 2 PGs (Sleeper's granular
    // positions were overwritten nightly by the coerced tokens).
    it.each(['G', 'F', 'C', 'G-F', 'F-C'])(
      'passes coarse token %s through verbatim',
      (token) => {
        expect(coerceBdlPosition(token, 'nba')).toBe(token);
        expect(coerceBdlPosition(token, 'wnba')).toBe(token);
      },
    );

    it('normalizes reversed hyphen direction', () => {
      expect(coerceBdlPosition('F-G', 'nba')).toBe('G-F');
      expect(coerceBdlPosition('C-F', 'nba')).toBe('F-C');
      expect(coerceBdlPosition('F-G', 'wnba')).toBe('G-F');
      expect(coerceBdlPosition('C-F', 'wnba')).toBe('F-C');
    });

    it('passes granular tokens through unchanged if BDL ever returns them', () => {
      expect(coerceBdlPosition('PG', 'nba')).toBe('PG');
      expect(coerceBdlPosition('PF-C', 'nba')).toBe('PF-C');
    });

    it('trims and uppercases', () => {
      expect(coerceBdlPosition(' g ', 'nba')).toBe('G');
    });
  });

  describe('nfl', () => {
    it('maps offense + kicker tokens to the disjoint set', () => {
      expect(coerceBdlPosition('QB', 'nfl')).toBe('QB');
      expect(coerceBdlPosition('FB', 'nfl')).toBe('RB');
      expect(coerceBdlPosition('PK', 'nfl')).toBe('K');
    });

    it('returns null for OL/IDP tokens so basketball G/C never collide', () => {
      expect(coerceBdlPosition('G', 'nfl')).toBeNull();
      expect(coerceBdlPosition('C', 'nfl')).toBeNull();
      expect(coerceBdlPosition('OT', 'nfl')).toBeNull();
      expect(coerceBdlPosition('LB', 'nfl')).toBeNull();
    });
  });
});
