// Canonical display order for roster slots, chosen by the config's shape.
// NBA leagues list the five specific spots first (PG→C), then the G/F flex
// slots, then UTIL: PG, SG, SF, PF, C, G, F, UTIL. WNBA leagues have no
// PG/SG/SF/PF — there G/F are the primary guard/forward slots and lead C:
// G, F, C, UTIL. The map is picked by whether the config carries any
// NBA-specific slot, so a WNBA config (G/F/C only) gets the WNBA order without
// the sport having to be threaded in.
//
// Pure + dependency-free so it can be unit-tested without pulling react-query /
// supabase into the test's import graph (see rosterConfigOrder.test.ts).

const SLOT_ORDER_NBA: Record<string, number> = {
  PG: 0, SG: 1, SF: 2, PF: 3, C: 4, G: 5, F: 6, UTIL: 7, BE: 8, IR: 9,
};
const SLOT_ORDER_WNBA: Record<string, number> = {
  G: 0, F: 1, C: 2, UTIL: 3, BE: 4, IR: 5,
};
const NBA_SPECIFIC_SLOTS = ['PG', 'SG', 'SF', 'PF'];

/** Returns a new array of the slots sorted into the sport-correct display order.
 *  Does not mutate the input. Unknown slots (e.g. TAXI) sort to the end. */
export function sortSlotsBySport<T extends { position: string }>(rows: T[]): T[] {
  const order = rows.some((s) => NBA_SPECIFIC_SLOTS.includes(s.position))
    ? SLOT_ORDER_NBA
    : SLOT_ORDER_WNBA;
  return [...rows].sort(
    (a, b) => (order[a.position] ?? 99) - (order[b.position] ?? 99),
  );
}
