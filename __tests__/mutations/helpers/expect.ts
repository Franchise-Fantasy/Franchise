/* eslint-disable @typescript-eslint/no-explicit-any */
// Rich error assertions for supabase.functions.invoke results.
//
// supabase-js wraps non-2xx responses in `FunctionsHttpError` and stashes the
// real status + body on `error.context` (a Response). Reading the body is
// async and clobbers the stream, so we cache the parsed body on first read.
//
// These helpers make negative tests express intent — "I expect 403 with
// /not the commissioner/" — rather than just "error was non-null", which is
// satisfied by any failure including DB crashes and 500s.

interface InvokeResult {
  data: any;
  error: any;
}

interface ErrorBody {
  error?: string;
  [k: string]: unknown;
}

async function readErrorBody(error: any): Promise<ErrorBody | null> {
  if (!error) return null;
  // Cache after first read.
  if (error.__parsedBody !== undefined) return error.__parsedBody;
  try {
    const ctx = error.context as Response | undefined;
    if (!ctx || typeof ctx.json !== 'function') {
      error.__parsedBody = null;
      return null;
    }
    const body = (await ctx.json()) as ErrorBody;
    error.__parsedBody = body;
    return body;
  } catch {
    error.__parsedBody = null;
    return null;
  }
}

/**
 * Assert a `functions.invoke` result represents an HTTP error.
 *
 * Options:
 * - `status`: exact status code (e.g. 400, 403, 404, 409). Verified against
 *   `error.context.status`.
 * - `messageMatch`: substring or RegExp the response body's `error` field
 *   should match. Surfaces the actual message in the assertion failure if
 *   it doesn't, so debugging doesn't require digging into FunctionsHttpError.
 */
export async function expectHttpError(
  result: InvokeResult,
  opts: { status?: number; messageMatch?: string | RegExp } = {},
): Promise<void> {
  expect(result.error).not.toBeNull();
  if (!result.error) return; // unreachable, but narrows the type

  if (opts.status !== undefined) {
    const actualStatus = (result.error.context as Response | undefined)?.status;
    if (actualStatus !== opts.status) {
      const body = await readErrorBody(result.error);
      throw new Error(
        `expectHttpError: expected status ${opts.status}, got ${actualStatus}. Body: ${JSON.stringify(body)}`,
      );
    }
  }

  if (opts.messageMatch !== undefined) {
    const body = await readErrorBody(result.error);
    const message = body?.error ?? '';
    const matches =
      typeof opts.messageMatch === 'string'
        ? message.includes(opts.messageMatch)
        : opts.messageMatch.test(message);
    if (!matches) {
      throw new Error(
        `expectHttpError: expected message to match ${opts.messageMatch}, got: "${message}"`,
      );
    }
  }
}
