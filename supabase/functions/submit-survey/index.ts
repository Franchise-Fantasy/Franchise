import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { parseBody, z } from '../_shared/validate.ts';

const Body = z.object({
  survey_id: z.string().uuid(),
  answers: z.array(z.object({
    question_id: z.string().uuid(),
    value: z.unknown().refine((v) => v !== undefined && v !== null, {
      message: 'Each answer must have question_id and value',
    }),
  })),
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

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'submit-survey');
    if (rateLimited) return rateLimited;

    const { survey_id, answers } = parseBody(Body, await req.json());

    // Fetch survey
    const { data: survey } = await supabaseAdmin
      .from('commissioner_surveys')
      .select('*')
      .eq('id', survey_id)
      .single();
    if (!survey) throw new HttpError('Survey not found', 404);

    // Check survey is still open
    if (new Date() >= new Date(survey.closes_at)) {
      throw new HttpError('This survey has closed.');
    }

    // Verify user is a league member with a team
    const { data: memberTeam } = await supabaseAdmin
      .from('teams')
      .select('id')
      .eq('league_id', survey.league_id)
      .eq('user_id', user.id)
      .single();
    if (!memberTeam) throw new HttpError('You are not a member of this league.', 403);

    // Fetch questions
    const { data: questions } = await supabaseAdmin
      .from('survey_questions')
      .select('*')
      .eq('survey_id', survey_id)
      .order('sort_order');
    if (!questions || questions.length === 0) throw new HttpError('Survey has no questions');

    // Build a lookup of answers by question_id
    const answerMap = new Map<string, any>();
    for (const a of answers) {
      answerMap.set(a.question_id, a.value);
    }

    // Validate each answer against its question
    const validatedAnswers: { question_id: string; value: any }[] = [];

    for (const q of questions) {
      const val = answerMap.get(q.id);

      // Check required
      if (q.required && (val === undefined || val === null)) {
        throw new HttpError(`Question "${q.prompt}" is required`);
      }

      // Skip optional unanswered questions
      if (val === undefined || val === null) continue;

      const opts = q.options as string[] | null;

      switch (q.type) {
        case 'multiple_choice_single': {
          if (!Array.isArray(val) || val.length !== 1) {
            throw new HttpError(`Question "${q.prompt}": must select exactly one option`);
          }
          const idx = val[0];
          if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= (opts?.length ?? 0)) {
            throw new HttpError(`Question "${q.prompt}": invalid selection index`);
          }
          break;
        }
        case 'multiple_choice_multi': {
          if (!Array.isArray(val) || val.length === 0) {
            throw new HttpError(`Question "${q.prompt}": must select at least one option`);
          }
          const unique = new Set(val);
          if (unique.size !== val.length) {
            throw new HttpError(`Question "${q.prompt}": duplicate selections`);
          }
          for (const idx of val) {
            if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= (opts?.length ?? 0)) {
              throw new HttpError(`Question "${q.prompt}": invalid selection index ${idx}`);
            }
          }
          break;
        }
        case 'free_text': {
          if (typeof val !== 'string' || val.trim().length === 0 || val.trim().length > 2000) {
            throw new HttpError(`Question "${q.prompt}": text must be 1-2000 characters`);
          }
          break;
        }
        case 'rating': {
          if (typeof val !== 'number' || !Number.isInteger(val) || val < 1 || val > 5) {
            throw new HttpError(`Question "${q.prompt}": rating must be 1-5`);
          }
          break;
        }
        case 'ranked_choice': {
          if (!Array.isArray(val)) {
            throw new HttpError(`Question "${q.prompt}": ranked choice must be an array`);
          }
          const optLen = opts?.length ?? 0;
          if (val.length !== optLen) {
            throw new HttpError(`Question "${q.prompt}": must rank all ${optLen} options`);
          }
          const seen = new Set<number>();
          for (const idx of val) {
            if (typeof idx !== 'number' || !Number.isInteger(idx) || idx < 0 || idx >= optLen) {
              throw new HttpError(`Question "${q.prompt}": invalid rank index ${idx}`);
            }
            if (seen.has(idx)) {
              throw new HttpError(`Question "${q.prompt}": duplicate rank index ${idx}`);
            }
            seen.add(idx);
          }
          break;
        }
        default:
          throw new HttpError(`Unknown question type: ${q.type}`);
      }

      validatedAnswers.push({ question_id: q.id, value: val });
    }

    // The response row and its answers commit together. As two writes, a failed
    // answer insert left the response row committed — and the UNIQUE on
    // (survey_id, team_id) then rejected every retry with "already submitted",
    // locking the user out of a survey they'd stored with ZERO answers.
    const { error: submitError } = await supabaseAdmin.rpc('submit_survey_response', {
      p_survey_id: survey_id,
      p_team_id: memberTeam.id,
      p_answers: validatedAnswers,
    });

    if (submitError) {
      if (submitError.code === '23505') {
        throw new HttpError('You have already submitted this survey.', 409);
      }
      throw submitError;
    }

    return jsonResponse({ ok: true });
  } catch (error) {
    return handleError(error, 'submit-survey');
  }
});
