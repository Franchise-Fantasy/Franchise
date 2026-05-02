import http from 'k6/http';

import { SUPABASE_URL, ANON_KEY, SB_SECRET_KEY } from './config.js';

function jsonHeaders(jwt, extra = {}) {
  return {
    apikey: ANON_KEY,
    Authorization: `Bearer ${jwt}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

export function edgeFn(name, body, jwt, extraHeaders = {}) {
  return http.post(
    `${SUPABASE_URL}/functions/v1/${name}`,
    JSON.stringify(body ?? {}),
    {
      headers: jsonHeaders(jwt, extraHeaders),
      tags: { endpoint: name },
    },
  );
}

// Server-side edge fn invocation using the service role key (no user JWT).
// Used for poll-live-stats and other cron/server-secret functions.
export function serverEdgeFn(name, body) {
  if (!SB_SECRET_KEY) throw new Error(`serverEdgeFn(${name}) needs SB_SECRET_KEY env var`);
  return http.post(
    `${SUPABASE_URL}/functions/v1/${name}`,
    JSON.stringify(body ?? {}),
    {
      headers: {
        apikey: SB_SECRET_KEY,
        Authorization: `Bearer ${SB_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: `server:${name}` },
    },
  );
}

export function rpc(name, args, jwt) {
  return http.post(
    `${SUPABASE_URL}/rest/v1/rpc/${name}`,
    JSON.stringify(args ?? {}),
    {
      headers: jsonHeaders(jwt),
      tags: { endpoint: `rpc:${name}` },
    },
  );
}

// REST table read: e.g. restFrom('teams', 'select=id,name&league_id=eq.xyz', jwt)
export function restFrom(table, query, jwt) {
  return http.get(
    `${SUPABASE_URL}/rest/v1/${table}?${query}`,
    {
      headers: jsonHeaders(jwt),
      tags: { endpoint: `rest:${table}` },
    },
  );
}

// REST table insert. Requires user JWT (subject to RLS) OR service-role key.
export function restInsert(table, rows, jwt, extraHeaders = {}) {
  return http.post(
    `${SUPABASE_URL}/rest/v1/${table}`,
    JSON.stringify(rows),
    {
      headers: jsonHeaders(jwt, { Prefer: 'return=representation', ...extraHeaders }),
      tags: { endpoint: `rest_insert:${table}` },
    },
  );
}

// REST table delete. Caller controls the filter via query string.
export function restDelete(table, query, jwt) {
  return http.del(
    `${SUPABASE_URL}/rest/v1/${table}?${query}`,
    null,
    {
      headers: jsonHeaders(jwt),
      tags: { endpoint: `rest_delete:${table}` },
    },
  );
}

// Convenience: hit the same endpoint as serverEdgeFn but using the service-role
// REST surface (bypasses RLS). Used in cleanup helpers.
export function adminRpc(name, args) {
  if (!SB_SECRET_KEY) throw new Error('adminRpc needs SB_SECRET_KEY');
  return http.post(
    `${SUPABASE_URL}/rest/v1/rpc/${name}`,
    JSON.stringify(args ?? {}),
    {
      headers: {
        apikey: SB_SECRET_KEY,
        Authorization: `Bearer ${SB_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: `admin_rpc:${name}` },
    },
  );
}

export function adminDelete(table, query) {
  if (!SB_SECRET_KEY) throw new Error('adminDelete needs SB_SECRET_KEY');
  return http.del(
    `${SUPABASE_URL}/rest/v1/${table}?${query}`,
    null,
    {
      headers: {
        apikey: SB_SECRET_KEY,
        Authorization: `Bearer ${SB_SECRET_KEY}`,
        'Content-Type': 'application/json',
      },
      tags: { endpoint: `admin_delete:${table}` },
    },
  );
}

export function adminSelect(table, query) {
  if (!SB_SECRET_KEY) throw new Error('adminSelect needs SB_SECRET_KEY');
  return http.get(
    `${SUPABASE_URL}/rest/v1/${table}?${query}`,
    {
      headers: {
        apikey: SB_SECRET_KEY,
        Authorization: `Bearer ${SB_SECRET_KEY}`,
      },
      tags: { endpoint: `admin_select:${table}` },
    },
  );
}
