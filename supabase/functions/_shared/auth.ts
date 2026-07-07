// Shared caller-identity verification for edge functions.
//
// Replaces the ~6-line `createClient(...).auth.getUser()` dance that every
// user-facing function used to hand-roll (and its Bearer-normalize variants).
// `requireUser` verifies the caller's JWT and returns their user id (the `sub`
// claim), throwing HttpError(401) through the standard handleError path on any
// failure.
//
// Uses getClaims() instead of getUser(): once the project rotates to an
// asymmetric JWT signing key, getClaims verifies the token LOCALLY against the
// cached JWKS with no GoTrue round-trip. Until then it transparently falls back
// to a remote call — identical behavior to the getUser() it replaces — so this
// is safe to ship before the key rotation.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { HttpError } from './http.ts';

// Module-level client: getClaims() takes the token explicitly, so verification
// never touches per-request session state — one shared client is safe across
// concurrent requests and avoids re-constructing a client on every call.
const authClient = createClient(
  Deno.env.get('SUPABASE_URL') ?? '',
  Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
  { auth: { persistSession: false, autoRefreshToken: false } },
);

/**
 * Verifies the caller's `Authorization` bearer JWT and returns their user id.
 * Throws HttpError('Unauthorized', 401) on a missing, malformed, or expired
 * token. The returned `{ id }` is shaped so callers can assign it to `user`
 * and keep using `user.id` downstream.
 */
export async function requireUser(req: Request): Promise<{ id: string }> {
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) throw new HttpError('Unauthorized', 401);

  const { data, error } = await authClient.auth.getClaims(token);
  const sub = data?.claims?.sub;
  if (error || !sub) throw new HttpError('Unauthorized', 401);

  return { id: sub };
}
