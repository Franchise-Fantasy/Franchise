export type WaiverType = 'standard' | 'faab' | 'none';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** "Wed 2/6" — the day-of-week + month/date stub shared by the badge + process labels. */
function dayStub(d: Date): string {
  return `${DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * When a waiver claim or FAAB bid for `playerId` will process. Both standard
 * waivers and FAAB resolve at the player's per-player `on_waivers_until`
 * timestamp — a player is only biddable/claimable while sitting on the wire
 * after being dropped. Returns `'—'` when there is no claim path (no-waivers
 * league or player not on the wire).
 */
export function getProcessDate(
  playerId: string,
  waiverType: WaiverType,
  waiverPlayerMap: Map<string, string> | undefined,
): string {
  if (waiverType === 'none') return '—';
  const until = waiverPlayerMap?.get(playerId);
  if (!until) return '—';
  const d = new Date(until);
  const timeStr = d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
  return `${dayStub(d)} at ${timeStr}`;
}

/** Short waiver-badge label for a player row. Returns null when no badge applies. */
export function getWaiverBadgeLabel(
  playerId: string,
  waiverType: WaiverType,
  waiverPlayerMap: Map<string, string> | undefined,
): string | null {
  if (waiverType === 'none') return null;
  const until = waiverPlayerMap?.get(playerId);
  if (!until) return null;
  return `W · ${dayStub(new Date(until))}`;
}

/** Whether adding `playerId` requires submitting a waiver claim instead of an instant add. */
export function isOnWaivers(
  playerId: string,
  waiverType: WaiverType,
  waiverPlayerMap: Map<string, string> | undefined,
): boolean {
  if (waiverType === 'none') return false;
  return waiverPlayerMap?.has(playerId) ?? false;
}
