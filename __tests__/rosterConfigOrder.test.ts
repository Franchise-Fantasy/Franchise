import { sortSlotsBySport } from '@/utils/roster/rosterConfigOrder';

const slots = (positions: string[]) =>
  positions.map((position) => ({ position, slot_count: 1 }));
const order = (rows: { position: string }[]) => rows.map((r) => r.position);

describe('sortSlotsBySport', () => {
  it('orders an all-positions NBA config as PG, SG, SF, PF, C, G, F, UTIL', () => {
    // Deliberately shuffled input, including the G/F flex slots interleaved.
    const input = slots(['UTIL', 'C', 'G', 'PF', 'SF', 'F', 'SG', 'PG']);
    expect(order(sortSlotsBySport(input))).toEqual([
      'PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL',
    ]);
  });

  it('keeps G, F, C for a WNBA config (no PG/SG/SF/PF)', () => {
    const input = slots(['C', 'UTIL', 'F', 'G']);
    expect(order(sortSlotsBySport(input))).toEqual(['G', 'F', 'C', 'UTIL']);
  });

  it('places bench and IR after the active slots', () => {
    const input = slots(['IR', 'BE', 'PG', 'C']);
    expect(order(sortSlotsBySport(input))).toEqual(['PG', 'C', 'BE', 'IR']);
  });

  it('sorts unknown slots (e.g. TAXI) to the end', () => {
    const input = slots(['TAXI', 'PG', 'BE']);
    expect(order(sortSlotsBySport(input))).toEqual(['PG', 'BE', 'TAXI']);
  });

  it('does not mutate the input array', () => {
    const input = slots(['C', 'PG']);
    const snapshot = [...input];
    sortSlotsBySport(input);
    expect(input).toEqual(snapshot);
  });
});
