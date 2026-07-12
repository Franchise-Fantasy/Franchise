// Canonical display order for roster slots, chosen by the config's shape.
// NBA leagues list the five specific spots first (PG→C), then the G/F flex
// slots, then UTIL: PG, SG, SF, PF, C, G, F, UTIL. WNBA leagues have no
// PG/SG/SF/PF — there G/F are the primary guard/forward slots and lead C:
// G, F, C, UTIL. NFL leagues use an entirely disjoint slot vocabulary:
// QB, RB, WR, TE, FLEX, SFLX, K, DST. The map is picked by which
// sport-specific slots the config carries (NFL slots are unambiguous tokens,
// so they're sniffed first), so the sport never has to be threaded in.
//
// Pure + dependency-free so it can be unit-tested without pulling react-query /
// supabase into the test's import graph (see rosterConfigOrder.test.ts).

const SLOT_ORDER_NBA: Record<string, number> = {
  PG: 0, SG: 1, SF: 2, PF: 3, C: 4, G: 5, F: 6, UTIL: 7, BE: 8, IR: 9,
};
const SLOT_ORDER_WNBA: Record<string, number> = {
  G: 0, F: 1, C: 2, UTIL: 3, BE: 4, IR: 5,
};
const SLOT_ORDER_NFL: Record<string, number> = {
  QB: 0, RB: 1, WR: 2, TE: 3, FLEX: 4, SFLX: 5, K: 6, DST: 7, BE: 8, IR: 9,
};
const NBA_SPECIFIC_SLOTS = ['PG', 'SG', 'SF', 'PF'];
const NFL_SPECIFIC_SLOTS = ['QB', 'RB', 'WR', 'TE', 'FLEX', 'SFLX', 'K', 'DST'];

/** Returns a new array of the slots sorted into the sport-correct display order.
 *  Does not mutate the input. Unknown slots (e.g. TAXI) sort to the end. */
export function sortSlotsBySport<T extends { position: string }>(rows: T[]): T[] {
  const order = rows.some((s) => NFL_SPECIFIC_SLOTS.includes(s.position))
    ? SLOT_ORDER_NFL
    : rows.some((s) => NBA_SPECIFIC_SLOTS.includes(s.position))
      ? SLOT_ORDER_NBA
      : SLOT_ORDER_WNBA;
  return [...rows].sort(
    (a, b) => (order[a.position] ?? 99) - (order[b.position] ?? 99),
  );
}
