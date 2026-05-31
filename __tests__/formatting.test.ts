import { abbreviateFirstName, formatPosition, ordinalSuffix } from '@/utils/formatting';

describe('formatPosition', () => {
  it('returns em-dash for null/undefined/empty', () => {
    expect(formatPosition(null)).toBe('—');
    expect(formatPosition(undefined)).toBe('—');
    expect(formatPosition('')).toBe('—');
  });

  it('returns a single token as-is', () => {
    expect(formatPosition('PG')).toBe('PG');
    expect(formatPosition('C')).toBe('C');
  });

  it('returns WNBA combo positions verbatim (raw tokens)', () => {
    // WNBA bare letters should NOT spectrum-expand.
    expect(formatPosition('G-F')).toBe('G/F');
    expect(formatPosition('F-C')).toBe('F/C');
  });

  it('expands NBA spectrum positions with DB primary first', () => {
    // PG-SG primary = PG → expansion should start with PG.
    const result = formatPosition('PG-SG');
    expect(result.startsWith('PG')).toBe(true);
    expect(result).toContain('SG');
    expect(result).toContain('/');
  });
});

describe('abbreviateFirstName', () => {
  it('abbreviates "First Last" to "F. Last"', () => {
    expect(abbreviateFirstName('LeBron James')).toBe('L. James');
    expect(abbreviateFirstName('Stephen Curry')).toBe('S. Curry');
  });

  it('handles multi-word last names', () => {
    expect(abbreviateFirstName('Karl-Anthony Towns')).toBe('K. Towns');
    expect(abbreviateFirstName('Shai Gilgeous-Alexander')).toBe('S. Gilgeous-Alexander');
  });

  it('keeps suffixes', () => {
    expect(abbreviateFirstName('Michael Porter Jr.')).toBe('M. Porter Jr.');
  });

  it('returns single-token name unchanged', () => {
    expect(abbreviateFirstName('Giannis')).toBe('Giannis');
    expect(abbreviateFirstName('')).toBe('');
  });
});

describe('ordinalSuffix', () => {
  it('returns "st" for 1, 21, 31', () => {
    expect(ordinalSuffix(1)).toBe('st');
    expect(ordinalSuffix(21)).toBe('st');
    expect(ordinalSuffix(31)).toBe('st');
  });

  it('returns "nd" for 2, 22, 32', () => {
    expect(ordinalSuffix(2)).toBe('nd');
    expect(ordinalSuffix(22)).toBe('nd');
    expect(ordinalSuffix(32)).toBe('nd');
  });

  it('returns "rd" for 3, 23, 33', () => {
    expect(ordinalSuffix(3)).toBe('rd');
    expect(ordinalSuffix(23)).toBe('rd');
    expect(ordinalSuffix(33)).toBe('rd');
  });

  it('returns "th" for the teens (11/12/13)', () => {
    expect(ordinalSuffix(11)).toBe('th');
    expect(ordinalSuffix(12)).toBe('th');
    expect(ordinalSuffix(13)).toBe('th');
  });

  it('returns "th" for other numbers', () => {
    expect(ordinalSuffix(4)).toBe('th');
    expect(ordinalSuffix(15)).toBe('th');
    expect(ordinalSuffix(100)).toBe('th');
  });
});
