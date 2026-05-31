import { containsBlockedContent } from '@/utils/moderation';

describe('containsBlockedContent', () => {
  it('returns false for empty / whitespace input', () => {
    expect(containsBlockedContent('')).toBe(false);
    expect(containsBlockedContent('   ')).toBe(false);
  });

  it('returns false for clean text', () => {
    expect(containsBlockedContent('hello world')).toBe(false);
    expect(containsBlockedContent('great trade!')).toBe(false);
    expect(containsBlockedContent('good luck')).toBe(false);
  });

  it('blocks explicit slurs', () => {
    expect(containsBlockedContent('you faggot')).toBe(true);
    expect(containsBlockedContent('what a retard')).toBe(true);
    expect(containsBlockedContent('cunt')).toBe(true);
  });

  it('blocks leet-speak / character substitution', () => {
    expect(containsBlockedContent('f@ggot')).toBe(true);
    expect(containsBlockedContent('r3tard')).toBe(true);
  });

  it('blocks space-evasion attempts', () => {
    expect(containsBlockedContent('f a g g o t')).toBe(true);
  });

  it('blocks accent-stripped slurs', () => {
    expect(containsBlockedContent('rétard')).toBe(true);
  });

  it('does not flag substrings inside legitimate words (boundary check)', () => {
    // "scunthorpe" or "analysis" should not flag — boundary regex prevents this.
    expect(containsBlockedContent('analysis of the trade')).toBe(false);
    expect(containsBlockedContent('classic move')).toBe(false);
  });

  it('blocks white supremacy slogans', () => {
    expect(containsBlockedContent('1488')).toBe(true);
    expect(containsBlockedContent('white power')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(containsBlockedContent('CUNT')).toBe(true);
    expect(containsBlockedContent('Faggot')).toBe(true);
  });
});
