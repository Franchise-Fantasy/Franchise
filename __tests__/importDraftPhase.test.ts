import {
  computeImportSeasons,
  draftYearLabel,
  isCompleteTradedPick,
  isDuplicateTradedPick,
  isFullOrder,
  resolveDraftOrder,
  validateLotteryOrder,
  type TradedPickDraft,
} from '@/components/import/draftPhase';

import {
  applyTradedPicks,
  buildFutureSeasons,
  buildSeasonPicks,
  formatSeason,
  nextSeason,
  planDraftPhaseSeeding,
  type ResolvedTradedPick,
} from '../supabase/functions/_shared/importDraftPhase';

// ─── Edge: season formatting ────────────────────────────────────────────────

describe('formatSeason / nextSeason', () => {
  it('formats NBA seasons as two-year spans', () => {
    expect(formatSeason(2027, 'nba')).toBe('2027-28');
    expect(formatSeason(2099, 'nba')).toBe('2099-00');
  });

  it('formats WNBA seasons as a single year', () => {
    expect(formatSeason(2027, 'wnba')).toBe('2027');
  });

  it('advances to the next season per sport', () => {
    expect(nextSeason('2026-27', 'nba')).toBe('2027-28');
    expect(nextSeason('2026', 'wnba')).toBe('2027');
  });
});

describe('buildFutureSeasons', () => {
  it('returns offset +1..+N NBA seasons', () => {
    expect(buildFutureSeasons('2026-27', 3, 'nba')).toEqual(['2027-28', '2028-29', '2029-30']);
  });

  it('returns WNBA single-year seasons', () => {
    expect(buildFutureSeasons('2026', 2, 'wnba')).toEqual(['2027', '2028']);
  });

  it('returns empty for a count of zero', () => {
    expect(buildFutureSeasons('2026-27', 0, 'nba')).toEqual([]);
  });
});

// ─── Edge: pick seeding ─────────────────────────────────────────────────────

describe('buildSeasonPicks', () => {
  const teamIds = ['A', 'B', 'C'];

  it('unordered: one pick per team per round, slot = team index, no pick_number', () => {
    const rows = buildSeasonPicks({ leagueId: 'L', teamIds, rounds: 2, season: '2027-28' });
    expect(rows).toHaveLength(6);
    const r1 = rows.filter(r => r.round === 1);
    expect(r1.map(r => r.slot_number)).toEqual([1, 2, 3]);
    expect(r1.every(r => r.pick_number === null)).toBe(true);
    expect(r1.every(r => r.current_team_id === r.original_team_id)).toBe(true);
  });

  it('ordered: slot/pick numbers follow the draft order, not team index', () => {
    const order = ['C', 'A', 'B']; // C drafts first
    const rows = buildSeasonPicks({ leagueId: 'L', teamIds, rounds: 2, season: '2027-28', order });
    const byTeam = (id: string, round: number) => rows.find(r => r.original_team_id === id && r.round === round)!;
    expect(byTeam('C', 1).slot_number).toBe(1);
    expect(byTeam('C', 1).pick_number).toBe(1);
    expect(byTeam('A', 1).slot_number).toBe(2);
    expect(byTeam('B', 1).slot_number).toBe(3);
    // Round 2 is linear (rookie drafts are linear): pick_number continues per slot.
    expect(byTeam('C', 2).pick_number).toBe(4); // (2-1)*3 + 1
    expect(byTeam('B', 2).pick_number).toBe(6);
  });

  it('laterRoundOrder: round 1 follows the lottery order, round 2+ reverts to reverse standings', () => {
    const order = ['C', 'A', 'B']; // round 1 (post-lottery): C drafts first
    const laterRoundOrder = ['A', 'B', 'C']; // round 2 (reverse standings): A worst
    const rows = buildSeasonPicks({ leagueId: 'L', teamIds, rounds: 2, season: '2027-28', order, laterRoundOrder });
    const byTeam = (id: string, round: number) => rows.find(r => r.original_team_id === id && r.round === round)!;
    // Round 1 follows the lottery order.
    expect(byTeam('C', 1).slot_number).toBe(1);
    expect(byTeam('A', 1).slot_number).toBe(2);
    // Round 2 reverts to reverse standings — the lottery jump does NOT carry.
    expect(byTeam('A', 2).slot_number).toBe(1);
    expect(byTeam('A', 2).pick_number).toBe(4); // (2-1)*3 + 1
    expect(byTeam('C', 2).slot_number).toBe(3);
    expect(byTeam('C', 2).pick_number).toBe(6);
  });
});

describe('applyTradedPicks', () => {
  it('rewrites current_team_id on the matching (season, round, original) pick only', () => {
    const rows = buildSeasonPicks({ leagueId: 'L', teamIds: ['A', 'B', 'C'], rounds: 2, season: '2027-28' });
    const traded: ResolvedTradedPick[] = [
      { season: '2027-28', round: 1, originalTeamId: 'A', newOwnerTeamId: 'B' },
    ];
    applyTradedPicks(rows, traded);
    const moved = rows.find(r => r.round === 1 && r.original_team_id === 'A')!;
    expect(moved.current_team_id).toBe('B');
    // A's round-2 pick is untouched.
    expect(rows.find(r => r.round === 2 && r.original_team_id === 'A')!.current_team_id).toBe('A');
  });

  it('no-ops when nothing matches', () => {
    const rows = buildSeasonPicks({ leagueId: 'L', teamIds: ['A', 'B'], rounds: 1, season: '2027-28' });
    applyTradedPicks(rows, [{ season: '2099-00', round: 9, originalTeamId: 'A', newOwnerTeamId: 'B' }]);
    expect(rows.every(r => r.current_team_id === r.original_team_id)).toBe(true);
  });
});

// ─── Edge: phase planner ────────────────────────────────────────────────────

describe('planDraftPhaseSeeding', () => {
  const base = {
    leagueId: 'L',
    teamIds: ['A', 'B', 'C'],
    rounds: 2,
    currentSeason: '2026-27',
    sport: 'nba' as const,
    maxFutureSeasons: 2,
    resolvedTraded: [] as ResolvedTradedPick[],
  };

  it('in_season: only future picks (+1..+N), no S0, no offseason flip', () => {
    const { pickRows, offseasonUpdate } = planDraftPhaseSeeding({
      ...base, draftPhase: 'in_season', usesLottery: true,
    });
    expect(offseasonUpdate).toBeNull();
    const seasons = new Set(pickRows.map(r => r.season));
    expect(seasons.has('2026-27')).toBe(false); // S0 not seeded
    expect(seasons.has('2027-28')).toBe(true);
    expect(seasons.has('2028-29')).toBe(true);
    expect(pickRows).toHaveLength(2 /*future seasons*/ * 2 /*rounds*/ * 3 /*teams*/);
  });

  it('pre_lottery + lottery: seeds unordered S0 and flips to lottery_pending', () => {
    const { pickRows, offseasonUpdate } = planDraftPhaseSeeding({
      ...base, draftPhase: 'pre_lottery', usesLottery: true,
    });
    expect(offseasonUpdate).toEqual({ offseason_step: 'lottery_pending', lottery_status: 'pending' });
    const s0 = pickRows.filter(r => r.season === '2026-27');
    expect(s0).toHaveLength(6);
    expect(s0.every(r => r.pick_number === null)).toBe(true); // unordered — start-lottery numbers later
  });

  it('pre_lottery + reverse_record with order: numbers S0 and flips to rookie_draft_pending/pending', () => {
    const { pickRows, offseasonUpdate } = planDraftPhaseSeeding({
      ...base, draftPhase: 'pre_lottery', usesLottery: false, order: ['C', 'A', 'B'],
    });
    expect(offseasonUpdate).toEqual({ offseason_step: 'rookie_draft_pending', lottery_status: 'pending' });
    const cR1 = pickRows.find(r => r.season === '2026-27' && r.round === 1 && r.original_team_id === 'C')!;
    expect(cR1.slot_number).toBe(1);
    expect(cR1.pick_number).toBe(1);
  });

  it('lottery_done: numbers S0 from order and flips to rookie_draft_pending/complete', () => {
    const { offseasonUpdate } = planDraftPhaseSeeding({
      ...base, draftPhase: 'lottery_done', usesLottery: true, order: ['B', 'C', 'A'],
    });
    expect(offseasonUpdate).toEqual({ offseason_step: 'rookie_draft_pending', lottery_status: 'complete' });
  });

  it('lottery_done: S0 round 2 reverts to laterRoundOrder, not the lottery order', () => {
    const { pickRows } = planDraftPhaseSeeding({
      ...base,
      draftPhase: 'lottery_done',
      usesLottery: true,
      order: ['B', 'C', 'A'], // round 1 post-lottery
      laterRoundOrder: ['A', 'B', 'C'], // round 2 reverse standings
    });
    const s0 = (id: string, round: number) =>
      pickRows.find(r => r.season === '2026-27' && r.round === round && r.original_team_id === id)!;
    expect(s0('B', 1).slot_number).toBe(1); // lottery winner picks first in R1
    expect(s0('A', 2).slot_number).toBe(1); // reverse standings in R2
    expect(s0('C', 2).slot_number).toBe(3);
  });

  it('applies traded picks across seeded seasons', () => {
    const { pickRows } = planDraftPhaseSeeding({
      ...base,
      draftPhase: 'pre_lottery',
      usesLottery: true,
      resolvedTraded: [{ season: '2027-28', round: 1, originalTeamId: 'A', newOwnerTeamId: 'B' }],
    });
    const moved = pickRows.find(r => r.season === '2027-28' && r.round === 1 && r.original_team_id === 'A')!;
    expect(moved.current_team_id).toBe('B');
  });
});

// ─── Client: helpers ────────────────────────────────────────────────────────

describe('computeImportSeasons', () => {
  it('includes the current season when the draft is pending', () => {
    expect(computeImportSeasons('2026-27', 'nba', 2, true)).toEqual(['2026-27', '2027-28', '2028-29']);
  });

  it('omits the current season when already drafted', () => {
    expect(computeImportSeasons('2026-27', 'nba', 2, false)).toEqual(['2027-28', '2028-29']);
  });

  it('handles WNBA single-year format', () => {
    expect(computeImportSeasons('2026', 'wnba', 1, true)).toEqual(['2026', '2027']);
  });
});

describe('draftYearLabel', () => {
  it('shows the starting calendar year for an NBA span', () => {
    expect(draftYearLabel('2026-27')).toBe('2026');
  });
  it('passes through a single-year WNBA season', () => {
    expect(draftYearLabel('2026')).toBe('2026');
  });
});

describe('isFullOrder', () => {
  const teamKeys = ['A', 'B', 'C'];
  it('true only for a complete permutation of the team keys', () => {
    expect(isFullOrder(['C', 'A', 'B'], teamKeys)).toBe(true);
    expect(isFullOrder(['A', 'B'], teamKeys)).toBe(false); // short
    expect(isFullOrder(['A', 'B', 'B'], teamKeys)).toBe(false); // dup
    expect(isFullOrder(['A', 'B', 'X'], teamKeys)).toBe(false); // unknown key
    expect(isFullOrder(undefined, teamKeys)).toBe(false);
  });
});

describe('resolveDraftOrder', () => {
  const teamKeys = ['A', 'B', 'C'];
  it('returns the first candidate that fully covers the teams', () => {
    expect(resolveDraftOrder([['C', 'A', 'B']], teamKeys)).toEqual(['C', 'A', 'B']);
  });
  it('skips invalid candidates and falls through', () => {
    // explicit empty → reverse-standings default → round-1
    expect(resolveDraftOrder([[], ['B', 'C', 'A'], ['A', 'B', 'C']], teamKeys)).toEqual(['B', 'C', 'A']);
  });
  it('falls back to natural team order when no candidate is valid', () => {
    expect(resolveDraftOrder([[], undefined, ['A', 'B']], teamKeys)).toEqual(teamKeys);
  });
});

describe('validateLotteryOrder', () => {
  it('passes for a complete unique permutation', () => {
    expect(validateLotteryOrder(['a', 'b', 'c'], 3)).toBe(true);
  });
  it('fails on wrong length', () => {
    expect(validateLotteryOrder(['a', 'b'], 3)).toBe(false);
  });
  it('fails on duplicates', () => {
    expect(validateLotteryOrder(['a', 'a', 'b'], 3)).toBe(false);
  });
});

describe('traded-pick draft validity', () => {
  const base: TradedPickDraft = { season: '2026-27', round: 1, fromKey: 'A', toKey: 'B' };

  it('isCompleteTradedPick requires all fields and from !== to', () => {
    expect(isCompleteTradedPick(base)).toBe(true);
    expect(isCompleteTradedPick({ ...base, toKey: 'A' })).toBe(false);
    expect(isCompleteTradedPick({ season: '2026-27', round: 1, fromKey: 'A' })).toBe(false);
  });

  it('isDuplicateTradedPick matches on (season, round, fromKey)', () => {
    expect(isDuplicateTradedPick([base], { ...base, toKey: 'C' })).toBe(true);
    expect(isDuplicateTradedPick([base], { ...base, round: 2 })).toBe(false);
  });
});
