import { optimizeLineup, LineupPlayer, SlotAssignment } from '@/utils/roster/autoLineup';

function makePlayer(overrides: Partial<LineupPlayer> = {}): LineupPlayer {
  return {
    player_id: 'p1',
    position: 'PG',
    status: 'active',
    roster_slot: 'BE',
    avgFpts: 20,
    locked: false,
    hasGame: true,
    ...overrides,
  };
}

// Simple config: 1 PG, 1 SG, 1 UTIL, 2 BE, 1 IR
const SIMPLE_CONFIG = [
  { position: 'PG', slot_count: 1 },
  { position: 'SG', slot_count: 1 },
  { position: 'UTIL', slot_count: 1 },
  { position: 'BE', slot_count: 2 },
  { position: 'IR', slot_count: 1 },
];

function getSlot(result: SlotAssignment[], playerId: string): string {
  return result.find(r => r.player_id === playerId)!.slot;
}

// ─── optimizeLineup ─────────────────────────────────────────────────────────

describe('optimizeLineup', () => {
  it('assigns every player exactly one slot', () => {
    const players = [
      makePlayer({ player_id: 'p1', position: 'PG', avgFpts: 30 }),
      makePlayer({ player_id: 'p2', position: 'SG', avgFpts: 25 }),
      makePlayer({ player_id: 'p3', position: 'SF', avgFpts: 20 }),
      makePlayer({ player_id: 'p4', position: 'PG', avgFpts: 15 }),
      makePlayer({ player_id: 'p5', position: 'SG', avgFpts: 10 }),
    ];
    const result = optimizeLineup(players, SIMPLE_CONFIG);
    expect(result).toHaveLength(5);
    const ids = result.map(r => r.player_id).sort();
    expect(ids).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });

  it('IR players stay on IR', () => {
    const players = [
      makePlayer({ player_id: 'p1', position: 'PG', roster_slot: 'IR', status: 'OUT', avgFpts: 50 }),
      makePlayer({ player_id: 'p2', position: 'PG', avgFpts: 20 }),
      makePlayer({ player_id: 'p3', position: 'SG', avgFpts: 15 }),
    ];
    const result = optimizeLineup(players, SIMPLE_CONFIG);
    expect(getSlot(result, 'p1')).toBe('IR');
  });

  it('locked starters stay in their current seat', () => {
    const players = [
      makePlayer({ player_id: 'p1', position: 'PG', roster_slot: 'PG', locked: true, avgFpts: 5 }),
      makePlayer({ player_id: 'p2', position: 'PG', avgFpts: 50 }),
      makePlayer({ player_id: 'p3', position: 'SG', avgFpts: 25 }),
    ];
    const result = optimizeLineup(players, SIMPLE_CONFIG);
    // p1 is locked in PG even though p2 has higher FPTS
    expect(getSlot(result, 'p1')).toBe('PG');
  });

  it('highest FPTS players fill starter slots', () => {
    const players = [
      makePlayer({ player_id: 'p1', position: 'PG', avgFpts: 30 }),
      makePlayer({ player_id: 'p2', position: 'SG', avgFpts: 25 }),
      makePlayer({ player_id: 'p3', position: 'PG', avgFpts: 10 }),
      makePlayer({ player_id: 'p4', position: 'SG', avgFpts: 5 }),
    ];
    const result = optimizeLineup(players, SIMPLE_CONFIG);
    // p1 (PG, 30) should start at PG, p2 (SG, 25) at SG
    expect(getSlot(result, 'p1')).toBe('PG');
    expect(getSlot(result, 'p2')).toBe('SG');
    // p3 might get UTIL since it's the next best with a game
    const p3Slot = getSlot(result, 'p3');
    expect(p3Slot === 'UTIL1' || p3Slot === 'BE').toBe(true);
  });

  it('OUT/SUSP players get 0 FPTS priority, prefer bench', () => {
    const players = [
      makePlayer({ player_id: 'p1', position: 'PG', status: 'OUT', avgFpts: 50 }),
      makePlayer({ player_id: 'p2', position: 'PG', avgFpts: 10 }),
      makePlayer({ player_id: 'p3', position: 'SG', avgFpts: 15 }),
    ];
    const result = optimizeLineup(players, SIMPLE_CONFIG);
    // p2 should start at PG despite lower avg, because p1 is OUT (0 day FPTS)
    expect(getSlot(result, 'p2')).toBe('PG');
  });

  it('players without a game today get 0 FPTS priority', () => {
    const players = [
      makePlayer({ player_id: 'p1', position: 'PG', hasGame: false, avgFpts: 50 }),
      makePlayer({ player_id: 'p2', position: 'PG', hasGame: true, avgFpts: 10 }),
      makePlayer({ player_id: 'p3', position: 'SG', hasGame: true, avgFpts: 15 }),
    ];
    const result = optimizeLineup(players, SIMPLE_CONFIG);
    // p2 should start because p1 has no game today
    expect(getSlot(result, 'p2')).toBe('PG');
  });

  it('swap improvement: promotes better bench player to starter', () => {
    // Scenario: greedy might suboptimally place a flexible player,
    // the swap pass should fix it
    const config = [
      { position: 'PG', slot_count: 1 },
      { position: 'C', slot_count: 1 },
      { position: 'BE', slot_count: 2 },
    ];
    const players = [
      makePlayer({ player_id: 'p1', position: 'PG', avgFpts: 10 }),
      makePlayer({ player_id: 'p2', position: 'C', avgFpts: 30 }),
      makePlayer({ player_id: 'p3', position: 'PG', avgFpts: 25 }),
      makePlayer({ player_id: 'p4', position: 'C', avgFpts: 5 }),
    ];
    const result = optimizeLineup(players, config);
    // p3 (PG, 25) should end up starting at PG and p2 (C, 30) at C
    expect(getSlot(result, 'p3')).toBe('PG');
    expect(getSlot(result, 'p2')).toBe('C');
  });

  it('handles empty roster', () => {
    const result = optimizeLineup([], SIMPLE_CONFIG);
    expect(result).toEqual([]);
  });

  it('respects position eligibility', () => {
    const config = [
      { position: 'C', slot_count: 1 },
      { position: 'BE', slot_count: 1 },
    ];
    const players = [
      makePlayer({ player_id: 'p1', position: 'PG', avgFpts: 50 }),
      makePlayer({ player_id: 'p2', position: 'C', avgFpts: 10 }),
    ];
    const result = optimizeLineup(players, config);
    // PG can't play C slot, so C player starts despite lower FPTS
    expect(getSlot(result, 'p2')).toBe('C');
    expect(getSlot(result, 'p1')).toBe('BE');
  });
});
