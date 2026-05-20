import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  poll_id: z.string().uuid('poll_id must be a valid UUID'),
  selections: z.array(z.number().int().nonnegative()).min(1, 'selections must be a non-empty array of option indices'),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Verify JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new HttpError('Unauthorized', 401);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'vote-poll');
    if (rateLimited) return rateLimited;

    const { poll_id, selections } = parseBody(Body, await req.json());

    // Fetch poll
    const { data: poll } = await supabaseAdmin
      .from('commissioner_polls')
      .select('*')
      .eq('id', poll_id)
      .single();
    if (!poll) throw new HttpError('Poll not found', 404);

    // Verify user is a league member with a team
    const { data: voterTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', poll.league_id)
      .eq('user_id', user.id)
      .single();
    if (!voterTeam) throw new HttpError('You are not a member of this league.', 403);

    // Check poll is still open
    if (new Date() >= new Date(poll.closes_at)) {
      throw new HttpError('This poll has closed.');
    }

    // Validate selections against this poll's options (index bounds + dupes
    // depend on poll.options, which is only known after the DB fetch).
    const optCount = (poll.options as string[]).length;
    if (new Set(selections).size !== selections.length) {
      throw new HttpError('Duplicate selections are not allowed');
    }
    for (const idx of selections) {
      if (idx >= optCount) {
        throw new HttpError(`Invalid selection index: ${idx}. Must be 0-${optCount - 1}`);
      }
    }
    if (poll.poll_type === 'single' && selections.length !== 1) {
      throw new HttpError('Single-choice polls require exactly one selection');
    }

    // Insert vote (UNIQUE constraint prevents double-voting)
    const { error: voteError } = await supabaseAdmin
      .from('poll_votes')
      .insert({
        poll_id,
        team_id: voterTeam.id,
        selections,
      });

    if (voteError) {
      if (voteError.code === '23505') {
        throw new HttpError('You have already voted on this poll.', 409);
      }
      throw voteError;
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return handleError(error, 'vote-poll');
  }
});
