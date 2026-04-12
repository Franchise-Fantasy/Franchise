import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SignJWT, importPKCS8 } from 'https://deno.land/x/jose@v5.2.2/index.ts';

// ── APNs HTTP/2 Push for Live Activities ────────────────────────────────────
// Separate from the Expo Push pipeline (_shared/push.ts).
// ActivityKit tokens are raw APNs device tokens scoped to a specific
// Live Activity instance and must be sent via direct APNs HTTP/2.

type ActivityType = 'matchup' | 'auction_draft';

interface APNsConfig {
  keyId: string;
  teamId: string;
  privateKey: CryptoKey;
  topic: string;
  isProduction: boolean;
}

let cachedConfig: APNsConfig | null = null;
let cachedJwt: { token: string; expiresAt: number } | null = null;

async function getConfig(): Promise<APNsConfig> {
  if (cachedConfig) return cachedConfig;

  const keyId = Deno.env.get('APNS_KEY_ID');
  const teamId = Deno.env.get('APNS_TEAM_ID');
  const keyP8 = Deno.env.get('APNS_KEY_P8');
  const isProd = Deno.env.get('APNS_PRODUCTION') !== 'false';

  if (!keyId || !teamId || !keyP8) {
    throw new Error('Missing APNs config: APNS_KEY_ID, APNS_TEAM_ID, and APNS_KEY_P8 are required');
  }

  // Decode base64-encoded .p8 key
  const pemContents = atob(keyP8);
  const privateKey = await importPKCS8(pemContents, 'ES256');

  cachedConfig = {
    keyId,
    teamId,
    privateKey,
    topic: 'com.chewers.franchisev2.push-type.liveactivity',
    isProduction: isProd,
  };
  return cachedConfig;
}

async function getJwt(config: APNsConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // Reuse JWT if still valid (refresh 5 min before expiry)
  if (cachedJwt && cachedJwt.expiresAt > now + 300) {
    return cachedJwt.token;
  }

  const expiresAt = now + 3000; // 50 minutes
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(now)
    .sign(config.privateKey);

  cachedJwt = { token, expiresAt };
  return token;
}

interface APNsResult {
  token: string;
  success: boolean;
  status?: number;
  reason?: string;
}

/** Send a Live Activity update to a single device token. */
async function sendToToken(
  config: APNsConfig,
  jwt: string,
  deviceToken: string,
  payload: Record<string, unknown>,
  priority: 5 | 10 = 10,
): Promise<APNsResult> {
  const host = config.isProduction
    ? 'https://api.push.apple.com'
    : 'https://api.sandbox.push.apple.com';

  try {
    const res = await fetch(`${host}/3/device/${deviceToken}`, {
      method: 'POST',
      headers: {
        'authorization': `bearer ${jwt}`,
        'apns-topic': config.topic,
        'apns-push-type': 'liveactivity',
        'apns-priority': String(priority),
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 200) {
      return { token: deviceToken, success: true, status: 200 };
    }

    const body = await res.json().catch(() => ({}));
    return {
      token: deviceToken,
      success: false,
      status: res.status,
      reason: body?.reason ?? `HTTP ${res.status}`,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { token: deviceToken, success: false, reason: message };
  }
}

/** Build the APNs payload for a Live Activity content-state update. */
function buildUpdatePayload(
  contentState: Record<string, unknown>,
  timestamp?: number,
): Record<string, unknown> {
  return {
    aps: {
      timestamp: timestamp ?? Math.floor(Date.now() / 1000),
      event: 'update',
      'content-state': contentState,
    },
  };
}

/** Build the APNs payload to end a Live Activity. */
function buildEndPayload(
  contentState: Record<string, unknown>,
  dismissalDate?: number,
): Record<string, unknown> {
  return {
    aps: {
      timestamp: Math.floor(Date.now() / 1000),
      event: 'end',
      'content-state': contentState,
      'dismissal-date': dismissalDate ?? Math.floor(Date.now() / 1000) + 300, // dismiss after 5 min
    },
  };
}

/**
 * Send a Live Activity update to all registered tokens for a given context.
 * Marks dead tokens as stale in the database.
 */
export async function pushActivityUpdate(
  supabase: SupabaseClient,
  activityType: ActivityType,
  filters: { schedule_id?: string; league_id?: string; draft_id?: string },
  contentState: Record<string, unknown>,
  options?: { end?: boolean; dismissalDate?: number; priority?: 5 | 10 },
): Promise<{ sent: number; failed: number; stale: number }> {
  // Fetch non-stale tokens for this activity type + context
  let query = supabase
    .from('activity_tokens')
    .select('id, push_token')
    .eq('activity_type', activityType)
    .eq('stale', false);

  if (filters.schedule_id) query = query.eq('schedule_id', filters.schedule_id);
  if (filters.league_id) query = query.eq('league_id', filters.league_id);
  if (filters.draft_id) query = query.eq('draft_id', filters.draft_id);

  const { data: tokens, error } = await query;
  if (error || !tokens || tokens.length === 0) {
    return { sent: 0, failed: 0, stale: 0 };
  }

  const config = await getConfig();
  const jwt = await getJwt(config);

  const payload = options?.end
    ? buildEndPayload(contentState, options.dismissalDate)
    : buildUpdatePayload(contentState);

  // Send in parallel with concurrency limit of 20
  const CONCURRENCY = 20;
  const results: APNsResult[] = [];
  for (let i = 0; i < tokens.length; i += CONCURRENCY) {
    const batch = tokens.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.allSettled(
      batch.map(t => sendToToken(config, jwt, t.push_token, payload, options?.priority ?? 10)),
    );
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }

  // Mark dead tokens as stale (410 Gone or BadDeviceToken/Unregistered)
  const staleTokenIds = results
    .filter(r => !r.success && (r.status === 410 || r.reason === 'BadDeviceToken' || r.reason === 'Unregistered'))
    .map(r => {
      const match = tokens.find(t => t.push_token === r.token);
      return match?.id;
    })
    .filter(Boolean) as string[];

  if (staleTokenIds.length > 0) {
    await supabase
      .from('activity_tokens')
      .update({ stale: true })
      .in('id', staleTokenIds);
  }

  return {
    sent: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    stale: staleTokenIds.length,
  };
}

export { buildUpdatePayload, buildEndPayload };
export type { ActivityType };
