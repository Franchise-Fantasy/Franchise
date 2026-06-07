import {
  buildCategoriesContentState,
  buildPointsContentState,
  categoryResultsToLines,
  formatTopCategory,
  rankCategories,
} from '@/utils/liveActivity/contentState';

describe('liveActivity/contentState', () => {
  describe('categoryResultsToLines', () => {
    it('flips winner perspective when called from the away side', () => {
      const lines = categoryResultsToLines(
        [
          { stat: 'PTS', home: 234, away: 198, winner: 'home' },
          { stat: 'TO', home: 12, away: 9, winner: 'away' },
          { stat: 'BLK', home: 5, away: 5, winner: 'tie' },
        ],
        'away',
        { TO: true },
      );
      expect(lines[0]).toEqual({ stat: 'PTS', myValue: 198, oppValue: 234, winner: 'opp', inverse: false });
      expect(lines[1]).toEqual({ stat: 'TO', myValue: 9, oppValue: 12, winner: 'me', inverse: true });
      expect(lines[2]).toEqual({ stat: 'BLK', myValue: 5, oppValue: 5, winner: 'tie', inverse: false });
    });

    it('marks inverse stats per the inverseByStat map', () => {
      const lines = categoryResultsToLines(
        [{ stat: 'TO', home: 12, away: 9, winner: 'away' }],
        'home',
        { TO: true, PTS: false },
      );
      expect(lines[0].inverse).toBe(true);
    });
  });

  describe('rankCategories', () => {
    it('surfaces untied categories before tied ones', () => {
      const ranked = rankCategories([
        { stat: 'AST', myValue: 20, oppValue: 20, winner: 'tie', inverse: false },
        { stat: 'PTS', myValue: 200, oppValue: 198, winner: 'me', inverse: false },
      ]);
      expect(ranked.map((l) => l.stat)).toEqual(['PTS', 'AST']);
    });

    it('orders by largest absolute margin among non-tied', () => {
      const ranked = rankCategories([
        { stat: 'AST', myValue: 25, oppValue: 22, winner: 'me', inverse: false },
        { stat: 'PTS', myValue: 234, oppValue: 198, winner: 'me', inverse: false },
        { stat: 'BLK', myValue: 5, oppValue: 4, winner: 'me', inverse: false },
      ]);
      expect(ranked.map((l) => l.stat)).toEqual(['PTS', 'AST', 'BLK']);
    });

    it('scales percentage-stat margins so they rank against counting stats', () => {
      // FG% diff of 0.080 → 80 scaled. PTS diff 50 → 50. Percentage wins.
      const ranked = rankCategories([
        { stat: 'PTS', myValue: 200, oppValue: 150, winner: 'me', inverse: false },
        { stat: 'FG%', myValue: 0.5, oppValue: 0.42, winner: 'me', inverse: false },
      ]);
      expect(ranked[0].stat).toBe('FG%');
    });
  });

  describe('formatTopCategory', () => {
    it('returns empty string when nothing is decided', () => {
      expect(formatTopCategory([])).toBe('');
      expect(
        formatTopCategory([{ stat: 'PTS', myValue: 100, oppValue: 100, winner: 'tie', inverse: false }]),
      ).toBe('');
    });

    it('formats the most decisive counting-stat lead', () => {
      const out = formatTopCategory([
        { stat: 'REB', myValue: 58, oppValue: 40, winner: 'me', inverse: false },
        { stat: 'AST', myValue: 26, oppValue: 24, winner: 'me', inverse: false },
      ]);
      expect(out).toBe('Top cat: REB +18');
    });

    it('flips sign on inverse stats so a turnover advantage reads positive', () => {
      // "I have 8 TO, opp has 14" → my-opp = -6 raw; inverse → display as +6
      const out = formatTopCategory([
        { stat: 'TO', myValue: 8, oppValue: 14, winner: 'me', inverse: true },
      ]);
      expect(out).toBe('Top cat: TO +6');
    });

    it('formats percentage stats with one decimal of percent', () => {
      const out = formatTopCategory([
        { stat: 'FG%', myValue: 0.487, oppValue: 0.4, winner: 'me', inverse: false },
      ]);
      expect(out).toBe('Top cat: FG% +8.7%');
    });
  });

  describe('buildPointsContentState', () => {
    it('stamps mode=points and computes scoreGap', () => {
      const cs = buildPointsContentState({
        myTeamName: 'A',
        opponentTeamName: 'B',
        myTeamTricode: 'AAA',
        opponentTeamTricode: 'BBB',
        myScore: 123.4,
        opponentScore: 110.1,
        biggestContributor: 'J. Smith 24p 8r',
        myActivePlayers: 3,
        opponentActivePlayers: 2,
        players: [],
      });
      expect(cs.mode).toBe('points');
      expect(cs.scoreGap).toBeCloseTo(13.3);
    });
  });

  describe('buildCategoriesContentState', () => {
    it('stamps mode=categories, ranks, and synthesizes biggestContributor', () => {
      const cs = buildCategoriesContentState({
        myTeamName: 'A',
        opponentTeamName: 'B',
        myTeamTricode: 'AAA',
        opponentTeamTricode: 'BBB',
        myWins: 5,
        oppWins: 3,
        ties: 1,
        categories: [
          { stat: 'AST', myValue: 25, oppValue: 22, winner: 'me', inverse: false },
          { stat: 'PTS', myValue: 234, oppValue: 198, winner: 'me', inverse: false },
          { stat: 'STL', myValue: 8, oppValue: 8, winner: 'tie', inverse: false },
        ],
        myActivePlayers: 0,
        opponentActivePlayers: 0,
      });
      expect(cs.mode).toBe('categories');
      expect(cs.myScore).toBe(5);
      expect(cs.opponentScore).toBe(3);
      expect(cs.scoreGap).toBe(2);
      expect(cs.catTies).toBe(1);
      // Ranked: PTS first (largest margin), then AST, then STL (tied)
      expect(cs.categories.map((l) => l.stat)).toEqual(['PTS', 'AST', 'STL']);
      expect(cs.biggestContributor).toBe('Top cat: PTS +36');
      // CAT mode doesn't carry a player ticker
      expect(cs.players).toEqual([]);
    });

    it('returns empty biggestContributor when everything is tied', () => {
      const cs = buildCategoriesContentState({
        myTeamName: 'A',
        opponentTeamName: 'B',
        myTeamTricode: 'AAA',
        opponentTeamTricode: 'BBB',
        myWins: 0,
        oppWins: 0,
        ties: 2,
        categories: [
          { stat: 'PTS', myValue: 100, oppValue: 100, winner: 'tie', inverse: false },
          { stat: 'AST', myValue: 20, oppValue: 20, winner: 'tie', inverse: false },
        ],
        myActivePlayers: 0,
        opponentActivePlayers: 0,
      });
      expect(cs.biggestContributor).toBe('');
    });
  });
});
