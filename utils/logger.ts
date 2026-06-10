// Structured client-side logger. Mirrors the API of supabase/functions/_shared/log.ts
// so the mental model matches edge functions:
//   logger.info / warn / error / debug, with optional context object.
//
// Behaviour:
//   - In __DEV__: prints to console.* with a [tag] prefix.
//   - In production: debug + info are dropped; warn + error are no-ops.
//
// There is no production sink today (Sentry was removed). If prod error
// reporting is wanted again, route warn/error here to PostHog or another
// service rather than re-adding a native crash-reporting SDK.

type LogContext = Record<string, unknown>;

function errorContext(error: unknown, extra?: LogContext): LogContext {
  if (error instanceof Error) {
    return { ...(extra ?? {}), error_message: error.message, error_stack: error.stack };
  }
  if (error !== undefined) return { ...(extra ?? {}), error: String(error) };
  return { ...(extra ?? {}) };
}

// Accepts either a plain context object or an Error/string — Errors get expanded.
function normalizeContext(input?: unknown): LogContext | undefined {
  if (input === undefined) return undefined;
  if (input instanceof Error) return errorContext(input);
  if (typeof input === 'object' && input !== null) return input as LogContext;
  return { value: String(input) };
}

export interface Logger {
  debug(message: string, context?: unknown): void;
  info(message: string, context?: unknown): void;
  warn(message: string, context?: unknown): void;
  error(message: string, error?: unknown, context?: LogContext): void;
}

export function createLogger(fn: string): Logger {
  const tag = `[${fn}]`;
  return {
    debug(message, context) {
      if (!__DEV__) return;
      const ctx = normalizeContext(context);
      console.debug(tag, message, ctx ?? '');
    },
    info(message, context) {
      if (!__DEV__) return;
      const ctx = normalizeContext(context);
      console.info(tag, message, ctx ?? '');
    },
    warn(message, context) {
      if (!__DEV__) return;
      const ctx = normalizeContext(context);
      console.warn(tag, message, ctx ?? '');
    },
    error(message, error, context) {
      if (!__DEV__) return;
      const ctx = errorContext(error, context);
      console.error(tag, message, error, ctx);
    },
  };
}

// Default logger for callers that don't want to name their own scope.
export const logger: Logger = createLogger('app');
