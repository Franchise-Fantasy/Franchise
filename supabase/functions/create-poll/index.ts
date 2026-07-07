import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  league_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  question: z.string().trim().min(1, 'Question must be 1-500 characters').max(500, 'Question must be 1-500 characters'),
  options: z.array(z.string().trim().min(1, 'Each option must be 1-200 characters').max(200, 'Each option must be 1-200 characters'))
    .min(2, 'Must have 2-10 options')
    .max(10, 'Must have 2-10 options'),
  poll_type: z.enum(['single', 'multi']),
  closes_at: z.string().datetime({ message: 'closes_at must be a valid ISO timestamp' }),
  is_anonymous: z.boolean().optional(),
  show_live_results: z.boolean().optional(),
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Verify JWT
    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'create-poll');
    if (rateLimited) return rateLimited;

    const {
      league_id,
      conversation_id,
      question: trimmedQuestion,
      options: trimmedOptions,
      poll_type,
      closes_at,
      is_anonymous,
      show_live_results,
    } = parseBody(Body, await req.json());

    // closes_at must be in the future — schema only validates ISO format.
    const closesDate = new Date(closes_at);
    if (closesDate <= new Date()) {
      throw new HttpError('closes_at must be a valid future timestamp');
    }

    // Verify commissioner
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name')
      .eq('id', league_id)
      .single();
    if (league?.created_by !== user.id) {
      throw new HttpError('Only the commissioner can create polls.', 403);
    }

    // Verify conversation belongs to this league and is a league chat
    const { data: conv } = await supabaseAdmin
      .from('chat_conversations')
      .select('id, league_id, type')
      .eq('id', conversation_id)
      .single();
    if (!conv || conv.league_id !== league_id || conv.type !== 'league') {
      throw new HttpError('Polls can only be created in league chat.');
    }

    // Get commissioner's team_id
    const { data: commTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .single();
    if (!commTeam) throw new HttpError('Commissioner team not found.', 404);

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
    if (pollError) throw pollError;

    // 2. Insert chat message anchoring the poll
    const { data: msg, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        conversation_id,
        team_id: commTeam.id,
        content: poll.id,
        type: 'poll',
        league_id,
      })
      .select('id')
      .single();
    if (msgError) throw msgError;

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

    return jsonResponse({ poll_id: poll.id, message_id: msg.id });
  } catch (error) {
    return handleError(error, 'create-poll');
  }
});
