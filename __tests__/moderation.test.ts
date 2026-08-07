import fs from 'fs';
import path from 'path';

import { containsBlockedContent, SPLITTABLE_WORDS } from '@/utils/moderation';

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
    expect(containsBlockedContent('n igger')).toBe(true);
    expect(containsBlockedContent('you are a re tard')).toBe(true);
    expect(containsBlockedContent('sp ic')).toBe(true);
  });

  // Regression: the old space-stripped substring pass flagged any word pair whose
  // join straddled a slur, which blocked a real league survey ("supports picks").
  it('does not flag slurs straddling a word boundary', () => {
    expect(containsBlockedContent('a platform that supports pick swaps')).toBe(false);
    expect(containsBlockedContent('1.5 hours/pick')).toBe(false);
    expect(containsBlockedContent('that trade was suspicious')).toBe(false);
    expect(containsBlockedContent('Nets picks')).toBe(false);
    expect(containsBlockedContent('he missed half a game')).toBe(false);
    expect(containsBlockedContent('would a raccoon be a better GM')).toBe(false);
    expect(containsBlockedContent('Chicago okay')).toBe(false);
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

// The SQL trigger check_blocked_content() is what actually enforces moderation;
// this client copy only produces a nicer error before the round trip. Postgres
// can't import the module, so the split-word list is duplicated there by hand.
describe('SQL parity: check_blocked_content() blocked_words', () => {
  const MIGRATION = path.join(
    __dirname,
    '../supabase/migrations/20260807120000_fix_blocked_content_false_positives.sql',
  );

  it('matches the TS split-word list exactly', () => {
    const sql = fs.readFileSync(MIGRATION, 'utf8');
    const match = sql.match(/blocked_words text\[\] := ARRAY\[([\s\S]*?)\];/);
    expect(match).not.toBeNull();

    const sqlWords = [...match![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(sqlWords.slice().sort()).toEqual(SPLITTABLE_WORDS.slice().sort());
  });
});
