import { mapGameStatus } from '@/utils/sports/gameStatus';

// A fixed instant so the NFL kickoff comparison is deterministic.
const NOW = Date.parse('2026-09-13T18:30:00Z'); // mid-afternoon on an NFL Sunday
const KICKOFF_EARLIER = '2026-09-13T17:00:00Z'; // 1:00 PM ET — already kicked off
const KICKOFF_LATER = '2026-09-14T00:20:00Z'; // SNF — hasn't kicked off yet

const SCHEDULED = 1;
const LIVE = 2;
const FINAL = 3;

describe('mapGameStatus — basketball (unchanged behavior)', () => {
  it('maps NBA lifecycle strings', () => {
    expect(mapGameStatus('Final', 'nba')).toBe(FINAL);
    expect(mapGameStatus('Q1 8:32', 'nba')).toBe(LIVE);
    expect(mapGameStatus('Q4 :09.1', 'nba')).toBe(LIVE);
    expect(mapGameStatus('Half', 'nba')).toBe(LIVE);
    expect(mapGameStatus('OT 2:11', 'nba')).toBe(LIVE);
    expect(mapGameStatus('', 'nba')).toBe(SCHEDULED);
    expect(mapGameStatus('7:30 PM ET', 'nba')).toBe(SCHEDULED);
  });

  it('maps WNBA pre/in/post', () => {
    expect(mapGameStatus('pre', 'wnba')).toBe(SCHEDULED);
    expect(mapGameStatus('in', 'wnba')).toBe(LIVE);
    expect(mapGameStatus('post', 'wnba')).toBe(FINAL);
  });

  it('defaults to NBA when no sport is passed (every pre-NFL call site)', () => {
    expect(mapGameStatus('Final')).toBe(FINAL);
    expect(mapGameStatus('Q3 4:00')).toBe(LIVE);
    expect(mapGameStatus('')).toBe(SCHEDULED);
  });
});

describe('mapGameStatus — NFL', () => {
  // The regression this suite exists for. BDL reports OT finals as "Final/OT"
  // (18 of 298 games in 2025). An `=== "Final"` check misses them, and the
  // string then matches the live-quarter /OT/ pattern — so the game reads LIVE
  // forever and never finalizes.
  it('treats "Final/OT" as FINAL, not live', () => {
    expect(mapGameStatus('Final/OT', 'nfl', KICKOFF_EARLIER, NOW)).toBe(FINAL);
    expect(mapGameStatus('Final', 'nfl', KICKOFF_EARLIER, NOW)).toBe(FINAL);
    // Double-OT is possible in the postseason.
    expect(mapGameStatus('Final/2OT', 'nfl', KICKOFF_EARLIER, NOW)).toBe(FINAL);
  });

  it('never lets an OT final leak into basketball as live either', () => {
    expect(mapGameStatus('Final/OT', 'nba')).toBe(FINAL);
    expect(mapGameStatus('Final/OT', 'wnba')).toBe(FINAL);
  });

  it('reads the pre-game kickoff slate as SCHEDULED', () => {
    expect(mapGameStatus('9/13 - 1:00 PM EDT', 'nfl', KICKOFF_EARLIER, NOW)).toBe(SCHEDULED);
    expect(mapGameStatus('9/9 - 8:20 PM EDT', 'nfl', KICKOFF_LATER, NOW)).toBe(SCHEDULED);
  });

  it('is SCHEDULED before kickoff whatever the status string says', () => {
    // Ground truth beats vocabulary: the game cannot be live before it starts.
    expect(mapGameStatus('some unknown string', 'nfl', KICKOFF_LATER, NOW)).toBe(SCHEDULED);
  });

  it('treats an UNRECOGNIZED post-kickoff status as LIVE, not scheduled', () => {
    // BDL's live NFL strings are unobservable until a real slate. Defaulting to
    // LIVE means a vocabulary we guessed wrong still scores; defaulting to
    // SCHEDULED would silently drop an entire Sunday of scoring.
    for (const s of ['9:12 - 2nd', 'Halftime', 'End of 1st', 'in progress', '???']) {
      expect(mapGameStatus(s, 'nfl', KICKOFF_EARLIER, NOW)).toBe(LIVE);
    }
  });

  it('falls back to the status string when no kickoff is supplied', () => {
    expect(mapGameStatus('9/13 - 1:00 PM EDT', 'nfl')).toBe(SCHEDULED);
    expect(mapGameStatus('Final/OT', 'nfl')).toBe(FINAL);
    expect(mapGameStatus('', 'nfl')).toBe(SCHEDULED);
  });
});
