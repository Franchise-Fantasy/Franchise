import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from '@/utils/logger';

const KEY = 'pending_invite_code';

/**
 * Holds an invite code that arrived by deep link while nobody was signed in.
 *
 * An invite link is usually the FIRST thing a new user ever taps — before the
 * app is installed, before they have an account. The deep-link handler used to
 * bail on `!session?.user`, so that code was discarded and the invitee landed on
 * a generic sign-up with no memory of the league they were invited to. We stash
 * it here instead and redeem it once auth hydrates.
 *
 * Best-effort by design: a storage failure must never block the sign-in flow,
 * so both sides swallow errors and fall back to "no pending code".
 */
export async function stashInviteCode(code: string): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, code.trim().toUpperCase());
  } catch (err) {
    logger.warn('Could not stash invite code', err);
  }
}

/** Read and clear the stashed code. Returns null when there isn't one. */
export async function takeInviteCode(): Promise<string | null> {
  try {
    const code = await AsyncStorage.getItem(KEY);
    if (code) await AsyncStorage.removeItem(KEY);
    return code;
  } catch (err) {
    logger.warn('Could not read stashed invite code', err);
    return null;
  }
}
