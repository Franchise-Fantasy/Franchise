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

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'submit-survey');
    if (rateLimited) return rateLimited;

    const { survey_id, answers } = await req.json();
    if (!survey_id || !answers) {
      throw new Error('survey_id and answers are required');
    }

    // Fetch survey
    const { data: survey } = await supabaseAdmin
      .from('commissioner_surveys')
      .select('*')
      .eq('id', survey_id)
      .single();
    if (!survey) throw new Error('Survey not found');

    // Check survey is still open
    if (new Date() >= new Date(survey.closes_at)) {
      throw new Error('This survey has closed.');
    }

    // Verify user is a league member with a team
    const { data: memberTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', survey.league_id)
      .eq('user_id', user.id)
      .single();
    if (!memberTeam) throw new Error('You are not a member of this league.');

    // Fetch questions
    const { data: questions } = await supabaseAdmin
      .from('survey_questions')
      .select('*')
      .eq('survey_id', survey_id)
      .order('sort_order');
    if (!questions || questions.length === 0) throw new Error('Survey has no questions');

    // Build a lookup of answers by question_id
    if (!Array.isArray(answers)) throw new Error('answers must be an array');
    const answerMap = new Map<string, any>();
    for (const a of answers) {
      if (!a.question_id || a.value === undefined || a.value === null) {
        throw new Error('Each answer must have question_id and value');
      }
      answerMap.set(a.question_id, a.value);
    }

    // Validate each answer against its question
    const validatedAnswers: { question_id: string; value: any }[] = [];

    for (const q of questions) {
      const val = answerMap.get(q.id);

      // Check required
      if (q.required && (val === undefined || val === null)) {
        throw new Error(`Question "${q.prompt}" is required`);
      }

      // Skip optional unanswered questions
      if (val === undefined || val === null) continue;

      const opts = q.options as string[] | null;

      switch (q.type) {
        case 'multiple_choice_single': {
          if (!Array.isArray(val) || val.length !== 1) {
            throw new Error(`Question "${q.prompt}": must select exactly one option`);
          }
          const idx = val[0];
          if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= (opts?.length ?? 0)) {
            throw new Error(`Question "${q.prompt}": invalid selection index`);
          }
          break;
        }
        case 'multiple_choice_multi': {
          if (!Array.isArray(val) || val.length === 0) {
            throw new Error(`Question "${q.prompt}": must select at least one option`);
          }
          const unique = new Set(val);
          if (unique.size !== val.length) {
            throw new Error(`Question "${q.prompt}": duplicate selections`);
          }
          for (const idx of val) {
            if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= (opts?.length ?? 0)) {
              throw new Error(`Question "${q.prompt}": invalid selection index ${idx}`);
            }
          }
          break;
        }
        case 'free_text': {
          if (typeof val !== 'string' || val.trim().length === 0 || val.trim().length > 2000) {
            throw new Error(`Question "${q.prompt}": text must be 1-2000 characters`);
          }
          break;
        }
        case 'rating': {
          if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 5) {
            throw new Error(`Question "${q.prompt}": rating must be 1-5`);
          }
          break;
        }
        case 'ranked_choice': {
          if (!Array.isArray(val)) {
            throw new Error(`Question "${q.prompt}": ranked choice must be an array`);
          }
          const optLen = opts?.length ?? 0;
          if (val.length !== optLen) {
            throw new Error(`Question "${q.prompt}": must rank all ${optLen} options`);
          }
          const seen = new Set<number>();
          for (const idx of val) {
            if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= optLen) {
              throw new Error(`Question "${q.prompt}": invalid rank index ${idx}`);
            }
            if (seen.has(idx)) {
              throw new Error(`Question "${q.prompt}": duplicate rank index ${idx}`);
            }
            seen.add(idx);
          }
          break;
        }
        default:
          throw new Error(`Unknown question type: ${q.type}`);
      }

      validatedAnswers.push({ question_id: q.id, value: val });
    }

    // Insert response (UNIQUE constraint prevents double-submit)
    const { data: response, error: respError } = await supabaseAdmin
      .from('survey_responses')
      .insert({
        survey_id,
        team_id: memberTeam.id,
      })
      .select('id')
      .single();

    if (respError) {
      if (respError.code === '23505') {
        throw new Error('You have already submitted this survey.');
      }
      throw new Error(`Failed to submit survey: ${respError.message}`);
    }

    // Batch insert answers
    if (validatedAnswers.length > 0) {
      const answerRows = validatedAnswers.map((a) => ({
        response_id: response.id,
        question_id: a.question_id,
        value: a.value,
      }));
      const { error: ansError } = await supabaseAdmin
        .from('survey_answers')
        .insert(answerRows);
      if (ansError) throw new Error(`Failed to save answers: ${ansError.message}`);
    }

    return new Response(
      JSON.stringify({ ok: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('submit-survey error:', error);
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});
