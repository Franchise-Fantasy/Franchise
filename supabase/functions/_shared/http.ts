// Standardized HTTP responses for edge functions. Pairs with _shared/cors.ts
// (which still owns the OPTIONS preflight via corsResponse()).
//
// HttpError is the contract that lets a catch block tell an EXPECTED failure
// (validation, auth, conflict — message is safe to show the client) from an
// UNEXPECTED one (a raw DB error, a null deref — message is hidden behind a
// generic 500 and logged). Throw HttpError for anything the caller did wrong;
// let everything else bubble to handleError as a 500.

import { CORS_HEADERS } from './cors.ts';
import { createLogger } from './log.ts';

const JSON_HEADERS = { ...CORS_HEADERS, 'Content-Type': 'application/json' };

export class HttpError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status);
}

// Maps a thrown value to a Response: HttpError → its status + message;
// anything else → 500 with a generic message, real error logged + captured.
export function handleError(error: unknown, fnName: string): Response {
  if (error instanceof HttpError) {
    return errorResponse(error.message, error.status);
  }
  createLogger(fnName).error('Unhandled error', error);
  return errorResponse('Internal server error', 500);
}
