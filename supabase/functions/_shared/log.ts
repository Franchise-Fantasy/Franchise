// Structured logger for Supabase edge functions. Output is JSON per line so it's
// greppable in the Supabase dashboard. log.error additionally fires a fire-and-forget
// POST to PostHog's /capture/ endpoint as a $exception event, but only when
// POSTHOG_API_KEY is set in the function's secrets — missing key is a silent no-op
// so functions don't break in environments without it.

type Level = "info" | "warn" | "error";
type LogContext = Record<string, unknown>;

const POSTHOG_API_KEY = Deno.env.get("POSTHOG_API_KEY");
const POSTHOG_HOST =
  Deno.env.get("POSTHOG_HOST") ?? "https://us.i.posthog.com";

function emit(level: Level, fn: string, message: string, context?: LogContext) {
  const entry = {
    level,
    fn,
    msg: message,
    ts: new Date().toISOString(),
    ...(context ?? {}),
  };
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

function captureToPostHog(
  fn: string,
  message: string,
  context: LogContext,
): void {
  if (!POSTHOG_API_KEY) return;
  fetch(`${POSTHOG_HOST}/capture/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: POSTHOG_API_KEY,
      event: "$exception",
      distinct_id: `edge-fn:${fn}`,
      properties: {
        $exception_type: "EdgeFunctionError",
        $exception_message: message,
        function: fn,
        ...context,
      },
    }),
  }).catch(() => {
    // Never let PostHog availability impact the function's primary work.
  });
}

function errorContext(error: unknown, extra?: LogContext): LogContext {
  if (error instanceof Error) {
    return {
      ...(extra ?? {}),
      error_message: error.message,
      error_stack: error.stack,
    };
  }
  if (error !== undefined) {
    return { ...(extra ?? {}), error: String(error) };
  }
  return { ...(extra ?? {}) };
}

export interface Logger {
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;
  error(message: string, error?: unknown, context?: LogContext): void;
}

export function createLogger(fn: string): Logger {
  return {
    info(message, context) {
      emit("info", fn, message, context);
    },
    warn(message, context) {
      emit("warn", fn, message, context);
    },
    error(message, error, context) {
      const ctx = errorContext(error, context);
      emit("error", fn, message, ctx);
      captureToPostHog(fn, message, ctx);
    },
  };
}
