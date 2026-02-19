import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

const EAS_PROJECT_ID = 'bc023770-8f00-49df-9fa0-0afdd24f6a44';
const ASKED_KEY = '@notifications_asked';

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
    await Notifications.setNotificationChannelAsync('draft', {
      name: 'Draft Notifications',
      importance: Notifications.AndroidImportance.HIGH,
    });
  }

  const { data: tokenData } = await Notifications.getExpoPushTokenAsync({ projectId: EAS_PROJECT_ID });
  const { error } = await supabase
    .from('push_tokens')
    .upsert({ user_id: userId, token: tokenData, draft_alerts: true }, { onConflict: 'user_id' });

  return !error;
}

// Removes the token from Supabase, stopping all push notifications for this user.
export async function unregisterPushToken(userId: string): Promise<void> {
  await supabase.from('push_tokens').delete().eq('user_id', userId);
}

// Returns the user's current notification preferences from Supabase.
export async function getPushPrefs(userId: string): Promise<{ enabled: boolean; draftAlerts: boolean }> {
  const { data } = await supabase
    .from('push_tokens')
    .select('token, draft_alerts')
    .eq('user_id', userId)
    .maybeSingle();

  return {
    enabled: !!data?.token,
    draftAlerts: data?.draft_alerts ?? false,
  };
}

// Toggles the draft_alerts column without touching the token.
export async function setDraftAlerts(userId: string, enabled: boolean): Promise<void> {
  await supabase.from('push_tokens').update({ draft_alerts: enabled }).eq('user_id', userId);
}
