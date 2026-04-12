/**
 * Returns the NBA CDN headshot URL for a player, or null if no external ID.
 * Size options: '260x190' (small, good for lists) or '1040x760' (large, good for modals).
 */
export function getPlayerHeadshotUrl(
  externalIdNba: string | number | null | undefined,
  size: '260x190' | '1040x760' = '260x190'
): string | null {
  if (!externalIdNba) return null;
  return `https://cdn.nba.com/headshots/nba/latest/${size}/${externalIdNba}.png`;
}

// ESPN uses different abbreviations for some teams
const ESPN_TRICODE_MAP: Record<string, string> = {
  GSW: 'gs',
  NOP: 'no',
  SAS: 'sa',
  NYK: 'ny',
  BKN: 'bkn',
  UTA: 'utah',
};

/**
 * Returns an ESPN CDN team logo URL (PNG) for a given NBA tricode, or null.
 */
export function getTeamLogoUrl(nbaTeam: string | null | undefined): string | null {
  if (!nbaTeam || nbaTeam === 'Active' || nbaTeam === 'Inactive') return null;
  const espnCode = ESPN_TRICODE_MAP[nbaTeam] ?? nbaTeam.toLowerCase();
  return `https://a.espncdn.com/i/teamlogos/nba/500/${espnCode}.png`;
}
