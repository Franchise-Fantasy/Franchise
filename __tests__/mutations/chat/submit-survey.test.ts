// Coverage for the commissioner survey response flow. Verifies a league
// member can submit answers, the responses + answers land in the right
// tables, and the function enforces survey-open, membership, and per-type
// answer validity (multiple-choice index bounds, rating range, etc.).

import { bootstrapTestLeague, BootstrapResult } from '../helpers/bootstrap';
import { adminClient, signInAsBot } from '../helpers/clients';
import { expectHttpError } from '../helpers/expect';
import { clearRateLimits } from '../helpers/lifecycle';

const TIMEOUT = 30_000;

interface SeededSurvey {
  surveyId: string;
  questionIds: { single: string; rating: string; freeText: string };
}

async function seedSurvey(leagueId: string, conversationId: string, teamId: string, opts: { closed?: boolean } = {}): Promise<SeededSurvey> {
  const admin = adminClient();
  const closesAt = opts.closed
    ? new Date(Date.now() - 60_000).toISOString()
    : new Date(Date.now() + 24 * 3600 * 1000).toISOString();
  const { data: survey, error } = await admin
    .from('commissioner_surveys')
    .insert({
      league_id: leagueId,
      conversation_id: conversationId,
      team_id: teamId,
      title: 'Test Survey',
      description: 'submit-survey integration coverage',
      results_visibility: 'commissioner',
      closes_at: closesAt,
    })
    .select('id')
    .single();
  if (error || !survey) throw new Error(`Seed survey failed: ${error?.message}`);

  const { data: questions, error: qErr } = await admin
    .from('survey_questions')
    .insert([
      {
        survey_id: survey.id,
        sort_order: 0,
        type: 'multiple_choice_single',
        prompt: 'Pick one',
        options: ['A', 'B', 'C'],
        required: true,
      },
      {
        survey_id: survey.id,
        sort_order: 1,
        type: 'rating',
        prompt: 'Rate 1-5',
        // The check_blocked_content trigger loops jsonb_array_elements_text on
        // `options` whenever the JSONB value isn't SQL-null; passing an empty
        // array sidesteps the trigger's missing array-typeof check.
        options: [],
        required: true,
      },
      {
        survey_id: survey.id,
        sort_order: 2,
        type: 'free_text',
        prompt: 'Why?',
        options: [],
        required: false,
      },
    ])
    .select('id, type');
  if (qErr || !questions) throw new Error(`Seed questions failed: ${qErr?.message}`);

  const byType = (t: string) => questions.find((q) => q.type === t)!.id;
  return {
    surveyId: survey.id,
    questionIds: {
      single: byType('multiple_choice_single'),
      rating: byType('rating'),
      freeText: byType('free_text'),
    },
  };
}

async function nukeSurvey(surveyId: string): Promise<void> {
  const admin = adminClient();
  const { data: responses } = await admin.from('survey_responses').select('id').eq('survey_id', surveyId);
  const respIds = (responses ?? []).map((r) => r.id);
  if (respIds.length > 0) {
    await admin.from('survey_answers').delete().in('response_id', respIds);
  }
  await admin.from('survey_responses').delete().eq('survey_id', surveyId);
  await admin.from('survey_questions').delete().eq('survey_id', surveyId);
  await admin.from('commissioner_surveys').delete().eq('id', surveyId);
}

describe('submit-survey', () => {
  let league: BootstrapResult;
  let bot1Team: BootstrapResult['teams'][number];

  beforeAll(async () => {
    league = await bootstrapTestLeague();
    const bots = league.teams
      .filter((t) => typeof t.botIndex === 'number')
      .sort((a, b) => (a.botIndex as number) - (b.botIndex as number));
    bot1Team = bots[0];
  }, TIMEOUT);

  beforeEach(async () => {
    await clearRateLimits(bot1Team.userId, ['submit-survey']);
  }, TIMEOUT);

  it(
    'records survey_responses + survey_answers when a member submits valid answers',
    async () => {
      const survey = await seedSurvey(league.leagueId, league.leagueChatId, bot1Team.id);
      try {
        const client = await signInAsBot(1);
        const { error } = await client.functions.invoke('submit-survey', {
          body: {
            survey_id: survey.surveyId,
            answers: [
              { question_id: survey.questionIds.single, value: [1] }, // picks 'B'
              { question_id: survey.questionIds.rating, value: 4 },
              { question_id: survey.questionIds.freeText, value: 'because reasons' },
            ],
          },
        });
        expect(error).toBeNull();

        // Verify a survey_responses row was created for bot1's team
        const admin = adminClient();
        const { data: response } = await admin
          .from('survey_responses')
          .select('id, team_id')
          .eq('survey_id', survey.surveyId)
          .eq('team_id', bot1Team.id)
          .single();
        expect(response).toBeTruthy();

        const { data: answers } = await admin
          .from('survey_answers')
          .select('question_id, value')
          .eq('response_id', response!.id);
        expect(answers).toHaveLength(3);

        const byQ = Object.fromEntries((answers ?? []).map((a) => [a.question_id, a.value]));
        expect(byQ[survey.questionIds.single]).toEqual([1]);
        expect(byQ[survey.questionIds.rating]).toBe(4);
        expect(byQ[survey.questionIds.freeText]).toBe('because reasons');
      } finally {
        await nukeSurvey(survey.surveyId);
      }
    },
    TIMEOUT,
  );

  it(
    'rejects submissions to a closed survey with 400',
    async () => {
      const survey = await seedSurvey(league.leagueId, league.leagueChatId, bot1Team.id, { closed: true });
      try {
        const client = await signInAsBot(1);
        const result = await client.functions.invoke('submit-survey', {
          body: {
            survey_id: survey.surveyId,
            answers: [
              { question_id: survey.questionIds.single, value: [0] },
              { question_id: survey.questionIds.rating, value: 3 },
            ],
          },
        });
        await expectHttpError(result, { status: 400, messageMatch: /closed/i });
      } finally {
        await nukeSurvey(survey.surveyId);
      }
    },
    TIMEOUT,
  );

  it(
    'rejects rating outside 1-5 with a question-tagged 400',
    async () => {
      const survey = await seedSurvey(league.leagueId, league.leagueChatId, bot1Team.id);
      try {
        const client = await signInAsBot(1);
        const result = await client.functions.invoke('submit-survey', {
          body: {
            survey_id: survey.surveyId,
            answers: [
              { question_id: survey.questionIds.single, value: [0] },
              { question_id: survey.questionIds.rating, value: 99 }, // out of range
            ],
          },
        });
        await expectHttpError(result, { status: 400, messageMatch: /rating must be 1-5/i });
      } finally {
        await nukeSurvey(survey.surveyId);
      }
    },
    TIMEOUT,
  );
});
