// Input validation for edge functions. Pairs with _shared/http.ts —
// validation failures throw HttpError(400, "<path>: <message>") which
// handleError() surfaces to the client.
//
// Schemas live alongside each function's handler. Define a `Body` (or named
// schema) at the top of index.ts, then call `parseBody(Body, await req.json())`.
// The returned value is fully typed via `z.infer`, so you get autocomplete and
// no drift between validator and TS types.
//
// Common schemas (uuid, league_id) can be hoisted to a _shared/schemas.ts
// later if duplication grows. For now, each function imports `z` directly so
// schemas stay co-located with the handler they validate.

import { z } from 'https://esm.sh/zod@3.23.8';

import { HttpError } from './http.ts';

export { z };

/**
 * Parses a request body against a Zod schema. On failure, throws an
 * `HttpError(400, "<path>: <message>")` so the catch block routes it through
 * `handleError`. On success, returns the typed value.
 *
 * The error message extracts the FIRST issue (Zod accumulates all), since
 * surfacing one specific actionable error matches the existing UX better than
 * dumping the full issues array.
 */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;

  const issue = result.error.issues[0];
  const path = issue.path.join('.');
  const message = path ? `${path}: ${issue.message}` : issue.message;
  throw new HttpError(message, 400);
}
