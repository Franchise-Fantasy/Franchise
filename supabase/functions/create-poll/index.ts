import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from '../_shared/push.ts';
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

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'create-poll');
    if (rateLimited) return rateLimited;

    const {
      league_id,
      conversation_id,
      question,
      options,
      poll_type,
      closes_at,
      is_anonymous,
      show_live_results,
    } = await req.json();

    // Validate required fields
    if (!league_id || !conversation_id || !question || !options || !poll_type || !closes_at) {
      throw new Error('league_id, conversation_id, question, options, poll_type, and closes_at are required');
    }

    // Validate question
    const trimmedQuestion = question.trim();
    if (trimmedQuestion.length === 0 || trimmedQuestion.length > 500) {
      throw new Error('Question must be 1-500 characters');
    }

    // Validate options
    if (!Array.isArray(options) || options.length < 2 || options.length > 10) {
      throw new Error('Must have 2-10 options');
    }
    for (const opt of options) {
      if (typeof opt !== 'string' || opt.trim().length === 0 || opt.trim().length > 200) {
        throw new Error('Each option must be 1-200 characters');
      }
    }
    const trimmedOptions = options.map((o: string) => o.trim());

    // Validate poll_type
    if (poll_type !== 'single' && poll_type !== 'multi') {
      throw new Error('poll_type must be "single" or "multi"');
    }

    // Validate closes_at is in the future
    const closesDate = new Date(closes_at);
    if (isNaN(closesDate.getTime()) || closesDate <= new Date()) {
      throw new Error('closes_at must be a valid future timestamp');
    }

    // Verify commissioner
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name')
      .eq('id', league_id)
      .single();
    if (league?.created_by !== user.id) {
      throw new Error('Only the commissioner can create polls.');
    }

    // Verify conversation belongs to this league and is a league chat
    const { data: conv } = await supabaseAdmin
      .from('chat_conversations')
      .select('id, league_id, type')
      .eq('id', conversation_id)
      .single();
    if (!conv || conv.league_id !== league_id || conv.type !== 'league') {
      throw new Error('Polls can only be created in league chat.');
    }

    // Get commissioner's team_id
    const { data: commTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .single();
    if (!commTeam) throw new Error('Commissioner team not found.');

    // 1. Insert poll
    const { data: poll, error: pollError } = await supabaseAdmin
      .from('commissioner_polls')
      .insert({
        league_id,
        conversation_id,
        team_id: commTeam.id,
        question: trimmedQuestion,
        poll_type,
        options: trimmedOptions,
        closes_at: closesDate.toISOString(),
        is_anonymous: is_anonymous ?? false,
        show_live_results: show_live_results ?? true,
      })
      .select('id')
      .single();
    if (pollError) throw new Error(`Failed to create poll: ${pollError.message}`);

    // 2. Insert chat message anchoring the poll
    const { data: msg, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        conversation_id,
        team_id: commTeam.id,
        content: poll.id,
        type: 'poll',
      })
      .select('id')
      .single();
    if (msgError) throw new Error(`Failed to create chat message: ${msgError.message}`);

    // 3. Update poll with message back-reference
    await supabaseAdmin
      .from('commissioner_polls')
      .update({ message_id: msg.id })
      .eq('id', poll.id);

    // 4. Send push notification (fire-and-forget)
    try {
      const ln = league?.name ?? 'Your League';
      const preview = trimmedQuestion.length > 100
        ? trimmedQuestion.slice(0, 100) + '...'
        : trimmedQuestion;
      await notifyLeague(
        supabaseAdmin,
        league_id,
        'commissioner',
        `${ln} — New Poll`,
        preview,
        { screen: `chat/${conversation_id}` }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return new Response(
      JSON.stringify({ poll_id: poll.id, message_id: msg.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('create-poll error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
