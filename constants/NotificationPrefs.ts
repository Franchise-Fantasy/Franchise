/**
 * The notification preference shape and its defaults, with no React Native or
 * Expo imports.
 *
 * These live apart from lib/notifications.ts (which pulls in expo-device,
 * expo-notifications, and AsyncStorage) so that unit tests and other pure
 * consumers can read them without dragging the native chain into their import
 * graph. lib/notifications.ts re-exports both, so existing call sites are
 * unaffected.
 *
 * Mirrored server-side by DEFAULT_PREFS in supabase/functions/_shared/push.ts —
 * the two are drift-gated by __tests__/notificationPrefsParity.test.ts.
 */
export interface PushPreferences {
  draft: boolean;
  trades: boolean;
  trade_rumors: boolean;
  trade_block: boolean;
  matchups: boolean;
  matchup_closeup: boolean;
  waivers: boolean;
  injuries: boolean;
  playoffs: boolean;
  commissioner: boolean;
  league_activity: boolean;
  lottery: boolean;
  chat: boolean;
  direct_messages: boolean;
  roster_moves: boolean;
  player_news: boolean;
}

// Defaults applied when a user first accepts notifications. The rule: default ON
// only where the notification is about THIS user's team and is low-volume enough
// that every one is worth an interruption. High-frequency league-wide chatter
// (league chat, other teams' roster moves, rumors) and per-player news feeds
// stay OFF so a fresh install never feels spammy.
export const DEFAULT_PREFERENCES: PushPreferences = {
  draft: true,
  trades: true,
  trade_rumors: false,
  trade_block: true,
  matchups: true,
  matchup_closeup: true,
  waivers: true,
  injuries: true,
  playoffs: true,
  commissioner: true,
  league_activity: true,
  lottery: true,
  chat: false,
  direct_messages: true,
  roster_moves: false,
  player_news: false,
};
