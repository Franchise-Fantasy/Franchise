import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { notifyLeague } from '../_shared/push.ts';
import { corsResponse } from '../_shared/cors.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';

const VALID_QUESTION_TYPES = [
  'multiple_choice_single',
  'multiple_choice_multi',
  'free_text',
  'rating',
  'ranked_choice',
] as const;

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
      throw new Error('league_id, conversation_id, title, questions, and closes_at are required');
    }

    // Validate title
    const trimmedTitle = title.trim();
    if (trimmedTitle.length === 0 || trimmedTitle.length > 200) {
      throw new Error('Title must be 1-200 characters');
    }

    // Validate description
    const trimmedDescription = (description ?? '').trim();
    if (trimmedDescription.length > 1000) {
      throw new Error('Description must be 1000 characters or fewer');
    }

    // Validate results_visibility
    const vis = results_visibility ?? 'commissioner';
    if (vis !== 'everyone' && vis !== 'commissioner') {
      throw new Error('results_visibility must be "everyone" or "commissioner"');
    }

    // Validate closes_at
    const closesDate = new Date(closes_at);
    if (isNaN(closesDate.getTime()) || closesDate <= new Date()) {
      throw new Error('closes_at must be a valid future timestamp');
    }

    // Validate questions
    if (!Array.isArray(questions) || questions.length < 1 || questions.length > 20) {
      throw new Error('Must have 1-20 questions');
    }

    const validatedQuestions = questions.map((q: any, i: number) => {
      if (!q.prompt || typeof q.prompt !== 'string') {
        throw new Error(`Question ${i + 1}: prompt is required`);
      }
      const prompt = q.prompt.trim();
      if (prompt.length === 0 || prompt.length > 500) {
        throw new Error(`Question ${i + 1}: prompt must be 1-500 characters`);
      }

      if (!VALID_QUESTION_TYPES.includes(q.type)) {
        throw new Error(`Question ${i + 1}: invalid type "${q.type}"`);
      }

      // Validate options for types that need them
      let options: string[] | null = null;
      if (q.type === 'multiple_choice_single' || q.type === 'multiple_choice_multi') {
        if (!Array.isArray(q.options) || q.options.length < 2 || q.options.length > 10) {
          throw new Error(`Question ${i + 1}: multiple choice requires 2-10 options`);
        }
        options = q.options.map((o: string) => {
          if (typeof o !== 'string' || o.trim().length === 0 || o.trim().length > 200) {
            throw new Error(`Question ${i + 1}: each option must be 1-200 characters`);
          }
          return o.trim();
        });
      } else if (q.type === 'ranked_choice') {
        if (!Array.isArray(q.options) || q.options.length < 3 || q.options.length > 10) {
          throw new Error(`Question ${i + 1}: ranked choice requires 3-10 options`);
        }
        options = q.options.map((o: string) => {
          if (typeof o !== 'string' || o.trim().length === 0 || o.trim().length > 200) {
            throw new Error(`Question ${i + 1}: each option must be 1-200 characters`);
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
      throw new Error('Only the commissioner can create surveys.');
    }

    // Verify conversation belongs to this league and is a league chat
    const { data: conv } = await supabaseAdmin
      .from('chat_conversations')
      .select('id, league_id, type')
      .eq('id', conversation_id)
      .single();
    if (!conv || conv.league_id !== league_id || conv.type !== 'league') {
      throw new Error('Surveys can only be created in league chat.');
    }

    // Get commissioner's team_id
    const { data: commTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', league_id)
      .eq('user_id', user.id)
      .single();
    if (!commTeam) throw new Error('Commissioner team not found.');

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
    if (surveyError) throw new Error(`Failed to create survey: ${surveyError.message}`);

    // 2. Batch insert questions
    const questionRows = validatedQuestions.map((q: any) => ({
      survey_id: survey.id,
      ...q,
    }));
    const { error: qError } = await supabaseAdmin
      .from('survey_questions')
      .insert(questionRows);
    if (qError) throw new Error(`Failed to create questions: ${qError.message}`);

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
    if (msgError) throw new Error(`Failed to create chat message: ${msgError.message}`);

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

    return new Response(
      JSON.stringify({ survey_id: survey.id, message_id: msg.id }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('create-survey error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
