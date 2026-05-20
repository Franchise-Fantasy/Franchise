import { createClient, SupabaseClient } from '@supabase/supabase-js';

import { SUPABASE_URL, PUBLISHABLE_KEY, SECRET_KEY, BOT_EMAIL, BOT_PASSWORD } from './config';

export function adminClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function signInAsBot(n: number): Promise<SupabaseClient> {
  const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email: BOT_EMAIL(n),
    password: BOT_PASSWORD,
  });
  if (error) throw new Error(`Failed to sign in as bot${n}: ${error.message}`);
  return client;
}

/**
 * Invoke an edge function with the service role key. The function sees the
 * caller as a server call (isServerCall === true), which bypasses both user
 * authorization checks and per-user rate limits. Use this for tests that
 * exercise business logic, not auth. For RLS/authz tests, use `signInAsBot`.
 */
export async function serverInvoke<T = any>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<{ data: T | null; error: Error | null }> {
  return adminClient().functions.invoke<T>(functionName, { body });
}

let cachedCronSecret: string | null = null;

/**
 * Read CRON_SECRET via the `test_get_cron_secret` RPC. The RPC is gated to
 * service_role only (REVOKE'd from anon/authenticated), and service_role
 * already has unrestricted DB access including vault — so this RPC creates
 * no new attack surface, it just lets PostgREST surface a secret that the
 * `vault` schema doesn't otherwise expose.
 */
export async function getCronSecret(): Promise<string | null> {
  if (cachedCronSecret) return cachedCronSecret;
  const admin = adminClient();
  const { data, error } = await admin.rpc('test_get_cron_secret');
  if (error || !data) return null;
  cachedCronSecret = data as string;
  return cachedCronSecret;
}

/**
 * Invoke a cron-gated edge function with the shared CRON_SECRET. The function
 * sees the call as if pg_cron had scheduled it — no user JWT, no rate limit.
 * Returns the parsed JSON body plus status so tests can assert both. Throws
 * with a clear message if the secret can't be retrieved.
 */
export async function cronInvoke<T = any>(
  functionName: string,
  body: Record<string, unknown> = {},
): Promise<{ data: T | null; status: number; raw: Response }> {
  const secret = await getCronSecret();
  if (!secret) {
    throw new Error(
      'Could not read CRON_SECRET via test_get_cron_secret RPC. Ensure the migration has been applied and the test runner has service-role access.',
    );
  }
  const res = await fetch(`${SUPABASE_URL}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  let data: T | null = null;
  try {
    data = (await res.clone().json()) as T;
  } catch {
    // Non-JSON body (rare for our edge functions) — leave data null.
  }
  return { data, status: res.status, raw: res };
}
