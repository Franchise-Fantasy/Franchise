import { inputsDigest, queryKeys } from '@/constants/queryKeys';

describe('inputsDigest', () => {
  it('is order-independent', () => {
    // The player-id list comes from an RPC with no ORDER BY, so the same set can
    // arrive in any order. It must not churn the cache key.
    expect(inputsDigest(['p1', 'p2', 'p3'])).toBe(inputsDigest(['p3', 'p1', 'p2']));
  });

  it('differs when the set differs', () => {
    // The whole point: one team's roster and the full league must not collide.
    const oneTeam = ['p1', 'p2'];
    const wholeLeague = ['p1', 'p2', 'p3', 'p4'];
    expect(inputsDigest(oneTeam)).not.toBe(inputsDigest(wholeLeague));
  });

  it('does not collide on ambiguous concatenation', () => {
    expect(inputsDigest(['ab', 'c'])).not.toBe(inputsDigest(['a', 'bc']));
  });

  it('changes when scoring weights change', () => {
    const ids = ['p1', 'p2'];
    const before = inputsDigest([...ids, 'PTS=1']);
    const after = inputsDigest([...ids, 'PTS=2']);
    expect(before).not.toBe(after);
  });
});

describe('queryKeys.prevSeasonFpts', () => {
  // Regression: the key used to be (leagueId, season) only, while the fetcher
  // filtered on a player-id list. The roster tab (one team) and the analytics
  // preview card (the whole league) shared one cache entry, so whichever loaded
  // first won and the card ranked every other team with no prev-season fallback
  // — its numbers changed between app opens with no roster change.
  it('separates a single-team fetch from a league-wide one', () => {
    const oneTeam = queryKeys.prevSeasonFpts('lg', '2025-26', inputsDigest(['p1', 'p2']));
    const league = queryKeys.prevSeasonFpts('lg', '2025-26', inputsDigest(['p1', 'p2', 'p3']));
    expect(oneTeam).not.toEqual(league);
  });

  it('reuses one entry for the same player set', () => {
    // The analytics screen and the preview card both fetch every league player —
    // they should still share a single cache entry.
    const card = queryKeys.prevSeasonFpts('lg', '2025-26', inputsDigest(['p1', 'p2']));
    const screen = queryKeys.prevSeasonFpts('lg', '2025-26', inputsDigest(['p2', 'p1']));
    expect(card).toEqual(screen);
  });
});
