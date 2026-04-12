import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify JWT
    const authHeader = req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader : `Bearer ${authHeader}`;
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: token ?? '' } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'vote-poll');
    if (rateLimited) return rateLimited;

    const { poll_id, selections } = await req.json();
    if (!poll_id || !selections) {
      throw new Error('poll_id and selections are required');
    }

    // Fetch poll
    const { data: poll } = await supabaseAdmin
      .from('commissioner_polls')
      .select('*')
      .eq('id', poll_id)
      .single();
    if (!poll) throw new Error('Poll not found');

    // Verify user is a league member with a team
    const { data: voterTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', poll.league_id)
      .eq('user_id', user.id)
      .single();
    if (!voterTeam) throw new Error('You are not a member of this league.');

    // Check poll is still open
    if (new Date() >= new Date(poll.closes_at)) {
      throw new Error('This poll has closed.');
    }

    // Validate selections
    if (!Array.isArray(selections) || selections.length === 0) {
      throw new Error('selections must be a non-empty array of option indices');
    }

    const optCount = (poll.options as string[]).length;
    const uniqueSelections = [...new Set(selections)];
    if (uniqueSelections.length !== selections.length) {
      throw new Error('Duplicate selections are not allowed');
    }

    for (const idx of selections) {
      if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= optCount) {
        throw new Error(`Invalid selection index: ${idx}. Must be 0-${optCount - 1}`);
      }
    }

    if (poll.poll_type === 'single' && selections.length !== 1) {
      throw new Error('Single-choice polls require exactly one selection');
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
        throw new Error('You have already voted on this poll.');
      }
      throw new Error(`Failed to record vote: ${voteError.message}`);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('vote-poll error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
