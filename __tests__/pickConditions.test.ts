import { DraftHubPick, DraftHubSwap } from '@/hooks/useDraftHub';
import { resolveProtections, resolveSwaps } from '@/utils/pickConditions';

function makePick(overrides: Partial<DraftHubPick> = {}): DraftHubPick {
  return {
    id: 'pick1',
    season: '2025-26',
    round: 1,
    slot_number: null,
    display_slot: 1,
    current_team_id: 'teamA',
    original_team_id: 'teamA',
    current_team_name: 'Team A',
    original_team_name: 'Team A',
    isTraded: false,
    protection_threshold: null,
    protection_owner_id: null,
    protection_owner_name: null,
    ...overrides,
  };
}

const nameMap: Record<string, string> = {
  teamA: 'Team A',
  teamB: 'Team B',
  teamC: 'Team C',
};

// ─── resolveProtections ─────────────────────────────────────────────────────

describe('resolveProtections', () => {
  it('pick with no protection is unchanged', () => {
    const picks = [makePick()];
    const result = resolveProtections(picks, { teamA: 3 }, nameMap);
    expect(result[0].current_team_id).toBe('teamA');
    expect(result[0].wasProtected).toBeUndefined();
    expect(result[0].wasConveyed).toBeUndefined();
  });

  it('protected pick reverts ownership when slot is within threshold', () => {
    const picks = [makePick({
      current_team_id: 'teamB',
      current_team_name: 'Team B',
      original_team_id: 'teamA',
      isTraded: true,
      protection_threshold: 5,
      protection_owner_id: 'teamA',
    })];
    // teamA's simulated slot is 3, which is <= 5 (threshold) → protected
    const result = resolveProtections(picks, { teamA: 3 }, nameMap);
    expect(result[0].current_team_id).toBe('teamA');
    expect(result[0].current_team_name).toBe('Team A');
    expect(result[0].wasProtected).toBe(true);
  });

  it('pick conveys when slot exceeds threshold', () => {
    const picks = [makePick({
      current_team_id: 'teamB',
      original_team_id: 'teamA',
      isTraded: true,
      protection_threshold: 5,
      protection_owner_id: 'teamA',
    })];
    // teamA's simulated slot is 8, which is > 5 → conveys
    const result = resolveProtections(picks, { teamA: 8 }, nameMap);
    expect(result[0].current_team_id).toBe('teamB');
    expect(result[0].wasConveyed).toBe(true);
    expect(result[0].wasProtected).toBeUndefined();
  });

  it('pick at exact threshold is protected', () => {
    const picks = [makePick({
      current_team_id: 'teamB',
      original_team_id: 'teamA',
      isTraded: true,
      protection_threshold: 5,
      protection_owner_id: 'teamA',
    })];
    const result = resolveProtections(picks, { teamA: 5 }, nameMap);
    expect(result[0].wasProtected).toBe(true);
  });

  it('does not modify original array', () => {
    const picks = [makePick({ protection_threshold: 5, protection_owner_id: 'teamA' })];
    resolveProtections(picks, { teamA: 3 }, nameMap);
    expect(picks[0].wasProtected).toBeUndefined();
  });
});

// ─── resolveSwaps ───────────────────────────────────────────────────────────

describe('resolveSwaps', () => {
  it('swaps when counterparty has better pick', () => {
    const picks = [
      makePick({ id: 'p1', round: 1, current_team_id: 'teamA', original_team_id: 'teamA' }),
      makePick({ id: 'p2', round: 1, current_team_id: 'teamB', original_team_id: 'teamB' }),
    ];
    const swaps: DraftHubSwap[] = [{
      id: 's1', season: '2025-26', round: 1,
      beneficiary_team_id: 'teamA', counterparty_team_id: 'teamB',
      beneficiary_team_name: 'Team A', counterparty_team_name: 'Team B',
    }];
    // teamB slot 2 is better than teamA slot 5
    const result = resolveSwaps(picks, swaps, '2025-26', { teamA: 5, teamB: 2 }, nameMap);
    // teamA should now own teamB's pick and vice versa
    expect(result[0].current_team_id).toBe('teamB');
    expect(result[1].current_team_id).toBe('teamA');
    expect(result[0].wasSwapped).toBe(true);
    expect(result[1].wasSwapped).toBe(true);
  });

  it('no swap when beneficiary already has the better pick', () => {
    const picks = [
      makePick({ id: 'p1', round: 1, current_team_id: 'teamA', original_team_id: 'teamA' }),
      makePick({ id: 'p2', round: 1, current_team_id: 'teamB', original_team_id: 'teamB' }),
    ];
    const swaps: DraftHubSwap[] = [{
      id: 's1', season: '2025-26', round: 1,
      beneficiary_team_id: 'teamA', counterparty_team_id: 'teamB',
      beneficiary_team_name: 'Team A', counterparty_team_name: 'Team B',
    }];
    // teamA slot 2 is already better than teamB slot 5
    const result = resolveSwaps(picks, swaps, '2025-26', { teamA: 2, teamB: 5 }, nameMap);
    expect(result[0].current_team_id).toBe('teamA');
    expect(result[1].current_team_id).toBe('teamB');
    expect(result[0].wasSwapped).toBeUndefined();
  });

  it('ignores swaps from a different season', () => {
    const picks = [
      makePick({ round: 1, current_team_id: 'teamA', original_team_id: 'teamA' }),
      makePick({ id: 'p2', round: 1, current_team_id: 'teamB', original_team_id: 'teamB' }),
    ];
    const swaps: DraftHubSwap[] = [{
      id: 's1', season: '2026-27', round: 1,
      beneficiary_team_id: 'teamA', counterparty_team_id: 'teamB',
      beneficiary_team_name: 'Team A', counterparty_team_name: 'Team B',
    }];
    const result = resolveSwaps(picks, swaps, '2025-26', { teamA: 5, teamB: 2 }, nameMap);
    expect(result[0].current_team_id).toBe('teamA'); // no swap
  });

  it('does not modify original array', () => {
    const picks = [
      makePick({ round: 1, current_team_id: 'teamA', original_team_id: 'teamA' }),
      makePick({ id: 'p2', round: 1, current_team_id: 'teamB', original_team_id: 'teamB' }),
    ];
    const swaps: DraftHubSwap[] = [{
      id: 's1', season: '2025-26', round: 1,
      beneficiary_team_id: 'teamA', counterparty_team_id: 'teamB',
      beneficiary_team_name: 'Team A', counterparty_team_name: 'Team B',
    }];
    resolveSwaps(picks, swaps, '2025-26', { teamA: 5, teamB: 2 }, nameMap);
    expect(picks[0].current_team_id).toBe('teamA'); // original unchanged
  });
});
