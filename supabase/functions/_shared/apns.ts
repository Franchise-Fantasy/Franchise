import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { SignJWT, importPKCS8, type KeyLike } from 'https://deno.land/x/jose@v5.2.2/index.ts';

// ── APNs HTTP/2 Push for Live Activities ────────────────────────────────────
// Separate from the Expo Push pipeline (_shared/push.ts).
// ActivityKit tokens are raw APNs device tokens scoped to a specific
// Live Activity instance and must be sent via direct APNs HTTP/2.

type ActivityType = 'matchup' | 'auction_draft';

interface APNsConfig {
  keyId: string;
  teamId: string;
  privateKey: KeyLike | Uint8Array;
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

  const config: APNsConfig = {
    keyId,
    teamId,
    privateKey,
    topic: 'com.chewers.franchisev2.push-type.liveactivity',
    isProduction: isProd,
  };
  cachedConfig = config;
  return config;
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
      writeDebugLog(config, deviceToken, 200, 'OK', host).catch(() => {});
      return { token: deviceToken, success: true, status: 200 };
    }

    const body = await res.json().catch(() => ({}));
    const reason = body?.reason ?? `HTTP ${res.status}`;
    writeDebugLog(config, deviceToken, res.status, reason, host).catch(() => {});
    return {
      token: deviceToken,
      success: false,
      status: res.status,
      reason,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    writeDebugLog(config, deviceToken, 0, `throw:${message}`, '').catch(() => {});
    return { token: deviceToken, success: false, reason: message };
  }
}

// Routes APNs responses into apns_debug_log so we can inspect from outside the
// edge-function runtime. Cheap insert; failures are swallowed because logging
// failures must never block real push flow.
async function writeDebugLog(
  config: APNsConfig,
  deviceToken: string,
  status: number,
  reason: string,
  host: string,
): Promise<void> {
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SB_SECRET_KEY');
    if (!supabaseUrl || !serviceKey) return;
    await fetch(`${supabaseUrl}/rest/v1/apns_debug_log`, {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'authorization': `Bearer ${serviceKey}`,
        'content-type': 'application/json',
        'prefer': 'return=minimal',
      },
      body: JSON.stringify({
        source: 'apns',
        token_prefix: deviceToken.slice(0, 16),
        status,
        reason,
        host,
        topic: config.topic,
      }),
    });
  } catch {
    // intentional swallow
  }
}

// expo-widgets wraps the actual props in a Codable struct on the iOS side:
//   struct ContentState: Codable, Hashable { var name: String; var props: String }
// (see node_modules/expo-widgets/ios/Widgets/WidgetLiveActivity.swift). The
// `name` matches the createLiveActivity name and `props` is a JSON-encoded
// string of the actual content state object. APNs pushes that don't match
// this shape silently fail to decode — APNs returns 200 OK, iOS receives the
// push, but the activity stays in its loading state because the ContentState
// can't be deserialized.
const ACTIVITY_NAME = 'MatchupActivity';

function wrapContentState(contentState: Record<string, unknown>): Record<string, string> {
  return {
    name: ACTIVITY_NAME,
    props: JSON.stringify(contentState),
  };
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
      'content-state': wrapContentState(contentState),
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
      'content-state': wrapContentState(contentState),
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
