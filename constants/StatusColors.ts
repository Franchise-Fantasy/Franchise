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

// Roster age buckets (scatter chart)
export const AGE_BUCKET_COLORS = {
  rising: '#17a2b8',
  prime: '#28a745',
  vet: '#e67e22',
} as const;

// Player performance trends
export const TREND_COLORS = {
  scorching: '#dc3545',
  hot: '#e67e22',
  neutral: '#6c757d',
  cold: '#17a2b8',
  frigid: '#6f42c1',
} as const;

// Subscription tier badges
export const TIER_COLORS = {
  free: '#687076',
  pro: '#007AFF',
  premium: '#FFB800',
} as const;
