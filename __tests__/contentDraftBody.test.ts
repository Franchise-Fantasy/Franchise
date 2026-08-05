import {
  describeContentDraft,
  hydrateCustomDate,
  parsePollDraft,
  parseSurveyDraft,
  presetIndexForHours,
  type CommissionerContentDraft,
} from '@/utils/chat/contentDraftBody';

const PRESETS = [
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: '24 hours', hours: 24 },
  { label: '1 week', hours: 168 },
];

function draft(overrides: Partial<CommissionerContentDraft>): CommissionerContentDraft {
  return {
    id: 'd1',
    league_id: 'l1',
    conversation_id: 'c1',
    created_by: 'u1',
    kind: 'poll',
    body: {},
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('parsePollDraft', () => {
  it('round-trips a saved composer state', () => {
    const form = parsePollDraft({
      question: 'Move the trade deadline?',
      options: ['Yes', 'No', 'Only if everyone agrees'],
      pollType: 'multi',
      presetHours: 24,
      closesAt: null,
      isAnonymous: true,
      showLiveResults: false,
    });
    expect(form.question).toBe('Move the trade deadline?');
    expect(form.options).toEqual(['Yes', 'No', 'Only if everyone agrees']);
    expect(form.pollType).toBe('multi');
    expect(form.presetHours).toBe(24);
    expect(form.isAnonymous).toBe(true);
    expect(form.showLiveResults).toBe(false);
  });

  it('returns an empty two-option form for a missing body', () => {
    const form = parsePollDraft(undefined);
    expect(form.question).toBe('');
    expect(form.options).toEqual(['', '']);
    expect(form.pollType).toBe('single');
    expect(form.presetHours).toBeNull();
    expect(form.closesAt).toBeNull();
    // Defaults have to match the composer's own, not just be falsy.
    expect(form.isAnonymous).toBe(false);
    expect(form.showLiveResults).toBe(true);
  });

  it('pads a truncated option list back to the composer minimum', () => {
    expect(parsePollDraft({ options: ['Only one'] }).options).toEqual(['Only one', '']);
  });

  it('drops junk rather than hydrating a form that cannot be published', () => {
    const form = parsePollDraft({
      question: 42,
      options: ['Yes', null, { a: 1 }, 'No'],
      pollType: 'ranked',
      presetHours: -5,
      isAnonymous: 'yes',
    });
    expect(form.question).toBe('');
    expect(form.options).toEqual(['Yes', 'No']);
    expect(form.pollType).toBe('single');
    expect(form.presetHours).toBeNull();
    expect(form.isAnonymous).toBe(false);
  });

  it('caps options at the composer maximum', () => {
    const many = Array.from({ length: 30 }, (_, i) => `Option ${i}`);
    expect(parsePollDraft({ options: many }).options).toHaveLength(10);
  });
});

describe('parseSurveyDraft', () => {
  it('round-trips questions with their types and options', () => {
    const form = parseSurveyDraft({
      title: 'Season wrap',
      description: 'Two minutes, tops.',
      questions: [
        { type: 'rating', prompt: 'Rate the season', options: [], required: false },
        { type: 'ranked_choice', prompt: 'Rank the rules', options: ['A', 'B', 'C'], required: true },
      ],
      resultsVisibility: 'everyone',
      presetHours: 168,
    });
    expect(form.title).toBe('Season wrap');
    expect(form.resultsVisibility).toBe('everyone');
    expect(form.questions).toHaveLength(2);
    expect(form.questions[0].type).toBe('rating');
    expect(form.questions[0].required).toBe(false);
    expect(form.questions[1].options).toEqual(['A', 'B', 'C']);
  });

  it('always yields at least one question so the composer has a card to render', () => {
    expect(parseSurveyDraft({ questions: [] }).questions).toHaveLength(1);
    expect(parseSurveyDraft(undefined).questions).toHaveLength(1);
  });

  it('pads ranked choice to three options and others to two', () => {
    const form = parseSurveyDraft({
      questions: [
        { type: 'ranked_choice', prompt: 'Rank', options: ['A'] },
        { type: 'multiple_choice_single', prompt: 'Pick', options: [] },
      ],
    });
    expect(form.questions[0].options).toEqual(['A', '', '']);
    expect(form.questions[1].options).toEqual(['', '']);
  });

  it('falls back to single choice for an unknown question type', () => {
    const form = parseSurveyDraft({ questions: [{ type: 'freeform_essay', prompt: 'Why?' }] });
    expect(form.questions[0].type).toBe('multiple_choice_single');
    expect(form.questions[0].prompt).toBe('Why?');
  });

  it('defaults results visibility to commissioner-only', () => {
    expect(parseSurveyDraft({}).resultsVisibility).toBe('commissioner');
    expect(parseSurveyDraft({ resultsVisibility: 'nobody' }).resultsVisibility).toBe('commissioner');
  });

  it('caps questions at the composer maximum', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ type: 'free_text', prompt: `Q${i}` }));
    expect(parseSurveyDraft({ questions: many }).questions).toHaveLength(20);
  });
});

describe('hydrateCustomDate', () => {
  const now = new Date('2026-08-04T12:00:00.000Z');

  it('restores a closing time that is still in the future', () => {
    const restored = hydrateCustomDate('2026-08-06T12:00:00.000Z', now);
    expect(restored?.toISOString()).toBe('2026-08-06T12:00:00.000Z');
  });

  it('drops a closing time the draft outlived', () => {
    // The trap: restoring it would leave the composer looking complete while
    // create-poll rejects the past timestamp.
    expect(hydrateCustomDate('2026-08-01T12:00:00.000Z', now)).toBeNull();
  });

  it('handles an unset or unparseable value', () => {
    expect(hydrateCustomDate(null, now)).toBeNull();
    expect(hydrateCustomDate('whenever', now)).toBeNull();
  });
});

describe('presetIndexForHours', () => {
  it('re-selects the preset the draft was saved with', () => {
    expect(presetIndexForHours(PRESETS, 24)).toBe(2);
  });

  it('selects nothing for a custom or unset closing time', () => {
    expect(presetIndexForHours(PRESETS, null)).toBeNull();
    expect(presetIndexForHours(PRESETS, 3)).toBeNull();
  });
});

describe('describeContentDraft', () => {
  it('leads with the poll question and counts only filled options', () => {
    const result = describeContentDraft(
      draft({ kind: 'poll', body: { question: 'Expand to 14?', options: ['Yes', 'No', ''] } }),
    );
    expect(result.label).toBe('Expand to 14?');
    expect(result.meta).toBe('Poll · 2 options');
  });

  it('leads with the survey title and counts only prompted questions', () => {
    const result = describeContentDraft(
      draft({
        kind: 'survey',
        body: { title: 'Rule changes', questions: [{ prompt: 'Keepers?' }, { prompt: '' }] },
      }),
    );
    expect(result.label).toBe('Rule changes');
    expect(result.meta).toBe('Survey · 1 question');
  });

  it('names an untitled draft rather than rendering a blank row', () => {
    expect(describeContentDraft(draft({ kind: 'poll', body: {} })).label).toBe('Untitled poll');
    expect(describeContentDraft(draft({ kind: 'survey', body: {} })).label).toBe('Untitled survey');
  });
});
