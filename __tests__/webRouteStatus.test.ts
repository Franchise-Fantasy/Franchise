import { isWebRouteLive, webRouteLabel } from '@/utils/web/webRouteStatus';

describe('isWebRouteLive', () => {
  it('keeps the four beta priorities reachable', () => {
    // Home, creation, draft room, chat — the flows the web beta ships on.
    expect(isWebRouteLive('/')).toBe(true);
    expect(isWebRouteLive('/create-league')).toBe(true);
    expect(isWebRouteLive('/import-league')).toBe(true);
    expect(isWebRouteLive('/draft-room/abc-123')).toBe(true);
    expect(isWebRouteLive('/chat')).toBe(true);
    expect(isWebRouteLive('/chat/some-conversation-id')).toBe(true);
  });

  it('keeps the two screens with purpose-built desktop layouts', () => {
    expect(isWebRouteLive('/standings')).toBe(true);
    expect(isWebRouteLive('/draft-hub')).toBe(true);
  });

  it('keeps auth, legal and account settings reachable', () => {
    // Sign-out lives behind /profile — gating it would strand the user.
    expect(isWebRouteLive('/auth')).toBe(true);
    expect(isWebRouteLive('/profile')).toBe(true);
    expect(isWebRouteLive('/legal')).toBe(true);
    expect(isWebRouteLive('/reset-password')).toBe(true);
  });

  it('gates the screens that are still phone-first', () => {
    for (const route of [
      '/matchup',
      '/roster',
      '/free-agents',
      '/scoreboard',
      '/schedule',
      '/trades',
      '/activity',
      '/playoff-bracket',
      '/news',
      '/league-history',
      '/league-info',
      '/analytics',
      '/lottery-room',
      '/team-roster/team-uuid',
    ]) {
      expect(isWebRouteLive(route)).toBe(false);
    }
  });

  it('matches whole segments, never bare string prefixes', () => {
    // "/chat" must not open the gate for an unrelated sibling route.
    expect(isWebRouteLive('/chatter')).toBe(false);
    expect(isWebRouteLive('/standings-archive')).toBe(false);
  });

  it('ignores query strings, hashes and trailing slashes', () => {
    expect(isWebRouteLive('/legal?tab=terms')).toBe(true);
    expect(isWebRouteLive('/standings/')).toBe(true);
    expect(isWebRouteLive('/chat#latest')).toBe(true);
    expect(isWebRouteLive('/trades?filter=mine')).toBe(false);
  });

  it('treats an empty path as home', () => {
    expect(isWebRouteLive('')).toBe(true);
  });

  it('ignores expo-router group segments in either spelling', () => {
    // The app pushes "/(tabs)/roster" in places and usePathname reports
    // "/roster" — both must classify the same way.
    expect(isWebRouteLive('/(tabs)/roster')).toBe(false);
    expect(isWebRouteLive('/(tabs)')).toBe(true); // resolves to home
    expect(isWebRouteLive('/(setup)/profile')).toBe(true);
    expect(webRouteLabel('/(tabs)/free-agents')).toBe('Free Agents');
  });
});

describe('webRouteLabel', () => {
  it('names known destinations', () => {
    expect(webRouteLabel('/playoff-bracket')).toBe('Playoffs');
    expect(webRouteLabel('/free-agents')).toBe('Free Agents');
    expect(webRouteLabel('/team-roster/abc')).toBe('Team Roster');
  });

  it('distinguishes the per-sport playoff archives from the base route', () => {
    // "/playoff-archive-nfl" must not be swallowed by the "/playoff-archive" key.
    expect(webRouteLabel('/playoff-archive')).toBe('Playoff Archive');
    expect(webRouteLabel('/playoff-archive-nfl')).toBe('Playoff Archive');
  });

  it('title-cases an unmapped route rather than showing a slug', () => {
    expect(webRouteLabel('/some-new-screen')).toBe('Some New Screen');
    expect(webRouteLabel('/some-new-screen/42')).toBe('Some New Screen');
  });

  it('falls back to generic copy when there is no segment to name', () => {
    expect(webRouteLabel('/')).toBe('This page');
  });
});
