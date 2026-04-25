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
