// Regression tests for finalize-week's playoff result notification copy
// (supabase/functions/_shared/finalizeWeek/playoffCopy.ts).
//
// The bug these pin (2026-07): the 3rd place game is created ALONGSIDE the
// final and carries the SAME `playoff_round`, so the old `round >= totalRounds`
// check classified it as the championship. Both teams in the 3rd place game got
// a "🏆 … — Championship" title, and the winner was told they "won the
// championship!" while the actual final was still being played.

import {
  playoffResultBody,
  playoffRoundIcon,
  playoffRoundLabel,
  type PlayoffMatchupContext,
} from '../supabase/functions/_shared/finalizeWeek/playoffCopy';

/** 8-team bracket: quarters (1) → semis (2) → final + 3rd place (3). */
const TOTAL_ROUNDS = 3;

function ctx(over: Partial<PlayoffMatchupContext> = {}): PlayoffMatchupContext {
  return { round: TOTAL_ROUNDS, totalRounds: TOTAL_ROUNDS, isThirdPlace: false, ...over };
}

const beat = { won: true, tied: false, opponentName: 'Rivals', scoreLine: '120 - 100' };
const lost = { won: false, tied: false, opponentName: 'Rivals', scoreLine: '120 - 100' };
const drew = { won: false, tied: true, opponentName: 'Rivals', scoreLine: '100 - 100' };

describe('playoffRoundLabel', () => {
  it('labels the 3rd place game even though it shares the final round', () => {
    expect(playoffRoundLabel(ctx({ isThirdPlace: true }))).toBe('3rd Place Game');
  });

  it('labels the final round as the Championship', () => {
    expect(playoffRoundLabel(ctx())).toBe('Championship');
  });

  it('labels earlier rounds by depth', () => {
    expect(playoffRoundLabel(ctx({ round: 2 }))).toBe('Semifinals');
    expect(playoffRoundLabel(ctx({ round: 1 }))).toBe('Quarterfinals');
    expect(playoffRoundLabel({ round: 1, totalRounds: 4, isThirdPlace: false })).toBe('Playoff Round 1');
  });
});

describe('playoffRoundIcon', () => {
  it('gives the 3rd place game a bronze medal, not a trophy', () => {
    expect(playoffRoundIcon(ctx({ isThirdPlace: true }))).toBe('🥉');
  });

  it('reserves the trophy for the championship', () => {
    expect(playoffRoundIcon(ctx())).toBe('🏆');
    expect(playoffRoundIcon(ctx({ round: 2 }))).toBe('🏀');
  });
});

describe('playoffResultBody — 3rd place game', () => {
  const thirdPlace = ctx({ isThirdPlace: true });

  it('never claims the championship for the winner', () => {
    const body = playoffResultBody(thirdPlace, beat);
    expect(body).not.toMatch(/champion/i);
    expect(body).toBe('You beat Rivals 120 - 100 and took 3rd place! 🥉');
  });

  it('does not tell the loser they lost the finals', () => {
    const body = playoffResultBody(thirdPlace, lost);
    expect(body).not.toMatch(/final/i);
    expect(body).toBe('Rivals wins 120 - 100. You finish 4th.');
  });

  it('shares the neutral tie copy', () => {
    expect(playoffResultBody(thirdPlace, drew)).toBe('Tied 100 - 100 vs Rivals. What a battle.');
  });
});

describe('playoffResultBody — championship', () => {
  it('crowns the winner', () => {
    expect(playoffResultBody(ctx(), beat)).toBe('You beat Rivals 120 - 100 and won the championship! 🏆');
  });

  it('commiserates with the runner-up', () => {
    expect(playoffResultBody(ctx(), lost)).toBe('Rivals wins 120 - 100. Tough loss in the finals.');
  });
});

describe('playoffResultBody — semifinals', () => {
  const semis = ctx({ round: TOTAL_ROUNDS - 1 });

  it('sends the winner to the championship', () => {
    expect(playoffResultBody(semis, beat)).toBe('You beat Rivals 120 - 100. On to the championship!');
  });

  it('sends the loser to the 3rd place game when one follows', () => {
    const body = playoffResultBody({ ...semis, thirdPlaceGameFollows: true }, lost);
    expect(body).toBe('Rivals wins 120 - 100. On to the 3rd place game.');
  });

  it('ends the season when no 3rd place game follows', () => {
    expect(playoffResultBody(semis, lost)).toBe('Rivals wins 120 - 100. Season over.');
  });
});

describe('playoffResultBody — earlier rounds', () => {
  const quarters = ctx({ round: 1 });

  it('advances the winner without naming the championship', () => {
    expect(playoffResultBody(quarters, beat)).toBe('You beat Rivals 120 - 100. You advance!');
  });

  it('ends the loser season, and a 3rd place game never applies', () => {
    expect(playoffResultBody({ ...quarters, thirdPlaceGameFollows: true }, lost))
      .toBe('Rivals wins 120 - 100. Season over.');
  });
});
