/**
 * Data-semantic colors that stay fixed across light/dark themes.
 * These convey data meaning (severity, tier, trend) rather than UI chrome.
 */

// Injury severity
export const INJURY_COLORS = {
  out: '#dc3545',
  suspended: '#dc3545',
  doubtful: '#e8590c',
  questionable: '#f59f00',
  probable: '#51cf66',
} as const;

// Roster age buckets (scatter chart). Brand palette: vintage gold for
// rising youth, turf green for in-prime production, merlot for vets.
export const AGE_BUCKET_COLORS = {
  rising: '#B57B30', // Brand.vintageGold
  prime: '#1C552E',  // Brand.turfGreen
  vet: '#671A1E',    // Brand.merlot
} as const;

// Player performance trends
export const TREND_COLORS = {
  scorching: '#dc3545',
  hot: '#e67e22',
  neutral: '#6c757d',
  cold: '#17a2b8',
  frigid: '#6f42c1',
} as const;

// Subscription tier badges — brand palette.
// Free = hardwood (neutral warmth, clearly not a tier worth paying for).
// Pro = turfGreen (structural authority, "the analyst").
// Premium = merlot (commanding top tier, "the edge").
export const TIER_COLORS = {
  free: '#B8A06A',
  pro: '#1C552E',
  premium: '#671A1E',
} as const;
