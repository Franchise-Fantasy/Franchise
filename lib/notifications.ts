import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const EAS_PROJECT_ID = 'bc023770-8f00-49df-9fa0-0afdd24f6a44';
const ASKED_KEY = '@notifications_asked';

export interface PushPreferences {
  draft: boolean;
  trades: boolean;
  matchups: boolean;
  matchup_daily: boolean;
  waivers: boolean;
  injuries: boolean;
  playoffs: boolean;
  commissioner: boolean;
  league_activity: boolean;
  roster_reminders: boolean;
  lottery: boolean;
}

export const DEFAULT_PREFERENCES: PushPreferences = {
  draft: true,
  trades: true,
  matchups: true,
  matchup_daily: false,
  waivers: true,
  injuries: true,
  playoffs: true,
  commissioner: true,
  league_activity: false,
  roster_reminders: false,
  lottery: false,
};

export async function hasBeenAsked(): Promise<boolean> {
  return (await AsyncStorage.getItem(ASKED_KEY)) === 'true';
}

export async function markAsAsked(): Promise<void> {
  await AsyncStorage.setItem(ASKED_KEY, 'true');
}

// Requests OS permission, gets the Expo push token, and saves it to Supabase.
// Returns true if the token was successfully registered.
export async function registerPushToken(userId: string): Promise<boolean> {
  if (!Device.isDevice) return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  let finalStatus = existing;

  if (existing !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') return false;

  if (Platform.OS === 'android') {
    const channels = [
      { id: 'draft',        name: 'Draft',                importance: Notifications.AndroidImportance.HIGH },
      { id: 'trades',       name: 'Trades',               importance: Notifications.AndroidImportance.HIGH },
      { id: 'matchups',     name: 'Matchup Results',      importance: Notifications.AndroidImportance.DEFAULT },
      { id: 'waivers',      name: 'Waiver Results',       importance: Notifications.AndroidImportance.DEFAULT },
      { id: 'injuries',     name: 'Injury Updates',       importance: Notifications.AndroidImportance.DEFAULT },
      { id: 'playoffs',     name: 'Playoffs',             importance: Notifications.AndroidImportance.HIGH },
      { id: 'commissioner', name: 'Commissioner Actions', importance: Notifications.AndroidImportance.HIGH },
      { id: 'league',       name: 'League Activity',      importance: Notifications.AndroidImportance.LOW },
      { id: 'roster',       name: 'Roster Reminders',     importance: Notifications.AndroidImportance.DEFAULT },
      { id: 'lottery',      name: 'Lottery',              importance: Notifications.AndroidImportance.DEFAULT },
    ];
    for (const ch of channels) {
      await Notifications.setNotificationChannelAsync(ch.id, {
        name: ch.name,
        importance: ch.importance,
      });
    }
  }

  const { data: tokenData } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  const { error } = await supabase
    .from('push_tokens')
    .upsert(
      { user_id: userId, token: tokenData, preferences: DEFAULT_PREFERENCES },
      { onConflict: 'user_id' },
    );

  return !error;
}

// Removes the token from Supabase, stopping all push notifications for this user.
export async function unregisterPushToken(userId: string): Promise<void> {
  await supabase.from('push_tokens').delete().eq('user_id', userId);
}

// Returns the user's current notification preferences from Supabase.
export async function getPushPrefs(
  userId: string,
): Promise<{ enabled: boolean; preferences: PushPreferences }> {
  const { data } = await supabase
    .from('push_tokens')
    .select('token, preferences')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    enabled: !!data?.token,
    preferences: data?.preferences ?? DEFAULT_PREFERENCES,
  };
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
  supabase.functions.invoke('send-notification', { body: params }).catch(() => {});
}

// Silently refreshes the push token if it changed (e.g. Expo rotated it).
// Safe to call on every app foreground — no-ops if nothing changed.
export async function refreshPushToken(userId: string): Promise<void> {
  if (!Device.isDevice) return;
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;

  try {
    const { data: tokenData } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
    const { data: existing } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', userId)
      .maybeSingle();

    if (!existing) return; // user hasn't opted in
    if (existing.token === tokenData) return; // unchanged

    await supabase
      .from('push_tokens')
      .update({ token: tokenData })
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

  const current: PushPreferences = data?.preferences ?? DEFAULT_PREFERENCES;
  const merged = { ...current, ...patch };

  await supabase
    .from('push_tokens')
    .update({ preferences: merged })
    .eq('user_id', userId);
}
