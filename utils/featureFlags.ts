// Tiny per-user feature gate. Currently supports the NBA Playoff Archive
// (beta), the NHL Playoff Archive (dev-only), and the NFL Playoff Archive
// (dev-only). When a fourth flag arrives, replace these helpers with a real
// `feature_flags` Supabase table; the call sites stay the same.

const ARCHIVE_BETA_EMAILS = new Set([
  'jjspoels@gmail.com',
  'noahgordon2021@outlook.com',
  'samuel.goldman14@gmail.com',
  'wbengelhardt@gmail.com',
  'brycechurch7@gmail.com',
]);

// Intentionally narrower than the NBA archive list: NHL archive is a
// personal project right now and shouldn't be visible to other testers.
const NHL_ARCHIVE_DEV_EMAILS = new Set([
  'jjspoels@gmail.com',
]);

// Same posture as NHL — NFL archive is dev-only while the historical corpus
// is being curated.
const NFL_ARCHIVE_DEV_EMAILS = new Set([
  'jjspoels@gmail.com',
]);

interface MaybeUser {
  email?: string | null;
}

export function isArchiveFlagOn(user: MaybeUser | null | undefined): boolean {
  const email = user?.email?.toLowerCase().trim();
  return !!email && ARCHIVE_BETA_EMAILS.has(email);
}

export function isNhlArchiveFlagOn(user: MaybeUser | null | undefined): boolean {
  const email = user?.email?.toLowerCase().trim();
  return !!email && NHL_ARCHIVE_DEV_EMAILS.has(email);
}

export function isNflArchiveFlagOn(user: MaybeUser | null | undefined): boolean {
  const email = user?.email?.toLowerCase().trim();
  return !!email && NFL_ARCHIVE_DEV_EMAILS.has(email);
}
