import {
  detectMinutesRestriction,
  extractReturnEstimate,
  extractTag,
  isFantasyRelevant,
  matchPlayersInText,
  stripHtml,
} from '../supabase/functions/_shared/newsText';

describe('stripHtml', () => {
  it('leaves plain text untouched (RotoWire-style)', () => {
    expect(stripHtml('Jaylen Brown is listed as day-to-day')).toBe(
      'Jaylen Brown is listed as day-to-day',
    );
  });

  it('strips real HTML tags', () => {
    expect(stripHtml('<b>Hi</b> there')).toBe('Hi there');
  });

  it('decodes text entities', () => {
    expect(stripHtml('A &amp; B said &quot;go&quot;')).toBe('A & B said "go"');
  });

  // Regression: Google News entity-encodes the HTML inside <description>, so the
  // encoded tags must be decoded BEFORE stripping or they leak through as
  // literal "<a href=...>" text in the card.
  it('strips Google News entity-encoded markup (no literal tags leak through)', () => {
    const raw =
      '&lt;a href="https://news.google.com/rss/articles/CBM123"&gt;' +
      'Celtics Jaylen Brown proposes debate&lt;/a&gt;&nbsp;&lt;font color="#6f6f6f"&gt;Yahoo Sports&lt;/font&gt;';
    const out = stripHtml(raw);
    expect(out).not.toContain('<');
    expect(out).not.toContain('href');
    expect(out).not.toContain('news.google.com');
    expect(out).toContain('Celtics Jaylen Brown proposes debate');
    expect(out).toContain('Yahoo Sports');
  });

  it('collapses runs of whitespace', () => {
    expect(stripHtml('multiple    spaces\n\there')).toBe('multiple spaces here');
  });
});

describe('extractTag', () => {
  it('reads a simple tag', () => {
    expect(extractTag('<title>Hello</title>', 'title')).toBe('Hello');
  });

  it('reads a CDATA tag with attributes', () => {
    expect(extractTag('<guid isPermaLink="false"><![CDATA[abc123]]></guid>', 'guid')).toBe('abc123');
  });

  it('returns empty string when absent', () => {
    expect(extractTag('<title>x</title>', 'link')).toBe('');
  });
});

describe('detectMinutesRestriction', () => {
  it('flags a minutes restriction', () => {
    expect(detectMinutesRestriction('He will be on a minutes restriction tonight')).toBe(true);
  });

  it('respects negations', () => {
    expect(detectMinutesRestriction('He is off his minutes restriction')).toBe(false);
  });

  it('ignores unrelated text', () => {
    expect(detectMinutesRestriction('He scored 30 points')).toBe(false);
  });
});

describe('extractReturnEstimate', () => {
  it('extracts season-ending', () => {
    expect(extractReturnEstimate('He is out for the season')).toBe('out for season');
  });

  it('treats "season-ending" as out-for-season only in an injury context', () => {
    expect(extractReturnEstimate('Suffers season-ending knee injury')).toBe('out for season');
    expect(extractReturnEstimate('To undergo season-ending surgery')).toBe('out for season');
    expect(extractReturnEstimate('Diagnosed with a season-ending Achilles tear')).toBe('out for season');
  });

  // Regression: a playoff-elimination recap ("season-ending loss/defeat") is
  // about the team's season, not the player's availability — must NOT label.
  it('does not label a "season-ending loss" recap as out-for-season', () => {
    expect(extractReturnEstimate('Scores 35 in season-ending loss')).toBeNull();
    expect(extractReturnEstimate('Drops 40 in season-ending defeat to the Nuggets')).toBeNull();
    expect(extractReturnEstimate('Logs a triple-double in season-ending Game 7 loss')).toBeNull();
  });

  it('extracts a week range', () => {
    expect(extractReturnEstimate('expected to miss 2 to 4 weeks')).toBe('2-4 weeks');
  });

  it('extracts day-to-day', () => {
    expect(extractReturnEstimate('listed as day-to-day')).toBe('day-to-day');
  });

  it('returns null when no estimate present', () => {
    expect(extractReturnEstimate('played well last night')).toBeNull();
  });
});

describe('isFantasyRelevant', () => {
  it('drops highlight clips and box scores', () => {
    expect(isFantasyRelevant('Veronica Burton Drains the Shot')).toBe(false);
    expect(isFantasyRelevant('Highlights from the game')).toBe(false);
    expect(isFantasyRelevant("Sabrina Ionescu, Azzi Fudd's Final Box Score Stats")).toBe(false);
    expect(isFantasyRelevant('Watch: top plays from Sunday night')).toBe(false);
  });

  it('keeps injury / availability news', () => {
    expect(isFantasyRelevant('Player X out for the season with torn ACL')).toBe(true);
    expect(isFantasyRelevant('Star guard listed as questionable vs Lakers')).toBe(true);
    expect(isFantasyRelevant('Forward dealing with ankle soreness')).toBe(true);
    expect(isFantasyRelevant('Center expected to miss two weeks')).toBe(true);
  });

  it('drops mock trades / mock drafts even though they contain "trade"', () => {
    expect(isFantasyRelevant('NBA Mock Trade: Lakers land All-Star guard')).toBe(false);
    expect(isFantasyRelevant('2026 WNBA Mock Draft: latest projections')).toBe(false);
  });

  it('keeps role and transaction news', () => {
    expect(isFantasyRelevant('Rookie moves into the starting lineup')).toBe(true);
    expect(isFantasyRelevant('Wings sign veteran guard to a contract')).toBe(true);
    expect(isFantasyRelevant('Liberty waive forward after camp')).toBe(true);
    expect(isFantasyRelevant('Player traded to the Storm')).toBe(true);
  });
});

describe('matchPlayersInText', () => {
  const index = new Map<string, string[]>([
    ['lebron james', ['p1']],
    ['anthony davis', ['p2']],
  ]);

  it('matches a full name on word boundaries', () => {
    expect(matchPlayersInText('lebron james scored 30', index)).toEqual(['p1']);
  });

  it('does not match inside a longer word', () => {
    expect(matchPlayersInText('lebron jameson is unrelated', index)).toEqual([]);
  });

  it('matches multiple players', () => {
    expect(matchPlayersInText('lebron james and anthony davis', index).sort()).toEqual(['p1', 'p2']);
  });
});
