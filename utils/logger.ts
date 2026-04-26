// Structured client-side logger. Mirrors the API of supabase/functions/_shared/log.ts
// so the mental model matches edge functions:
//   logger.info / warn / error / debug, with optional context object.
//
// Behaviour:
//   - In __DEV__: prints to console.* with a [tag] prefix.
//   - In production: debug + info are dropped; warn → Sentry breadcrumb;
//     error → Sentry.captureException.
//
// Sentry is loaded lazily so this module is safe to import from anywhere,
// even before the SDK is initialized in app/_layout.tsx.

type LogContext = Record<string, unknown>;

let sentryCache: unknown = null;
function getSentry(): { addBreadcrumb: Function; captureException: Function } | null {
  if (sentryCache !== null) {
    return sentryCache as { addBreadcrumb: Function; captureException: Function } | null;
  }
  try {
    sentryCache = require('@sentry/react-native');
  } catch {
    sentryCache = false;
  }
  return sentryCache ? (sentryCache as { addBreadcrumb: Function; captureException: Function }) : null;
}

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
      const ctx = normalizeContext(context);
      if (__DEV__) console.warn(tag, message, ctx ?? '');
      const Sentry = getSentry();
      if (Sentry) {
        try {
          Sentry.addBreadcrumb({ level: 'warning', category: fn, message, data: ctx });
        } catch {
          // Sentry not initialized yet — drop the breadcrumb silently.
        }
      }
    },
    error(message, error, context) {
      const ctx = errorContext(error, context);
      if (__DEV__) console.error(tag, message, error, ctx);
      const Sentry = getSentry();
      if (Sentry) {
        try {
          Sentry.captureException(error ?? new Error(message), {
            tags: { fn },
            extra: { msg: message, ...ctx },
          });
        } catch {
          // Sentry not initialized — drop silently.
        }
      }
    },
  };
}

// Default logger for callers that don't want to name their own scope.
export const logger: Logger = createLogger('app');
