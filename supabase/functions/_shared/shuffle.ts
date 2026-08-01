/** Fisher-Yates shuffle; returns a new array, leaving the input alone.
 *
 *  Used wherever an order has to be drawn fairly — advance-season's random
 *  waiver-priority reset, open-draft-season's random draft order. */
export function shuffle<T>(arr: T[]): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
