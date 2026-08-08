import fs from 'fs';
import path from 'path';

import {
  blockedContentMessage,
  findBlockedContent,
  SPLITTABLE_WORDS,
} from '@/utils/moderation';

const isBlocked = (text: string) => findBlockedContent(text) !== null;

describe('findBlockedContent', () => {
  it('returns null for empty / whitespace input', () => {
    expect(findBlockedContent('')).toBeNull();
    expect(findBlockedContent('   ')).toBeNull();
  });

  it('returns null for clean text', () => {
    expect(isBlocked('hello world')).toBe(false);
    expect(isBlocked('great trade!')).toBe(false);
    expect(isBlocked('good luck')).toBe(false);
  });

  it('blocks explicit slurs', () => {
    expect(isBlocked('you faggot')).toBe(true);
    expect(isBlocked('what a retard')).toBe(true);
    expect(isBlocked('cunt')).toBe(true);
  });

  it('blocks leet-speak / character substitution', () => {
    expect(isBlocked('f@ggot')).toBe(true);
    expect(isBlocked('r3tard')).toBe(true);
  });

  it('blocks space-evasion attempts', () => {
    expect(isBlocked('f a g g o t')).toBe(true);
    expect(isBlocked('n igger')).toBe(true);
    expect(isBlocked('you are a re tard')).toBe(true);
    expect(isBlocked('sp ic')).toBe(true);
  });

  it('blocks accent-stripped slurs', () => {
    expect(isBlocked('rétard')).toBe(true);
  });

  // Regression: the old space-stripped substring pass flagged any word pair whose
  // join straddled a slur, which blocked a real league survey ("supports picks").
  it('does not flag slurs straddling a word boundary', () => {
    expect(isBlocked('a platform that supports pick swaps')).toBe(false);
    expect(isBlocked('1.5 hours/pick')).toBe(false);
    expect(isBlocked('that trade was suspicious')).toBe(false);
    expect(isBlocked('Nets picks')).toBe(false);
    expect(isBlocked('he missed half a game')).toBe(false);
    expect(isBlocked('would a raccoon be a better GM')).toBe(false);
    expect(isBlocked('Chicago okay')).toBe(false);
  });

  it('blocks white supremacy slogans', () => {
    expect(isBlocked('1488')).toBe(true);
    expect(isBlocked('white power')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isBlocked('CUNT')).toBe(true);
    expect(isBlocked('Faggot')).toBe(true);
  });

  it('does not flag substrings inside legitimate words (boundary check)', () => {
    expect(isBlocked('analysis of the trade')).toBe(false);
    expect(isBlocked('classic move')).toBe(false);
  });
});

// The whole point of reporting a span: a cross-word match is unrecognizable
// without it, and quoting the normalized form would print a slur at a user who
// never typed one. Every span below is a verbatim slice of the input.
describe('findBlockedContent reported span', () => {
  it('quotes the term as typed, not as normalized', () => {
    expect(findBlockedContent('you are a f@ggot')).toEqual({
      text: 'f@ggot',
      kind: 'word',
    });
    expect(findBlockedContent('what a r3tard move')).toEqual({
      text: 'r3tard',
      kind: 'word',
    });
  });

  it('preserves the original casing and accents', () => {
    expect(findBlockedContent('Total Rétard')?.text).toBe('Rétard');
  });

  it('quotes the innocent words for a cross-word match', () => {
    expect(findBlockedContent("let's go ok")).toEqual({ text: 'go ok', kind: 'split' });
    expect(findBlockedContent('you are a f a g dude')).toEqual({
      text: 'f a g',
      kind: 'split',
    });
  });

  it('reports a span that is always a verbatim slice of the input', () => {
    const inputs = ['you faggot', 'f a g g o t', 'n igger', 'sp ic', 'white power', 'F@GS'];
    for (const input of inputs) {
      const match = findBlockedContent(input);
      expect(match).not.toBeNull();
      expect(input).toContain(match!.text);
    }
  });

  it('finds the offending phrase inside a long survey', () => {
    const survey = [
      '2026 Offseason Survey',
      'Do you want to eliminate conferences?',
      'Is this guy a re tard or what',
      'How many keepers should we have?',
    ].join(' ');
    expect(findBlockedContent(survey)).toEqual({ text: 're tard', kind: 'split' });
  });
});

describe('blockedContentMessage', () => {
  it('names the term for a directly-typed slur', () => {
    const match = findBlockedContent('you retard')!;
    expect(blockedContentMessage(match, 'message')).toBe(
      'Your message contains language that isn’t allowed: “retard”.',
    );
  });

  it('explains the join for a cross-word match', () => {
    const match = findBlockedContent('go ok')!;
    const msg = blockedContentMessage(match, 'survey');
    expect(msg).toContain('“go ok”');
    expect(msg).toContain('run together');
    expect(msg).toContain('Rewording');
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
