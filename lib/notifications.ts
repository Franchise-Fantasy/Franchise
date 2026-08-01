import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { DEFAULT_PREFERENCES, type PushPreferences } from '@/constants/NotificationPrefs';
import type { Json } from '@/types/database.types';

import { supabase } from './supabase';


const EAS_PROJECT_ID = 'bc023770-8f00-49df-9fa0-0afdd24f6a44';
const ASKED_KEY = '@notifications_asked';

// The device's IANA timezone (e.g. "America/Los_Angeles"). Stored on the
// push_tokens row so the server can localize time-bearing notification bodies
// (draft times, reminders) to each recipient's own zone. Returns null on the
// rare engine without a resolvable zone — the server then falls back to the
// sender-zone-labeled string.
function deviceTimezone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// The preference shape and its defaults live in a native-import-free module so
// tests can read them without pulling expo-device/expo-notifications in.
// Re-exported here because this is the import path every call site already uses.
export { DEFAULT_PREFERENCES } from '@/constants/NotificationPrefs';
export type { PushPreferences } from '@/constants/NotificationPrefs';

export async function hasBeenAsked(): Promise<boolean> {
  return (await AsyncStorage.getItem(ASKED_KEY)) === 'true';
}

export async function markAsAsked(): Promise<void> {
  await AsyncStorage.setItem(ASKED_KEY, 'true');
}

// Requests OS permission, gets the Expo push token, and saves it to Supabase.
// Returns true if the token was successfully registered.
export async function registerPushToken(userId: string): Promise<boolean> {
  // Web has no Expo push transport, and calling into permissions here is what
  // triggers the browser's "Allow notifications?" popup. Bail before that.
  if (Platform.OS === 'web') return false;
  if (!Device.isDevice) return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return false;

  if (Platform.OS === 'android') {
    try {
      const channels = [
        { id: 'draft',        name: 'Draft',                importance: Notifications.AndroidImportance.HIGH },
        { id: 'trades',       name: 'Trades',               importance: Notifications.AndroidImportance.HIGH },
        { id: 'trade_rumors', name: 'Trade Rumors',           importance: Notifications.AndroidImportance.DEFAULT },
        { id: 'trade_block', name: 'Trade Block Interest',  importance: Notifications.AndroidImportance.DEFAULT },
        { id: 'matchups',     name: 'Matchup Results',      importance: Notifications.AndroidImportance.DEFAULT },
        { id: 'waivers',      name: 'Waiver Results',       importance: Notifications.AndroidImportance.DEFAULT },
        { id: 'injuries',     name: 'Injury Updates',       importance: Notifications.AndroidImportance.DEFAULT },
        { id: 'playoffs',     name: 'Playoffs',             importance: Notifications.AndroidImportance.HIGH },
        { id: 'commissioner', name: 'League Admin',         importance: Notifications.AndroidImportance.HIGH },
        { id: 'league',       name: 'League Activity',      importance: Notifications.AndroidImportance.LOW },
        { id: 'lottery',      name: 'Lottery',              importance: Notifications.AndroidImportance.DEFAULT },
        { id: 'chat',         name: 'League Chat',          importance: Notifications.AndroidImportance.DEFAULT },
        { id: 'direct_messages', name: 'Direct Messages',   importance: Notifications.AndroidImportance.HIGH },
        { id: 'roster_moves', name: 'League Roster Moves',  importance: Notifications.AndroidImportance.LOW },
        { id: 'player_news', name: 'Player News',           importance: Notifications.AndroidImportance.DEFAULT },
      ];
      for (const ch of channels) {
        await Notifications.setNotificationChannelAsync(ch.id, {
          name: ch.name,
          importance: ch.importance,
        });
      }
    } catch {
      // Channel creation may fail in Expo Go — non-fatal
    }
  }

  const tokenResult = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });

  // Seed DEFAULT_PREFERENCES only on a genuine first opt-in. Re-registering (the
  // Profile toggle flipped off then on, a token rotation) must NOT clobber the
  // categories the user has since tuned — the upsert used to write defaults
  // unconditionally, silently resetting every customization.
  const { data: existingRow } = await supabase
    .from('push_tokens')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle();

  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      {
        user_id: userId,
        token: tokenResult.data,
        timezone: deviceTimezone(),
        preferences: (existingRow?.preferences ?? DEFAULT_PREFERENCES) as unknown as Json,
      },
      { onConflict: 'user_id' },
    );

  return !error;
}

// Removes the token from Supabase, stopping all push notifications for this user.
export async function unregisterPushToken(userId: string): Promise<void> {
  const { error } = await supabase.from('push_tokens').delete().eq('user_id', userId);
  if (error) console.error('Failed to unregister push token:', error.message);
}

// Returns the user's current notification preferences from Supabase.
export async function getPushPrefs(
  userId: string,
): Promise<{ enabled: boolean; preferences: PushPreferences; muteAll: boolean }> {
  const { data } = await supabase
    .from('push_tokens')
    .select('token, preferences, mute_all')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    enabled: !!data?.token,
    // Merge over the defaults: a row written before a category existed has no
    // key for it, and a bare read would render that toggle as OFF regardless of
    // its intended default. Mirrors the server-side fallback in _shared/push.ts.
    preferences: {
      ...DEFAULT_PREFERENCES,
      ...((data?.preferences as Partial<PushPreferences> | null) ?? {}),
    },
    muteAll: data?.mute_all ?? false,
  };
}

// Sets the global mute_all flag on/off.
export async function setMuteAll(userId: string, muted: boolean): Promise<void> {
  await supabase
    .from('push_tokens')
    .update({ mute_all: muted })
    .eq('user_id', userId);
}

// Returns per-league notification overrides (sparse — only explicitly changed categories).
export async function getLeagueNotifPrefs(
  userId: string,
  leagueId: string,
): Promise<Partial<PushPreferences>> {
  const { data } = await supabase
    .from('league_notification_prefs')
    .select('overrides')
    .eq('user_id', userId)
    .eq('league_id', leagueId)
    .maybeSingle();

  return (data?.overrides as Partial<PushPreferences>) ?? {};
}

// Merges a partial update into the user's per-league notification overrides.
export async function updateLeagueNotifPrefs(
  userId: string,
  leagueId: string,
  patch: Partial<PushPreferences>,
): Promise<void> {
  const { data: existing } = await supabase
    .from('league_notification_prefs')
    .select('overrides')
    .eq('user_id', userId)
    .eq('league_id', leagueId)
    .maybeSingle();

  const current = (existing?.overrides as Partial<PushPreferences>) ?? {};
  const merged = { ...current, ...patch };

  await supabase
    .from('league_notification_prefs')
    .upsert(
      { user_id: userId, league_id: leagueId, overrides: merged, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,league_id' },
    );
}

// Resets a specific category's league override back to "use global default".
export async function resetLeagueNotifPref(
  userId: string,
  leagueId: string,
  key: keyof PushPreferences,
): Promise<void> {
  const { data: existing } = await supabase
    .from('league_notification_prefs')
    .select('overrides')
    .eq('user_id', userId)
    .eq('league_id', leagueId)
    .maybeSingle();

  if (!existing) return;
  const current = { ...(existing.overrides as Record<string, boolean>) };
  delete current[key];

  await supabase
    .from('league_notification_prefs')
    .update({ overrides: current, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .eq('league_id', leagueId);
}

// Fire-and-forget push notification via the send-notification edge function.
export function sendNotification(params: {
  league_id: string;
  team_ids?: string[];
  category: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}): void {
  supabase.functions
    .invoke('send-notification', { body: params })
    .catch((e) => console.warn('send-notification invoke failed:', e));
}

// Silently refreshes the push token if it changed (e.g. Expo rotated it).
// Safe to call on every app foreground — no-ops if nothing changed.
export async function refreshPushToken(userId: string): Promise<void> {
  // Runs on every foreground/auth event — see registerPushToken for why web bails.
  if (Platform.OS === 'web') return;
  if (!Device.isDevice) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  try {
    const { data: tokenData } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    const { data: existing } = await supabase
      .from('push_tokens')
      .select('token, timezone')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) return; // user hasn't opted in
    const tz = deviceTimezone();
    // Also re-sync timezone here so a user who traveled (token unchanged, zone
    // changed) still gets time-bearing notifications localized correctly.
    if (existing.token === tokenData && existing.timezone === tz) return; // unchanged

    await supabase
      .from('push_tokens')
      .update({ token: tokenData, timezone: tz })
      .eq('user_id', userId);
  } catch {
    // Non-fatal — will retry next foreground
  }
}

// Merges a partial update into the user's notification preferences.
export async function updatePreferences(
  userId: string,
  patch: Partial<PushPreferences>,
): Promise<void> {
  const { data } = await supabase
    .from('push_tokens')
    .select('preferences')
    .eq('user_id', userId)
    .maybeSingle();

  const merged: PushPreferences = {
    ...DEFAULT_PREFERENCES,
    ...((data?.preferences as Partial<PushPreferences> | null) ?? {}),
    ...patch,
  };

  await supabase
    .from('push_tokens')
    .update({ preferences: merged as unknown as Json })
    .eq('user_id', userId);
}
