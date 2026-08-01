/**
 * Pure draft-board layout, shared between client and edge runtimes.
 *
 * Zero deps so both Metro and Deno can import it. It used to live in
 * `lib/draft.ts`, which imports the RN Supabase client — that made it
 * unreachable from edge functions, and `open-draft-season` needs the exact
 * same numbering the initial draft was built with. `lib/draft.ts` re-exports
 * it so existing call sites are unchanged.
 */

export type BuiltPick = {
  season: string;
  round: number;
  slot_number: number;
  pick_number?: number;
};

/**
 * Lay out a draft's picks. Snake rounds reverse the slot order, so slot 1
 * picks last in round 2. No DB access — the caller decides whether to insert
 * them or hand them to an RPC.
 */
export function buildDraftPicks(
  numberOfTeams: number,
  roundsCount: number,
  season: string,
  draftType: 'snake' | 'linear' = 'snake',
): BuiltPick[] {
  const picks: BuiltPick[] = [];

  for (let round = 1; round <= roundsCount; round++) {
    const isSnakeReverse = draftType === 'snake' && round % 2 === 0;

    for (let slot = 1; slot <= numberOfTeams; slot++) {
      picks.push({
        season,
        round,
        slot_number: slot,
        pick_number:
          (round - 1) * numberOfTeams +
          (isSnakeReverse ? numberOfTeams - slot + 1 : slot),
      });
    }
  }

  return picks;
}
