import { isRookieDraftComplete, rookieDraftStartOffset } from '@/constants/LeagueDefaults';

describe('isRookieDraftComplete', () => {
  it('is false while not in the offseason', () => {
    expect(isRookieDraftComplete(null)).toBe(false);
    expect(isRookieDraftComplete(undefined)).toBe(false);
  });

  it('is false for offseason steps before the rookie draft is done', () => {
    expect(isRookieDraftComplete('lottery_complete')).toBe(false);
    expect(isRookieDraftComplete('rookie_draft_pending')).toBe(false);
  });

  it('is true once the rookie draft is committed or the offseason wraps up', () => {
    expect(isRookieDraftComplete('rookie_draft_complete')).toBe(true);
    expect(isRookieDraftComplete('ready_for_new_season')).toBe(true);
  });
});

describe('rookieDraftStartOffset', () => {
  it('offsets +1 during the regular season (not in offseason)', () => {
    expect(rookieDraftStartOffset(null)).toBe(1);
  });

  // Regression: advance-season flips `league.season` to the new year at the
  // START of the offseason, before this league's rookie draft has run. The
  // incoming class must stay at offset 0 so it doesn't disappear from the
  // Prospects tab / draft hub the moment the season rolls over.
  it('offsets 0 mid-offseason before this league has drafted the incoming class', () => {
    expect(rookieDraftStartOffset('lottery_complete')).toBe(0);
    expect(rookieDraftStartOffset('rookie_draft_pending')).toBe(0);
  });

  it('offsets +1 again once this league completes its rookie draft', () => {
    expect(rookieDraftStartOffset('rookie_draft_complete')).toBe(1);
    expect(rookieDraftStartOffset('ready_for_new_season')).toBe(1);
  });
});
