import { queryKeys } from '@/constants/queryKeys';
import { capture } from '@/lib/posthog';
import { supabase } from '@/lib/supabase';
import type {
  CommissionerSurvey,
  SurveyAnswer,
  SurveyCompletionStatus,
  SurveyQuestion,
  SurveyQuestionResult,
} from '@/types/survey';
import {
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';

// ─── Fetch survey + questions ─────────────────────────────────

export function useSurvey(surveyId: string | null) {
  return useQuery<{ survey: CommissionerSurvey; questions: SurveyQuestion[] } | null>({
    queryKey: queryKeys.survey(surveyId!),
    queryFn: async () => {
      const { data: survey, error: sErr } = await supabase
        .from('commissioner_surveys')
        .select('*')
        .eq('id', surveyId!)
        .single();
      if (sErr) throw sErr;

      const { data: questions, error: qErr } = await supabase
        .from('survey_questions')
        .select('*')
        .eq('survey_id', surveyId!)
        .order('sort_order');
      if (qErr) throw qErr;

      return {
        survey: survey as CommissionerSurvey,
        questions: (questions ?? []) as SurveyQuestion[],
      };
    },
    enabled: !!surveyId,
    staleTime: 5 * 60 * 1000,
  });
}

// ─── Check if current team has submitted ──────────────────────

export function useSurveyStatus(surveyId: string | null, teamId: string | null) {
  return useQuery<{ hasSubmitted: boolean; submittedAt: string | null }>({
    queryKey: queryKeys.surveyStatus(surveyId!, teamId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('survey_responses')
        .select('submitted_at')
        .eq('survey_id', surveyId!)
        .eq('team_id', teamId!)
        .maybeSingle();
      if (error) throw error;
      return {
        hasSubmitted: !!data,
        submittedAt: data?.submitted_at ?? null,
      };
    },
    enabled: !!surveyId && !!teamId,
    staleTime: 1000 * 60 * 2,
  });
}

// ─── Response count (lightweight, for commissioner preview) ──

export function useSurveyResponseCount(surveyId: string | null, enabled: boolean) {
  return useQuery<number>({
    queryKey: queryKeys.surveyResponseCount(surveyId!),
    queryFn: async () => {
      const { count, error } = await supabase
        .from('survey_responses')
        .select('*', { count: 'exact', head: true })
        .eq('survey_id', surveyId!);
      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!surveyId && enabled,
    staleTime: 1000 * 60 * 2,
  });
}

// ─── Aggregated results (via RPC) ─────────────────────────────

export function useSurveyResults(surveyId: string | null) {
  return useQuery<SurveyQuestionResult[]>({
    queryKey: queryKeys.surveyResults(surveyId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_survey_results', { p_survey_id: surveyId! });
      if (error) throw error;
      return (data ?? []) as SurveyQuestionResult[];
    },
    enabled: !!surveyId,
    staleTime: 1000 * 60 * 2,
  });
}

// ─── Commissioner completion tracker ──────────────────────────

export function useSurveyCompletionTracker(
  surveyId: string | null,
  leagueId: string | null,
) {
  return useQuery<SurveyCompletionStatus[]>({
    queryKey: queryKeys.surveyCompletion(surveyId!),
    queryFn: async () => {
      // Get all teams in the league
      const { data: teams, error: tErr } = await supabase
        .from('teams')
        .select('id, name')
        .eq('league_id', leagueId!)
        .order('name');
      if (tErr) throw tErr;

      // Get all responses for this survey
      const { data: responses, error: rErr } = await supabase
        .from('survey_responses')
        .select('team_id, submitted_at')
        .eq('survey_id', surveyId!);
      if (rErr) throw rErr;

      const responseMap = new Map(
        (responses ?? []).map((r: any) => [r.team_id, r.submitted_at])
      );

      return (teams ?? []).map((t: any) => ({
        team_id: t.id,
        team_name: t.name,
        submitted: responseMap.has(t.id),
        submitted_at: responseMap.get(t.id) ?? null,
      }));
    },
    enabled: !!surveyId && !!leagueId,
    staleTime: 1000 * 60 * 2,
  });
}

// ─── Submit survey answers ────────────────────────────────────

export function useSubmitSurvey(surveyId: string | null) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (answers: SurveyAnswer[]) => {
      const { data, error } = await supabase.functions.invoke('submit-survey', {
        body: { survey_id: surveyId, answers },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      capture('survey_answered');
      queryClient.invalidateQueries({ queryKey: ['surveyStatus', surveyId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.surveyResults(surveyId!) });
      queryClient.invalidateQueries({ queryKey: queryKeys.surveyCompletion(surveyId!) });
    },
  });
}

// ─── Create survey (commissioner) ─────────────────────────────

interface CreateSurveyParams {
  league_id: string;
  conversation_id: string;
  title: string;
  description: string;
  questions: {
    type: string;
    prompt: string;
    options?: string[];
    required: boolean;
  }[];
  closes_at: string;
  results_visibility: 'everyone' | 'commissioner';
}

export function useCreateSurvey() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: CreateSurveyParams) => {
      const { data, error } = await supabase.functions.invoke('create-survey', {
        body: params,
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { survey_id: string; message_id: string };
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.messages(variables.conversation_id),
      });
    },
  });
}
