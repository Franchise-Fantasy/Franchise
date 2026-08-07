/**
 * Which routes are finished on the web companion.
 *
 * Web is a private beta and only a few flows are ported to desktop: league
 * creation/import, the home dashboard, the draft room + hub, standings, and
 * chat. Every other screen still renders its phone-first layout on a 1200px
 * page, so rather than let someone walk into a half-broken surface we mark it
 * "In Progress" and make it unreachable.
 *
 * This is the single source of truth for that decision — the shell guard
 * (WebShell.web.tsx) and the nav chrome (Sidebar, home cards) all read it, so
 * a route can't be advertised in one place and dead in another. Pure module,
 * no react-native imports, so it stays unit-testable.
 *
 * To promote a screen: add it below and remove any In Progress tag its entry
 * points render. Native is never affected — every screen ships there.
 */

/** Exact pathnames that are finished on web. */
const LIVE_EXACT: readonly string[] = [
  '/', // home dashboard
  '/loading',
];

/**
 * Finished route trees. A pathname matches when it equals the prefix or
 * continues with a "/", so "/chat" covers "/chat/<id>" while a sibling like
 * "/chatter" would stay gated.
 */
const LIVE_PREFIXES: readonly string[] = [
  // The way in, and the links we're required to carry.
  '/auth',
  '/reset-password',
  '/legal',
  // Creation + onboarding, including the routes an invite link lands on.
  '/create-league',
  '/import-league',
  '/join-league',
  '/create-team',
  '/claim-team',
  // Chat, plus the polls/surveys authored inside it.
  '/chat',
  '/survey',
  // Draft: the live room, the hub, and the prospect surfaces the hub links to.
  '/draft-room',
  '/draft-hub',
  '/prospect',
  '/prospects',
  '/prospect-board',
  // Has a purpose-built desktop screen (WebStandingsScreen).
  '/standings',
  // Account settings. Sign-out lives here, so it can never be gated.
  '/profile',
  '/notification-settings',
  '/blocked-users',
];

/**
 * Display names for gated destinations, so the In Progress screen says
 * "Trades" rather than a slug. Anything missing falls back to title-casing
 * the first path segment.
 */
const LABELS: Readonly<Record<string, string>> = {
  '/matchup': 'Matchup',
  '/roster': 'Roster',
  '/team-roster': 'Team Roster',
  '/free-agents': 'Free Agents',
  '/scoreboard': 'Scoreboard',
  '/schedule': 'Schedule',
  '/trades': 'Trades',
  '/activity': 'Activity',
  '/playoff-bracket': 'Playoffs',
  '/playoff-archive': 'Playoff Archive',
  '/playoff-archive-nfl': 'Playoff Archive',
  '/playoff-archive-nhl': 'Playoff Archive',
  '/news': 'News',
  '/league-history': 'League History',
  '/add-league-history': 'League History',
  '/league-info': 'League Info',
  '/analytics': 'Analytics',
  '/player-compare': 'Player Compare',
  '/franchise': 'Franchise',
  '/lottery-room': 'Lottery Room',
};

/**
 * Reduce a path to the form the tables above are written in: no query/hash, no
 * trailing slash, and no expo-router group segments. `usePathname()` already
 * strips groups, but `router.push('/(tabs)/roster')` is spelled with them all
 * over the app — normalizing here means a caller can pass either spelling and
 * a stray "(tabs)" can never make a live route read as gated.
 */
function normalizePath(pathname: string): string {
  const bare = (pathname ?? '').split(/[?#]/)[0];
  if (!bare) return '/';
  const trimmed = bare
    .split('/')
    .filter((segment) => segment !== '' && !(segment.startsWith('(') && segment.endsWith(')')))
    .join('/');
  return trimmed === '' ? '/' : `/${trimmed}`;
}

function matches(path: string, prefix: string): boolean {
  return path === prefix || path.startsWith(`${prefix}/`);
}

/** True when the screen behind `pathname` is finished on web. */
export function isWebRouteLive(pathname: string): boolean {
  const path = normalizePath(pathname);
  if (LIVE_EXACT.includes(path)) return true;
  return LIVE_PREFIXES.some((prefix) => matches(path, prefix));
}

/** Human label for a route, for the In Progress screen and nav tags. */
export function webRouteLabel(pathname: string): string {
  const path = normalizePath(pathname);
  const key = Object.keys(LABELS).find((k) => matches(path, k));
  if (key) return LABELS[key];

  const segment = path.split('/')[1] ?? '';
  const titled = segment
    .split('-')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return titled || 'This page';
}
