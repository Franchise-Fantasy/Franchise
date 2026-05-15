export type WaiverType = 'standard' | 'faab' | 'none';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/**
 * When a waiver claim or FAAB bid for `playerId` will process. Standard
 * waivers process at the per-player `on_waivers_until` timestamp; FAAB
 * runs on the league's weekly waiver day at 6 AM. Returns `'—'` when
 * there is no claim path (no-waivers league or no waiver record).
 */
export function getProcessDate(
  playerId: string,
  waiverType: WaiverType,
  waiverPlayerMap: Map<string, string> | undefined,
  waiverDayOfWeek: number,
): string {
  if (waiverType === 'standard') {
    const until = waiverPlayerMap?.get(playerId);
    if (until) {
      const d = new Date(until);
      const timeStr = d.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      });
      return `${DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()} at ${timeStr}`;
    }
    return '—';
  }
  if (waiverType === 'faab') {
    const now = new Date();
    const currentDay = now.getDay();
    let daysUntil = waiverDayOfWeek - currentDay;
    if (daysUntil <= 0) daysUntil += 7;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntil);
    return `${DAY_NAMES[waiverDayOfWeek]} ${next.getMonth() + 1}/${next.getDate()} at 6:00 AM`;
  }
  return '—';
}

/** Short waiver-badge label for a player row. Returns null when no badge applies. */
export function getWaiverBadgeLabel(
  playerId: string,
  waiverType: WaiverType,
  waiverPlayerMap: Map<string, string> | undefined,
  waiverDayOfWeek: number,
): string | null {
  if (waiverType === 'none') return null;
  if (waiverType === 'standard') {
    const until = waiverPlayerMap?.get(playerId);
    if (!until) return null;
    const d = new Date(until);
    return `W · ${DAY_NAMES[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
  }
  // FAAB: every add goes through bidding — show next processing day.
  const now = new Date();
  let daysUntil = waiverDayOfWeek - now.getDay();
  if (daysUntil <= 0) daysUntil += 7;
  const next = new Date(now);
  next.setDate(now.getDate() + daysUntil);
  return `W · ${DAY_NAMES[waiverDayOfWeek]} ${next.getMonth() + 1}/${next.getDate()}`;
}

/** Whether adding `playerId` requires submitting a waiver claim instead of an instant add. */
export function isOnWaivers(
  playerId: string,
  waiverType: WaiverType,
  waiverPlayerMap: Map<string, string> | undefined,
): boolean {
  if (waiverType === 'none') return false;
  if (waiverType === 'faab') return true;
  return waiverPlayerMap?.has(playerId) ?? false;
}
