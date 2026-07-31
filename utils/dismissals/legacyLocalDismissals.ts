import AsyncStorage from '@react-native-async-storage/async-storage';

import { supabase } from '@/lib/supabase';
import { logger } from '@/utils/logger';

import { type DismissalKind, rosterTapHintId } from './types';

/**
 * One-time lift of the pre-`user_dismissals` AsyncStorage seen-sets into the
 * database, so the switch to server-side state doesn't replay a wall of
 * already-dismissed banners at every existing user on their next launch.
 *
 * The flag is intentionally per-DEVICE (AsyncStorage, not the DB): the data
 * being lifted is per-device, so each of a user's devices contributes its own
 * local set exactly once. Later devices just add to the union.
 */

const MIGRATED_FLAG = '@dismissals_migrated_v1';

/** Legacy key → kind. Each held a JSON array of ids. */
const LEGACY_LIST_KEYS: Record<string, DismissalKind> = {
  '@dismissed_announcements': 'announcement',
  '@dismissed_matchup_results': 'matchup_result',
  '@dismissed_home_announcements': 'home_banner',
  '@seen_coach_marks': 'coach_mark',
};

/**
 * The roster tap-to-move hint predates the shared CoachMark component and wrote
 * one key per team (`rosterTapHint:seen:<teamId>`) instead of joining the
 * `@seen_coach_marks` list.
 */
const ROSTER_HINT_PREFIX = 'rosterTapHint:seen:';

function parseIdList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return []; // corrupt value — nothing to migrate
  }
}

async function collectLegacyRows(
  userId: string,
): Promise<{ rows: { user_id: string; kind: DismissalKind; item_id: string }[]; keys: string[] }> {
  const rows: { user_id: string; kind: DismissalKind; item_id: string }[] = [];
  const keys: string[] = [];

  const listKeys = Object.keys(LEGACY_LIST_KEYS);
  const stored = await AsyncStorage.multiGet(listKeys);
  for (const [key, raw] of stored) {
    if (raw == null) continue;
    keys.push(key);
    for (const id of parseIdList(raw)) {
      rows.push({ user_id: userId, kind: LEGACY_LIST_KEYS[key], item_id: id });
    }
  }

  const allKeys = await AsyncStorage.getAllKeys();
  for (const key of allKeys) {
    if (!key.startsWith(ROSTER_HINT_PREFIX)) continue;
    keys.push(key);
    rows.push({
      user_id: userId,
      kind: 'coach_mark',
      item_id: rosterTapHintId(key.slice(ROSTER_HINT_PREFIX.length)),
    });
  }

  return { rows, keys };
}

/**
 * Runs at most once per device. Safe to call on every dismissals fetch — after
 * the first success it costs a single AsyncStorage read. Never throws: a failed
 * migration just leaves the local keys in place to retry next launch.
 */
export async function migrateLocalDismissals(userId: string): Promise<void> {
  try {
    if ((await AsyncStorage.getItem(MIGRATED_FLAG)) === 'true') return;

    const { rows, keys } = await collectLegacyRows(userId);

    if (rows.length > 0) {
      const { error } = await supabase
        .from('user_dismissals')
        .upsert(rows, { onConflict: 'user_id,kind,item_id', ignoreDuplicates: true });
      if (error) {
        logger.warn('Legacy dismissal migration failed, will retry', { error: error.message });
        return; // leave the flag unset so the next launch retries
      }
    }

    await AsyncStorage.setItem(MIGRATED_FLAG, 'true');
    // Only after the flag lands — a crash between the two just re-migrates.
    if (keys.length > 0) await AsyncStorage.multiRemove(keys);
  } catch (err) {
    logger.warn('Legacy dismissal migration threw, will retry', err);
  }
}
