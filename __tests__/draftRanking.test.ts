import {
  DRAFT_PROJECTION_GAME_THRESHOLD,
  effectiveDraftPts,
  preferProjection,
} from '@/utils/draft/draftRanking';

describe('preferProjection', () => {
  it('prefers a projection until the games threshold is crossed', () => {
    expect(preferProjection(0)).toBe(true);
    expect(preferProjection(DRAFT_PROJECTION_GAME_THRESHOLD - 1)).toBe(true);
    expect(preferProjection(DRAFT_PROJECTION_GAME_THRESHOLD)).toBe(false);
    expect(preferProjection(40)).toBe(false);
  });

  it('treats null / undefined games as no sample (preseason)', () => {
    expect(preferProjection(null)).toBe(true);
    expect(preferProjection(undefined)).toBe(true);
  });
});

describe('effectiveDraftPts', () => {
  it('uses current average once the player has enough games', () => {
    expect(
      effectiveDraftPts({
        gamesPlayed: 20,
        currentAvgPts: 18.2,
        seasonProjPts: 25, // ignored — real sample wins
        lastSeasonAvgPts: 22,
      }),
    ).toBe(18.2);
  });

  it('uses the season projection for a thin-sample player', () => {
    expect(
      effectiveDraftPts({
        gamesPlayed: 2,
        currentAvgPts: 4.1, // 2-game noise, ignored
        seasonProjPts: 23.4,
        lastSeasonAvgPts: 19,
      }),
    ).toBe(23.4);
  });

  it('falls back to last-season production when no projection exists', () => {
    expect(
      effectiveDraftPts({
        gamesPlayed: 0,
        currentAvgPts: null,
        seasonProjPts: null,
        lastSeasonAvgPts: 16.5,
      }),
    ).toBe(16.5);
  });

  it('falls through when a player has enough games but no recorded average', () => {
    // Defensive: gp >= threshold but avg somehow null → use the next signal.
    expect(
      effectiveDraftPts({
        gamesPlayed: 30,
        currentAvgPts: null,
        seasonProjPts: 12,
      }),
    ).toBe(12);
  });

  it('returns 0 when nothing is known (preseason fringe player)', () => {
    expect(
      effectiveDraftPts({
        gamesPlayed: 0,
        currentAvgPts: null,
        seasonProjPts: null,
        lastSeasonAvgPts: null,
      }),
    ).toBe(0);
  });

  it('preseason star (0 games, projection present) ranks on the projection', () => {
    // The WNBA pre-tipoff case that broke autodraft: everyone has 0 games and
    // NULL current avg, so ranking must come from the projection.
    const wilson = effectiveDraftPts({ gamesPlayed: 0, currentAvgPts: null, seasonProjPts: 23.4 });
    const benchWarmer = effectiveDraftPts({ gamesPlayed: 0, currentAvgPts: null, seasonProjPts: 3.1 });
    expect(wilson).toBeGreaterThan(benchWarmer);
  });
});
