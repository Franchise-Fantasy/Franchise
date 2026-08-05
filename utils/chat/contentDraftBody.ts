/**
 * The shape of a saved poll/survey draft, and the normalization that turns a
 * stored `body` blob back into composer state.
 *
 * `commissioner_content_drafts.body` is opaque jsonb — the DB validates its
 * size and nothing else — so every read has to assume the blob may predate the
 * current form (a question type added later, an option list that used to be a
 * string). Rather than let a stale draft throw inside a modal's render, the
 * parsers here coerce anything unrecognized back to the empty-form value for
 * that field. A draft always opens; at worst a field comes back blank.
 *
 * Pure and dependency-free so it can be unit-tested without pulling the RN
 * component tree into the jest import graph.
 */
import type { SurveyQuestionType } from '@/types/survey';

export type ContentDraftKind = 'poll' | 'survey';

export interface CommissionerContentDraft {
  id: string;
  league_id: string;
  conversation_id: string;
  created_by: string;
  kind: ContentDraftKind;
  body: unknown;
  created_at: string;
  updated_at: string;
}

/**
 * Composer state for a poll. Closing time is stored as BOTH the chosen preset
 * (in hours) and an absolute timestamp because the two resume differently: a
 * preset means "4 hours from whenever I publish", so it re-arms from the
 * resume moment, while a hand-picked date is an absolute the commissioner
 * meant literally — and is dropped if it has since passed.
 */
export interface PollDraftForm {
  question: string;
  options: string[];
  pollType: 'single' | 'multi';
  presetHours: number | null;
  closesAt: string | null;
  isAnonymous: boolean;
  showLiveResults: boolean;
}

export interface SurveyQuestionDraftForm {
  type: SurveyQuestionType;
  prompt: string;
  options: string[];
  required: boolean;
}

export interface SurveyDraftForm {
  title: string;
  description: string;
  questions: SurveyQuestionDraftForm[];
  resultsVisibility: 'everyone' | 'commissioner';
  presetHours: number | null;
  closesAt: string | null;
}

const SURVEY_QUESTION_TYPES: SurveyQuestionType[] = [
  'multiple_choice_single',
  'multiple_choice_multi',
  'free_text',
  'rating',
  'ranked_choice',
];

// Mirrors the composer's own limits so a hand-edited or outdated blob can't
// hydrate a form the create-poll / create-survey validators would reject.
const MAX_POLL_OPTIONS = 10;
const MAX_SURVEY_QUESTIONS = 20;
const MAX_QUESTION_OPTIONS = 10;

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown, maxLength: number): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : '';
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function asPositiveNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Pads to `min` entries so the composer always renders its minimum rows. */
function asStringList(value: unknown, min: number, max: number): string[] {
  const list = Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string').slice(0, max)
    : [];
  while (list.length < min) list.push('');
  return list;
}

export function parsePollDraft(body: unknown): PollDraftForm {
  const raw = asRecord(body);
  return {
    question: asString(raw.question, 500),
    options: asStringList(raw.options, 2, MAX_POLL_OPTIONS),
    pollType: raw.pollType === 'multi' ? 'multi' : 'single',
    presetHours: asPositiveNumber(raw.presetHours),
    closesAt: typeof raw.closesAt === 'string' ? raw.closesAt : null,
    isAnonymous: asBoolean(raw.isAnonymous, false),
    showLiveResults: asBoolean(raw.showLiveResults, true),
  };
}

function parseSurveyQuestion(value: unknown): SurveyQuestionDraftForm {
  const raw = asRecord(value);
  const type = SURVEY_QUESTION_TYPES.includes(raw.type as SurveyQuestionType)
    ? (raw.type as SurveyQuestionType)
    : 'multiple_choice_single';
  // Ranked choice needs three options before it's valid, so its empty state
  // starts at three rows rather than two.
  const minOptions = type === 'ranked_choice' ? 3 : 2;
  return {
    type,
    prompt: asString(raw.prompt, 500),
    options: asStringList(raw.options, minOptions, MAX_QUESTION_OPTIONS),
    required: asBoolean(raw.required, true),
  };
}

export function parseSurveyDraft(body: unknown): SurveyDraftForm {
  const raw = asRecord(body);
  const questions = Array.isArray(raw.questions)
    ? raw.questions.slice(0, MAX_SURVEY_QUESTIONS).map(parseSurveyQuestion)
    : [];
  return {
    title: asString(raw.title, 200),
    description: asString(raw.description, 1000),
    questions: questions.length > 0 ? questions : [parseSurveyQuestion(undefined)],
    resultsVisibility: raw.resultsVisibility === 'everyone' ? 'everyone' : 'commissioner',
    presetHours: asPositiveNumber(raw.presetHours),
    closesAt: typeof raw.closesAt === 'string' ? raw.closesAt : null,
  };
}

/**
 * The custom closing date to re-select on resume. A draft saved with "closes
 * Tuesday 6pm" and opened on Thursday has to come back with nothing selected —
 * silently restoring a past date would let the composer look complete while
 * the edge function rejects it.
 */
export function hydrateCustomDate(closesAt: string | null, now: Date = new Date()): Date | null {
  if (!closesAt) return null;
  const date = new Date(closesAt);
  if (Number.isNaN(date.getTime()) || date <= now) return null;
  return date;
}

/** Index of the preset a draft was saved with, or null for custom/unset. */
export function presetIndexForHours(
  presets: readonly { hours: number }[],
  presetHours: number | null,
): number | null {
  if (presetHours == null) return null;
  const idx = presets.findIndex((p) => p.hours === presetHours);
  return idx === -1 ? null : idx;
}

/** Row copy for the saved-drafts list. */
export function describeContentDraft(draft: CommissionerContentDraft): {
  label: string;
  meta: string;
} {
  if (draft.kind === 'poll') {
    const form = parsePollDraft(draft.body);
    const filled = form.options.filter((o) => o.trim().length > 0).length;
    return {
      label: form.question.trim() || 'Untitled poll',
      meta: `Poll · ${filled} ${filled === 1 ? 'option' : 'options'}`,
    };
  }
  const form = parseSurveyDraft(draft.body);
  const answered = form.questions.filter((q) => q.prompt.trim().length > 0).length;
  return {
    label: form.title.trim() || 'Untitled survey',
    meta: `Survey · ${answered} ${answered === 1 ? 'question' : 'questions'}`,
  };
}
