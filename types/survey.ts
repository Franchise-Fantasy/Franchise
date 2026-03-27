export type SurveyQuestionType =
  | 'multiple_choice_single'
  | 'multiple_choice_multi'
  | 'free_text'
  | 'rating'
  | 'ranked_choice';

export interface CommissionerSurvey {
  id: string;
  league_id: string;
  conversation_id: string;
  message_id: string | null;
  team_id: string;
  title: string;
  description: string;
  results_visibility: 'everyone' | 'commissioner';
  closes_at: string;
  created_at: string;
}

export interface SurveyQuestion {
  id: string;
  survey_id: string;
  sort_order: number;
  type: SurveyQuestionType;
  prompt: string;
  options: string[] | null;
  required: boolean;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  team_id: string;
  submitted_at: string;
}

/** Value shape varies by question type:
 * - multiple_choice_single: number[] (single index)
 * - multiple_choice_multi: number[] (array of indices)
 * - free_text: string
 * - rating: number (1-5)
 * - ranked_choice: number[] (indices in ranked order, first = highest)
 */
export type SurveyAnswerValue = number | number[] | string;

export interface SurveyAnswer {
  question_id: string;
  value: SurveyAnswerValue;
}

// ─── Aggregated result types (returned by get_survey_results RPC) ───

export interface MCResultData {
  question_id: string;
  type: 'multiple_choice_single' | 'multiple_choice_multi';
  prompt: string;
  options: string[];
  total_responses: number;
  option_counts: number[];
}

export interface RatingResultData {
  question_id: string;
  type: 'rating';
  prompt: string;
  total_responses: number;
  distribution: Record<string, number>;
  average: number;
}

export interface FreeTextResultData {
  question_id: string;
  type: 'free_text';
  prompt: string;
  total_responses: number;
  responses: string[];
}

export interface RankedChoiceResultData {
  question_id: string;
  type: 'ranked_choice';
  prompt: string;
  options: string[];
  total_responses: number;
  borda_scores: number[];
}

export type SurveyQuestionResult =
  | MCResultData
  | RatingResultData
  | FreeTextResultData
  | RankedChoiceResultData;

export interface SurveyCompletionStatus {
  team_id: string;
  team_name: string;
  submitted: boolean;
  submitted_at: string | null;
}
