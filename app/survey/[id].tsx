import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CompletionTracker } from '@/components/survey/CompletionTracker';
import { QuestionInput } from '@/components/survey/QuestionInput';
import { QuestionResult } from '@/components/survey/QuestionResult';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import {
  useSurvey,
  useSurveyResults,
  useSurveyStatus,
  useSubmitSurvey,
} from '@/hooks/chat/useSurveys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import type { SurveyAnswerValue } from '@/types/survey';
import { ms } from "@/utils/scale";

const RESULTS_TABS = ['Results', 'Completion'] as const;

export default function SurveyScreen() {
  const { id, tab } = useLocalSearchParams<{ id: string; tab?: string }>();
  const surveyId = id!;
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { teamId, leagueId } = useAppState();
  const session = useSession();
  const { data: league } = useLeague();
  const isCommissioner = session?.user?.id === league?.created_by;

  const { data: surveyData, isLoading: loadingSurvey } = useSurvey(surveyId);
  const { data: status } = useSurveyStatus(surveyId, teamId);
  const submitMutation = useSubmitSurvey(surveyId);

  const survey = surveyData?.survey;
  const questions = surveyData?.questions ?? [];

  const isClosed = survey ? new Date(survey.closes_at) <= new Date() : false;
  const hasSubmitted = status?.hasSubmitted ?? false;
  const canViewResults =
    (survey?.results_visibility === 'everyone' || isCommissioner) && (hasSubmitted || isClosed);

  // Determine initial mode: take survey vs view results
  const startOnResults = tab === 'results' || hasSubmitted || isClosed;
  const [mode, setMode] = useState<'take' | 'results'>(startOnResults ? 'results' : 'take');

  // Paginated question navigation
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState<Map<string, SurveyAnswerValue>>(new Map());

  const setAnswer = useCallback((questionId: string, value: SurveyAnswerValue) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      next.set(questionId, value);
      return next;
    });
  }, []);

  const currentQuestion = questions[currentQ];
  const isLastQuestion = currentQ === questions.length - 1;

  // Check if current answer satisfies required
  const currentAnswered = useMemo(() => {
    if (!currentQuestion) return false;
    const val = answers.get(currentQuestion.id);
    if (val === undefined || val === null) return !currentQuestion.required;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'string') return val.trim().length > 0;
    return true;
  }, [currentQuestion, answers]);

  const allRequiredAnswered = useMemo(() => {
    return questions.every((q) => {
      if (!q.required) return true;
      const val = answers.get(q.id);
      if (val === undefined || val === null) return false;
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === 'string') return val.trim().length > 0;
      return true;
    });
  }, [questions, answers]);

  function handleNext() {
    if (isLastQuestion) {
      handleSubmit();
    } else {
      setCurrentQ((prev) => Math.min(prev + 1, questions.length - 1));
    }
  }

  function handleBack() {
    setCurrentQ((prev) => Math.max(prev - 1, 0));
  }

  function handleSubmit() {
    if (!allRequiredAnswered) {
      Alert.alert('Incomplete', 'Please answer all required questions.');
      return;
    }

    Alert.alert('Submit Survey', 'Are you sure? You cannot change your answers after submitting.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Submit',
        onPress: () => {
          const answerArray = Array.from(answers.entries()).map(([question_id, value]) => ({
            question_id,
            value,
          }));
          submitMutation.mutate(answerArray, {
            onSuccess: () => {
              setMode('results');
            },
            onError: (err: any) => {
              Alert.alert('Error', err.message ?? 'Failed to submit survey');
            },
          });
        },
      },
    ]);
  }

  // Loading state
  if (loadingSurvey) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <PageHeader title="Survey" />
        <View style={styles.loader}><LogoSpinner /></View>
      </SafeAreaView>
    );
  }

  if (!survey) {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <PageHeader title="Survey" />
        <ThemedText style={[styles.errorText, { color: c.secondaryText }]}>
          Survey not found
        </ThemedText>
      </SafeAreaView>
    );
  }

  // ─── Results Mode ───────────────────────────────────────────
  if (mode === 'results') {
    return (
      <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
        <PageHeader title={survey.title} />
        <ResultsView
          surveyId={surveyId}
          leagueId={leagueId}
          isCommissioner={isCommissioner ?? false}
          canViewResults={canViewResults}
          c={c}
        />
      </SafeAreaView>
    );
  }

  // ─── Take Survey Mode ──────────────────────────────────────
  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.background }]}>
      <PageHeader
        title={survey.title}
        rightAction={
          <ThemedText style={[styles.progressText, { color: c.secondaryText }]}>
            {currentQ + 1} / {questions.length}
          </ThemedText>
        }
      />

      {/* Progress bar */}
      <View style={[styles.progressBarBg, { backgroundColor: c.border }]}>
        <View
          style={[
            styles.progressBarFill,
            {
              backgroundColor: c.accent,
              width: `${((currentQ + 1) / questions.length) * 100}%`,
            },
          ]}
        />
      </View>

      <ScrollView
        style={styles.questionScroll}
        contentContainerStyle={styles.questionContent}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Question prompt */}
        <View style={styles.questionHeaderRow}>
          <ThemedText style={[styles.questionLabel, { color: c.secondaryText }]}>
            Question {currentQ + 1}
            {currentQuestion?.required && (
              <ThemedText style={{ color: c.accent }}> *</ThemedText>
            )}
          </ThemedText>
        </View>
        <ThemedText style={[styles.questionPrompt, { color: c.text }]}>
          {currentQuestion?.prompt}
        </ThemedText>

        {/* Question input */}
        {currentQuestion && (
          <View style={styles.inputContainer}>
            <QuestionInput
              question={currentQuestion}
              value={answers.get(currentQuestion.id) ?? null}
              onChange={(val) => setAnswer(currentQuestion.id, val)}
            />
          </View>
        )}
      </ScrollView>

      {/* Navigation bar */}
      <View style={[styles.navBar, { borderTopColor: c.border, backgroundColor: c.background }]}>
        <TouchableOpacity
          onPress={handleBack}
          disabled={currentQ === 0}
          style={styles.navBtn}
          accessibilityRole="button"
          accessibilityLabel="Previous question"
          accessibilityState={{ disabled: currentQ === 0 }}
        >
          <Ionicons
            name="chevron-back"
            size={20}
            color={currentQ === 0 ? c.border : c.text}
          />
          <ThemedText
            style={[styles.navBtnText, { color: currentQ === 0 ? c.border : c.text }]}
          >
            Back
          </ThemedText>
        </TouchableOpacity>

        {/* Dot indicators */}
        <View style={styles.dots}>
          {questions.map((q, idx) => {
            const answered = answers.has(q.id);
            return (
              <TouchableOpacity
                key={q.id}
                onPress={() => setCurrentQ(idx)}
                accessibilityRole="button"
                accessibilityLabel={`Go to question ${idx + 1}`}
                hitSlop={4}
              >
                <View
                  style={[
                    styles.dot,
                    {
                      backgroundColor:
                        idx === currentQ
                          ? c.accent
                          : answered
                            ? c.activeBorder
                            : c.border,
                    },
                  ]}
                />
              </TouchableOpacity>
            );
          })}
        </View>

        <TouchableOpacity
          onPress={handleNext}
          disabled={!currentAnswered && currentQuestion?.required}
          style={[
            styles.navBtn,
            isLastQuestion && {
              backgroundColor:
                allRequiredAnswered ? c.accent : c.buttonDisabled,
              borderRadius: 8,
              paddingHorizontal: 16,
              paddingVertical: 8,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel={isLastQuestion ? 'Submit survey' : 'Next question'}
          accessibilityState={{
            disabled: !currentAnswered && currentQuestion?.required,
          }}
        >
          {submitMutation.isPending ? (
            <LogoSpinner size={18} />
          ) : isLastQuestion ? (
            <ThemedText
              style={[
                styles.navBtnText,
                { color: allRequiredAnswered ? '#FFFFFF' : c.secondaryText },
              ]}
            >
              Submit
            </ThemedText>
          ) : (
            <>
              <ThemedText
                style={[
                  styles.navBtnText,
                  {
                    color:
                      !currentAnswered && currentQuestion?.required ? c.border : c.text,
                  },
                ]}
              >
                Next
              </ThemedText>
              <Ionicons
                name="chevron-forward"
                size={20}
                color={
                  !currentAnswered && currentQuestion?.required ? c.border : c.text
                }
              />
            </>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

// ─── Results subview ──────────────────────────────────────────

function ResultsView({
  surveyId,
  leagueId,
  isCommissioner,
  canViewResults,
  c,
}: {
  surveyId: string;
  leagueId: string | null;
  isCommissioner: boolean;
  canViewResults: boolean;
  c: any;
}) {
  const { data: results, isLoading } = useSurveyResults(canViewResults ? surveyId : null);
  const [tabIdx, setTabIdx] = useState(0);

  if (!canViewResults) {
    return (
      <View style={styles.centeredMessage}>
        <Ionicons name="lock-closed-outline" size={32} color={c.secondaryText} />
        <ThemedText style={[styles.lockedText, { color: c.secondaryText }]}>
          Results are only visible to the commissioner.
        </ThemedText>
      </View>
    );
  }

  if (isLoading) {
    return <View style={styles.loader}><LogoSpinner /></View>;
  }

  return (
    <View style={{ flex: 1 }}>
      {isCommissioner && leagueId && (
        <View style={styles.tabBar}>
          <SegmentedControl
            options={RESULTS_TABS}
            selectedIndex={tabIdx}
            onSelect={setTabIdx}
          />
        </View>
      )}

      {tabIdx === 0 ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.resultsContent}
          showsVerticalScrollIndicator={false}
        >
          {results?.map((r, idx) => (
            <QuestionResult key={r.question_id} result={r} index={idx} />
          ))}
          {(!results || results.length === 0) && (
            <ThemedText style={[styles.errorText, { color: c.secondaryText }]}>
              No results yet
            </ThemedText>
          )}
        </ScrollView>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.resultsContent}
          showsVerticalScrollIndicator={false}
        >
          {leagueId && (
            <CompletionTracker surveyId={surveyId} leagueId={leagueId} />
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  loader: { marginTop: 40 },
  errorText: { textAlign: 'center', marginTop: 40, fontSize: ms(15) },
  progressText: { fontSize: ms(13), fontWeight: '600' },
  // Progress bar
  progressBarBg: { height: 3 },
  progressBarFill: { height: '100%' },
  // Take survey
  questionScroll: { flex: 1 },
  questionContent: { padding: 20, paddingBottom: 40 },
  questionHeaderRow: { marginBottom: 8 },
  questionLabel: { fontSize: ms(12), fontWeight: '700', textTransform: 'uppercase' },
  questionPrompt: { fontSize: ms(18), fontWeight: '600', lineHeight: 26, marginBottom: 20 },
  inputContainer: { marginBottom: 20 },
  // Nav bar
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  navBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  navBtnText: { fontSize: ms(15), fontWeight: '600' },
  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 1,
    flexWrap: 'wrap',
    justifyContent: 'center',
    maxWidth: '50%',
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  // Results
  tabBar: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  resultsContent: { padding: 16, gap: 12 },
  centeredMessage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 40,
  },
  lockedText: { fontSize: ms(15), textAlign: 'center', lineHeight: 22 },
});
