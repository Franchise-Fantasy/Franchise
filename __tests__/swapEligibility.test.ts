import {
  holdsPickInRound,
  projectPickHoldings,
  swapPartiesWithoutPick,
  type HeldPick,
  type PickTransfer,
} from '@/utils/league/swapEligibility';

const A = 'team-a';
const B = 'team-b';
const C = 'team-c';
const SEASON = '2028-29';

const pick = (team: string | null, round = 1, season = SEASON): HeldPick => ({
  season,
  round,
  current_team_id: team,
});

const transfer = (from: string, to: string, round = 1, season = SEASON): PickTransfer => ({
  season,
  round,
  from_team_id: from,
  to_team_id: to,
});

describe('projectPickHoldings', () => {
  it('counts picks a team currently holds', () => {
    const holdings = projectPickHoldings([pick(A), pick(B, 2)], []);
    expect(holdsPickInRound(holdings, A, SEASON, 1)).toBe(true);
    expect(holdsPickInRound(holdings, A, SEASON, 2)).toBe(false);
    expect(holdsPickInRound(holdings, B, SEASON, 2)).toBe(true);
  });

  it('is season- and round-specific', () => {
    const holdings = projectPickHoldings([pick(A, 1, '2027-28')], []);
    expect(holdsPickInRound(holdings, A, '2027-28', 1)).toBe(true);
    expect(holdsPickInRound(holdings, A, SEASON, 1)).toBe(false);
  });

  it('ignores unowned picks', () => {
    const holdings = projectPickHoldings([pick(null)], []);
    expect(holdsPickInRound(holdings, A, SEASON, 1)).toBe(false);
  });

  it('empties a team that ships its only pick in the round', () => {
    const holdings = projectPickHoldings([pick(A), pick(B)], [transfer(A, B)]);
    expect(holdsPickInRound(holdings, A, SEASON, 1)).toBe(false);
    expect(holdsPickInRound(holdings, B, SEASON, 1)).toBe(true);
  });

  it('leaves a team holding a pick when it ships one of two', () => {
    const holdings = projectPickHoldings([pick(A), pick(A)], [transfer(A, B)]);
    expect(holdsPickInRound(holdings, A, SEASON, 1)).toBe(true);
  });

  it('credits a pick acquired inside the same trade', () => {
    const holdings = projectPickHoldings([pick(B)], [transfer(B, A)]);
    expect(holdsPickInRound(holdings, A, SEASON, 1)).toBe(true);
    expect(holdsPickInRound(holdings, B, SEASON, 1)).toBe(false);
  });
});

describe('swapPartiesWithoutPick', () => {
  const swap = { season: SEASON, round: 1, beneficiary_team_id: A, counterparty_team_id: B };

  it('returns nothing when both sides hold a pick', () => {
    const holdings = projectPickHoldings([pick(A), pick(B)], []);
    expect(swapPartiesWithoutPick(holdings, swap)).toEqual([]);
  });

  it('names the counterparty when only they are empty', () => {
    const holdings = projectPickHoldings([pick(A)], []);
    expect(swapPartiesWithoutPick(holdings, swap)).toEqual([B]);
  });

  it('names the beneficiary when only they are empty', () => {
    const holdings = projectPickHoldings([pick(B)], []);
    expect(swapPartiesWithoutPick(holdings, swap)).toEqual([A]);
  });

  it('names both, beneficiary first, when neither holds a pick', () => {
    const holdings = projectPickHoldings([pick(C)], []);
    expect(swapPartiesWithoutPick(holdings, swap)).toEqual([A, B]);
  });

  it('flags a swap gutted by a pick move in the same trade', () => {
    const holdings = projectPickHoldings([pick(A), pick(B)], [transfer(B, C)]);
    expect(swapPartiesWithoutPick(holdings, swap)).toEqual([B]);
  });
});
