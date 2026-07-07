import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyLeague } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const VALID_QUESTION_TYPES = [
  'multiple_choice_single',
  'multiple_choice_multi',
  'free_text',
  'rating',
  'ranked_choice',
] as const;

const QuestionSchema = z.object({
  prompt: z.string().trim().min(1, 'prompt must be 1-500 characters').max(500, 'prompt must be 1-500 characters'),
  type: z.enum(VALID_QUESTION_TYPES),
  options: z.array(z.string().trim().min(1, 'each option must be 1-200 characters').max(200, 'each option must be 1-200 characters')).optional(),
  required: z.boolean().optional(),
});

const Body = z.object({
  league_id: z.string().uuid(),
  conversation_id: z.string().uuid(),
  title: z.string().trim().min(1, 'Title must be 1-200 characters').max(200, 'Title must be 1-200 characters'),
  description: z.string().trim().max(1000, 'Description must be 1000 characters or fewer').optional(),
  questions: z.array(QuestionSchema).min(1, 'Must have 1-20 questions').max(20, 'Must have 1-20 questions'),
  closes_at: z.string().min(1),
  results_visibility: z.enum(['everyone', 'commissioner']).optional(),
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

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'create-survey');
    if (rateLimited) return rateLimited;

    const {
      league_id,
      conversation_id,
      title,
      description,
      questions,
      closes_at,
      results_visibility,
    } = await req.json();

    // Validate required fields
    if (!league_id || !conversation_id || !title || !questions || !closes_at) {
      throw new HttpError('league_id, conversation_id, title, questions, and closes_at are required');
    }

    // Validate title
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > 200) {
      throw new HttpError('Title must be 1-200 characters');
    }

    // Validate description
    const trimmedDescription = (description ?? '').trim();
    if (trimmedDescription.length > 1000) {
      throw new HttpError('Description must be 1000 characters or fewer');
    }

    // Validate results_visibility
    const vis = results_visibility ?? 'commissioner';
    if (vis !== 'everyone' && vis !== 'commissioner') {
      throw new HttpError('results_visibility must be "everyone" or "commissioner"');
    }

    // Validate closes_at
    const closesDate = new Date(closes_at);
    if (isNaN(closesDate.getTime()) || closesDate <= new Date()) {
      throw new HttpError('closes_at must be a valid future timestamp');
    }

    // Validate questions
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 20) {
      throw new HttpError('Must have 1-20 questions');
    }

    const validatedQuestions = questions.map((q: any, i: number) => {
      if (!q.prompt || typeof q.prompt !== 'string') {
        throw new HttpError(`Question ${i + 1}: prompt is required`);
      }
      const prompt = q.prompt.trim();
      if (prompt.length === 0 || prompt.length > 500) {
        throw new HttpError(`Question ${i + 1}: prompt must be 1-500 characters`);
      }

      if (!VALID_QUESTION_TYPES.includes(q.type)) {
        throw new HttpError(`Question ${i + 1}: invalid type "${q.type}"`);
      }

      // Validate options for types that need them
      let options: string[] | null = null;
      if (q.type === 'multiple_choice_single' || q.type === 'multiple_choice_multi') {
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10) {
          throw new HttpError(`Question ${i + 1}: multiple choice requires 2-10 options`);
        }
        options = q.options.map((o: string) => {
          if (typeof o !== 'string' || o.trim().length === 0 || o.trim().length > 200) {
            throw new HttpError(`Question ${i + 1}: each option must be 1-200 characters`);
          }
          return o.trim();
        });
      } else if (q.type === 'ranked_choice') {
        if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 10) {
          throw new HttpError(`Question ${i + 1}: ranked choice requires 3-10 options`);
        }
        options = q.options.map((o: string) => {
          if (typeof o !== 'string' || o.trim().length === 0 || o.trim().length > 200) {
            throw new HttpError(`Question ${i + 1}: each option must be 1-200 characters`);
          }
          return o.trim();
        });
      }

      return {
        sort_order: i,
        type: q.type,
        prompt,
        options,
        required: q.required !== false, // default true
      };
    });

    // Verify commissioner
    const { data: league } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name')
      .eq('id', league_id)
      .single();
    if (league?.created_by !== user.id) {
      throw new HttpError('Only the commissioner can create surveys.', 403);
    }

    // Verify conversation belongs to this league and is a league chat
    const { data: conv } = await supabaseAdmin
      .from('chat_conversations')
      .select('id, league_id, type')
      .eq('id', conversation_id)
      .single();
    if (!conv || conv.league_id !== league_id || conv.type !== 'league') {
      throw new HttpError('Surveys can only be created in league chat.');
    }

    // Get commissioner's team_id
    const { data: commTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .single();
    if (!commTeam) throw new HttpError('Commissioner team not found.', 404);

    // 1. Insert survey
    const { data: survey, error: surveyError } = await supabaseAdmin
      .from('commissioner_surveys')
      .insert({
        league_id,
        conversation_id,
        team_id: commTeam.id,
        title: trimmedTitle,
        description: trimmedDescription,
        results_visibility: vis,
        closes_at: closesDate.toISOString(),
      })
      .select('id')
      .single();
    if (surveyError) throw surveyError;

    // 2. Batch insert questions
    const questionRows = validatedQuestions.map((q: any) => ({
      survey_id: survey.id,
      ...q,
    }));
    const { error: qError } = await supabaseAdmin
      .from('survey_questions')
      .insert(questionRows);
    if (qError) throw qError;

    // 3. Insert chat message anchoring the survey
    const { data: msg, error: msgError } = await supabaseAdmin
      .from('chat_messages')
      .insert({
        conversation_id,
        team_id: commTeam.id,
        content: survey.id,
        type: 'survey',
        league_id,
      })
      .select('id')
      .single();
    if (msgError) throw msgError;

    // 4. Update survey with message back-reference
    await supabaseAdmin
      .from('commissioner_surveys')
      .update({ message_id: msg.id })
      .eq('id', survey.id);

    // 5. Send push notification (fire-and-forget)
    try {
      const ln = league?.name ?? 'Your League';
      const preview = trimmedTitle.length > 100
        ? trimmedTitle.slice(0, 100) + '...'
        : trimmedTitle;
      await notifyLeague(
        supabaseAdmin,
        league_id,
        'commissioner',
        `${ln} — New Survey`,
        preview,
        { screen: `chat/${conversation_id}` }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    return jsonResponse({ survey_id: survey.id, message_id: msg.id });
  } catch (error) {
    return handleError(error, 'create-survey');
  }
});
