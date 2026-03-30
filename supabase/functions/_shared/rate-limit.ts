import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { CORS_HEADERS } from './cors.ts';

interface RateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
}

const RATE_LIMITS: Record<string, RateLimitConfig> = {
  // Draft: generous during active draft
  'make-draft-pick':          { maxRequests: 30, windowSeconds: 60 },

  // One-time commissioner actions: tight
  'generate-schedule':        { maxRequests: 3,  windowSeconds: 300 },
  'advance-season':           { maxRequests: 3,  windowSeconds: 300 },
  'start-draft':              { maxRequests: 3,  windowSeconds: 300 },
  'start-lottery':            { maxRequests: 3,  windowSeconds: 300 },
  'create-rookie-draft':      { maxRequests: 3,  windowSeconds: 300 },
  'run-lottery':              { maxRequests: 3,  windowSeconds: 300 },
  'finalize-keepers':         { maxRequests: 3,  windowSeconds: 300 },
  'generate-playoff-round':   { maxRequests: 5,  windowSeconds: 300 },

  // Trade actions: moderate
  'execute-trade':            { maxRequests: 10, windowSeconds: 60 },
  'reverse-trade':            { maxRequests: 5,  windowSeconds: 60 },

  // Social/voting: moderate
  'vote-poll':                { maxRequests: 10, windowSeconds: 60 },
  'create-poll':              { maxRequests: 5,  windowSeconds: 300 },
  'send-notification':        { maxRequests: 10, windowSeconds: 60 },

  // Commissioner roster actions: moderate
  'commissioner-action':      { maxRequests: 10, windowSeconds: 60 },
  'submit-seed-pick':         { maxRequests: 10, windowSeconds: 60 },

  // Import: tight (heavy operation)
  'import-sleeper-league':    { maxRequests: 3,  windowSeconds: 300 },
  'import-screenshot-league': { maxRequests: 30, windowSeconds: 600 },
  'import-extract':           { maxRequests: 10, windowSeconds: 300 }, // Claude Vision calls

  // Bidding wars / autopick: moderate
  'check-bidding-wars':       { maxRequests: 10, windowSeconds: 60 },
  'trigger-autopick':         { maxRequests: 10, windowSeconds: 60 },

  // Scoring: moderate (heavy computation)
  'get-week-scores':          { maxRequests: 5,  windowSeconds: 60 },

  // Commissioner: moderate
  'mark-payment':             { maxRequests: 10, windowSeconds: 60 },

  // Media: moderate (AI moderation cost)
  'upload-team-logo':         { maxRequests: 5,  windowSeconds: 300 },
  'upload-chat-media':        { maxRequests: 10, windowSeconds: 60 },

  // Account: very tight
  'delete-account':           { maxRequests: 1,  windowSeconds: 3600 },

  // Admin
  'manage-subscription':      { maxRequests: 5,  windowSeconds: 300 },
};

const DEFAULT_LIMIT: RateLimitConfig = { maxRequests: 15, windowSeconds: 60 };

/**
 * Check rate limit for a user calling a specific edge function.
 * Returns null if allowed, or a 429 Response if rate limited.
 * Fail-open: if the check errors, the request proceeds.
 */
export async function checkRateLimit(
  supabase: SupabaseClient,
  userId: string,
  functionName: string,
): Promise<Response | null> {
  const config = RATE_LIMITS[functionName] ?? DEFAULT_LIMIT;

  try {
    const { data, error } = await supabase.rpc('check_rate_limit', {
      p_user_id: userId,
      p_function_name: functionName,
      p_window_seconds: config.windowSeconds,
      p_max_requests: config.maxRequests,
    });

    if (error) {
      console.warn('Rate limit check failed (allowing request):', error.message);
      return null;
    }

    const result = data as { allowed: boolean; current_count: number; retry_after: number };

    if (result.allowed) return null;

    return new Response(
      JSON.stringify({
        error: 'Too many requests. Please try again later.',
        retry_after: result.retry_after,
      }),
      {
        status: 429,
        headers: {
          ...CORS_HEADERS,
          'Content-Type': 'application/json',
          'Retry-After': String(result.retry_after),
        },
      },
    );
  } catch (err) {
    console.warn('Rate limit check threw (allowing request):', err);
    return null;
  }
}
