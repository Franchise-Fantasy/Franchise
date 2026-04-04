import { capture } from '@/lib/posthog';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ToggleRow';
import { Colors } from '@/constants/Colors';
import { useToast } from '@/context/ToastProvider';
import { useCreateSurvey } from '@/hooks/chat/useSurveys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from '@/utils/scale';
import type { SurveyQuestionType } from '@/types/survey';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

const PRESETS = [
  { label: '24 hours', hours: 24 },
  { label: '3 days', hours: 72 },
  { label: '1 week', hours: 168 },
] as const;

const QUESTION_TYPES: { label: string; value: SurveyQuestionType }[] = [
  { label: 'Single Choice', value: 'multiple_choice_single' },
  { label: 'Multi-Select', value: 'multiple_choice_multi' },
  { label: 'Free Text', value: 'free_text' },
  { label: 'Rating (1-5)', value: 'rating' },
  { label: 'Ranked Choice', value: 'ranked_choice' },
];

const VISIBILITY_OPTIONS = ['Everyone', 'Commissioner Only'] as const;

interface QuestionDraft {
  type: SurveyQuestionType;
  prompt: string;
  options: string[];
  required: boolean;
}

function emptyQuestion(): QuestionDraft {
  return { type: 'multiple_choice_single', prompt: '', options: ['', ''], required: true };
}

function needsOptions(type: SurveyQuestionType): boolean {
  return type === 'multiple_choice_single' || type === 'multiple_choice_multi' || type === 'ranked_choice';
}

interface Props {
  visible: boolean;
  leagueId: string;
  conversationId: string;
  teamId: string;
  onClose: () => void;
}

export function CreateSurveyModal({
  visible,
  leagueId,
  conversationId,
  teamId,
  onClose,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { showToast } = useToast();
  const createSurvey = useCreateSurvey();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [questions, setQuestions] = useState<QuestionDraft[]>([emptyQuestion()]);
  const [visIdx, setVisIdx] = useState(1); // 0=everyone, 1=commissioner
  const [presetIdx, setPresetIdx] = useState<number | null>(null);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);

  function handleClose() {
    setTitle('');
    setDescription('');
    setQuestions([emptyQuestion()]);
    setVisIdx(1);
    setPresetIdx(null);
    setCustomDate(null);
    setShowDatePicker(false);
    onClose();
  }

  // ─── Question management ─────────────────────────

  function updateQuestion(idx: number, patch: Partial<QuestionDraft>) {
    setQuestions((prev) => prev.map((q, i) => (i === idx ? { ...q, ...patch } : q)));
  }

  function addQuestion() {
    if (questions.length >= 20) return;
    setQuestions((prev) => [...prev, emptyQuestion()]);
  }

  function removeQuestion(idx: number) {
    if (questions.length <= 1) return;
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function moveQuestion(idx: number, dir: -1 | 1) {
    const target = idx + dir;
    if (target < 0 || target >= questions.length) return;
    setQuestions((prev) => {
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }

  function updateOption(qIdx: number, oIdx: number, val: string) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx) return q;
        const opts = [...q.options];
        opts[oIdx] = val.slice(0, 200);
        return { ...q, options: opts };
      }),
    );
  }

  function addOption(qIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx || q.options.length >= 10) return q;
        return { ...q, options: [...q.options, ''] };
      }),
    );
  }

  function removeOption(qIdx: number, oIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) => {
        if (i !== qIdx || q.options.length <= 2) return q;
        return { ...q, options: q.options.filter((_, j) => j !== oIdx) };
      }),
    );
  }

  // ─── Closing time ────────────────────────────────

  function selectPreset(idx: number) {
    setPresetIdx(idx);
    setCustomDate(null);
    setShowDatePicker(false);
  }

  function handleCustomPress() {
    setPresetIdx(null);
    const initial = new Date();
    initial.setDate(initial.getDate() + 1);
    setCustomDate(initial);
    setShowDatePicker(true);
  }

  function getClosesAt(): Date | null {
    if (presetIdx != null) {
      const d = new Date();
      d.setHours(d.getHours() + PRESETS[presetIdx].hours);
      return d;
    }
    return customDate;
  }

  // ─── Validation ──────────────────────────────────

  const closesAt = getClosesAt();
  const trimmedTitle = title.trim();

  const questionsValid = questions.every((q) => {
    if (q.prompt.trim().length === 0) return false;
    if (needsOptions(q.type)) {
      const filled = q.options.filter((o) => o.trim().length > 0);
      const minOpts = q.type === 'ranked_choice' ? 3 : 2;
      if (filled.length < minOpts) return false;
    }
    return true;
  });

  const canSubmit =
    trimmedTitle.length > 0 &&
    questions.length >= 1 &&
    questionsValid &&
    closesAt != null &&
    closesAt > new Date() &&
    !createSurvey.isPending;

  async function handleCreate() {
    if (!canSubmit || !closesAt) return;
    const allText = [
      trimmedTitle,
      description.trim(),
      ...questions.flatMap((q) => [q.prompt.trim(), ...q.options.map((o) => o.trim())]),
    ].join(' ');
    if (containsBlockedContent(allText)) {
      Alert.alert('Content blocked', 'Your survey contains language that isn\u2019t allowed.');
      return;
    }

    createSurvey.mutate(
      {
        league_id: leagueId,
        conversation_id: conversationId,
        title: trimmedTitle,
        description: description.trim(),
        questions: questions.map((q) => ({
          type: q.type,
          prompt: q.prompt.trim(),
          ...(needsOptions(q.type)
            ? { options: q.options.map((o) => o.trim()).filter((o) => o.length > 0) }
            : {}),
          required: q.required,
        })),
        closes_at: closesAt.toISOString(),
        results_visibility: visIdx === 0 ? 'everyone' : 'commissioner',
      },
      {
        onSuccess: () => {
          capture('survey_created', { question_count: questions.length });
          showToast('success', 'Survey created');
          handleClose();
        },
        onError: (err: any) => {
          Alert.alert('Error', err.message ?? 'Failed to create survey');
        },
      },
    );
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <View style={[styles.root, { backgroundColor: c.card }]} accessibilityViewIsModal>
        {/* Header */}
        <View style={[styles.topBar, { borderBottomColor: c.border }]}>
          <TouchableOpacity
            onPress={handleClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={c.text} />
          </TouchableOpacity>
          <ThemedText accessibilityRole="header" type="subtitle">
            Create Survey
          </ThemedText>
          <View style={{ width: s(24) }} />
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {/* Title */}
            <ThemedText style={[styles.label, { color: c.text }]}>Title</ThemedText>
            <TextInput
              accessibilityLabel="Survey title"
              style={[styles.input, { color: c.text, backgroundColor: c.cardAlt, borderColor: c.border }]}
              placeholder="What's this survey about?"
              placeholderTextColor={c.secondaryText}
              value={title}
              onChangeText={(t) => setTitle(t.slice(0, 200))}
              maxLength={200}
              autoFocus
            />
            <ThemedText style={[styles.counter, { color: c.secondaryText }]}>
              {title.length}/200
            </ThemedText>

            {/* Description */}
            <ThemedText style={[styles.label, { color: c.text, marginTop: s(12) }]}>
              Description (optional)
            </ThemedText>
            <TextInput
              accessibilityLabel="Survey description"
              style={[styles.input, styles.multiline, { color: c.text, backgroundColor: c.cardAlt, borderColor: c.border }]}
              placeholder="Add context or instructions…"
              placeholderTextColor={c.secondaryText}
              value={description}
              onChangeText={(t) => setDescription(t.slice(0, 1000))}
              multiline
              maxLength={1000}
              textAlignVertical="top"
            />

            {/* Questions */}
            <View style={[styles.sectionHeader, { borderTopColor: c.border, marginTop: s(16) }]}>
              <ThemedText style={[styles.sectionTitle, { color: c.text }]}>
                Questions ({questions.length}/20)
              </ThemedText>
            </View>

            {questions.map((q, qIdx) => (
              <View
                key={qIdx}
                style={[styles.questionCard, { backgroundColor: c.cardAlt, borderColor: c.border }]}
              >
                {/* Question header */}
                <View style={styles.questionHeader}>
                  <ThemedText style={[styles.questionNum, { color: c.accent }]}>
                    Q{qIdx + 1}
                  </ThemedText>

                  <View style={styles.questionActions}>
                    <TouchableOpacity
                      onPress={() => moveQuestion(qIdx, -1)}
                      disabled={qIdx === 0}
                      accessibilityRole="button"
                      accessibilityLabel={`Move question ${qIdx + 1} up`}
                      hitSlop={6}
                    >
                      <Ionicons
                        name="chevron-up"
                        size={18}
                        color={qIdx === 0 ? c.border : c.text}
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => moveQuestion(qIdx, 1)}
                      disabled={qIdx === questions.length - 1}
                      accessibilityRole="button"
                      accessibilityLabel={`Move question ${qIdx + 1} down`}
                      hitSlop={6}
                    >
                      <Ionicons
                        name="chevron-down"
                        size={18}
                        color={qIdx === questions.length - 1 ? c.border : c.text}
                      />
                    </TouchableOpacity>
                    {questions.length > 1 && (
                      <TouchableOpacity
                        onPress={() => removeQuestion(qIdx)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove question ${qIdx + 1}`}
                        hitSlop={6}
                      >
                        <Ionicons name="trash-outline" size={16} color={c.secondaryText} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>

                {/* Type selector */}
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.typeScroll}
                >
                  {QUESTION_TYPES.map((qt) => (
                    <TouchableOpacity
                      key={qt.value}
                      onPress={() => {
                        updateQuestion(qIdx, { type: qt.value });
                        // Reset options when switching to a type that doesn't need them
                        if (!needsOptions(qt.value)) {
                          updateQuestion(qIdx, { type: qt.value, options: ['', ''] });
                        }
                        // Ensure ranked choice has at least 3 options
                        if (qt.value === 'ranked_choice' && q.options.length < 3) {
                          updateQuestion(qIdx, {
                            type: qt.value,
                            options: [...q.options, ...Array(3 - q.options.length).fill('')],
                          });
                        }
                      }}
                      style={[
                        styles.typeChip,
                        {
                          backgroundColor: q.type === qt.value ? c.accent : c.card,
                          borderColor: q.type === qt.value ? c.accent : c.border,
                        },
                      ]}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: q.type === qt.value }}
                      accessibilityLabel={qt.label}
                    >
                      <Text
                        style={{
                          color: q.type === qt.value ? c.statusText : c.text,
                          fontSize: ms(12),
                          fontWeight: '600',
                        }}
                      >
                        {qt.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* Prompt */}
                <TextInput
                  accessibilityLabel={`Question ${qIdx + 1} prompt`}
                  style={[styles.qInput, { color: c.text, backgroundColor: c.card, borderColor: c.border }]}
                  placeholder="Ask a question…"
                  placeholderTextColor={c.secondaryText}
                  value={q.prompt}
                  onChangeText={(t) => updateQuestion(qIdx, { prompt: t.slice(0, 500) })}
                  multiline
                  maxLength={500}
                  textAlignVertical="top"
                />

                {/* Options (for MC and ranked choice) */}
                {needsOptions(q.type) && (
                  <View style={styles.optionsSection}>
                    {q.options.map((opt, oIdx) => (
                      <View key={oIdx} style={styles.optionInputRow}>
                        <TextInput
                          accessibilityLabel={`Question ${qIdx + 1}, option ${oIdx + 1}`}
                          style={[
                            styles.optionInput,
                            { color: c.text, backgroundColor: c.card, borderColor: c.border },
                          ]}
                          placeholder={`Option ${oIdx + 1}`}
                          placeholderTextColor={c.secondaryText}
                          value={opt}
                          onChangeText={(t) => updateOption(qIdx, oIdx, t)}
                          maxLength={200}
                        />
                        {q.options.length > 2 && (
                          <TouchableOpacity
                            onPress={() => removeOption(qIdx, oIdx)}
                            accessibilityRole="button"
                            accessibilityLabel={`Remove option ${oIdx + 1}`}
                          >
                            <Ionicons name="close-circle" size={20} color={c.secondaryText} />
                          </TouchableOpacity>
                        )}
                      </View>
                    ))}
                    {q.options.length < 10 && (
                      <TouchableOpacity
                        onPress={() => addOption(qIdx)}
                        style={styles.addOptBtn}
                        accessibilityRole="button"
                        accessibilityLabel="Add option"
                      >
                        <Ionicons name="add-circle-outline" size={18} color={c.accent} />
                        <ThemedText style={[styles.addOptText, { color: c.accent }]}>
                          Add Option
                        </ThemedText>
                      </TouchableOpacity>
                    )}
                  </View>
                )}

                {/* Required toggle */}
                <ToggleRow
                  icon="alert-circle-outline"
                  label="Required"
                  description=""
                  value={q.required}
                  onToggle={(v) => updateQuestion(qIdx, { required: v })}
                  c={c}
                />
              </View>
            ))}

            {/* Add question */}
            {questions.length < 20 && (
              <TouchableOpacity
                onPress={addQuestion}
                style={[styles.addQuestionBtn, { borderColor: c.border }]}
                accessibilityRole="button"
                accessibilityLabel="Add another question"
              >
                <Ionicons name="add-circle-outline" size={22} color={c.accent} />
                <ThemedText style={[styles.addQuestionText, { color: c.accent }]}>
                  Add Question
                </ThemedText>
              </TouchableOpacity>
            )}

            {/* Results visibility */}
            <View style={[styles.sectionHeader, { borderTopColor: c.border, marginTop: s(16) }]}>
              <ThemedText style={[styles.label, { color: c.text }]}>
                Results Visibility
              </ThemedText>
            </View>
            <SegmentedControl
              options={VISIBILITY_OPTIONS}
              selectedIndex={visIdx}
              onSelect={setVisIdx}
            />

            {/* Closing time */}
            <ThemedText style={[styles.label, { color: c.text, marginTop: s(16) }]}>
              Closing Time
            </ThemedText>
            <View style={styles.presets}>
              {PRESETS.map((p, idx) => (
                <TouchableOpacity
                  key={p.label}
                  onPress={() => selectPreset(idx)}
                  style={[
                    styles.presetChip,
                    {
                      backgroundColor: presetIdx === idx ? c.accent : c.cardAlt,
                      borderColor: presetIdx === idx ? c.accent : c.border,
                    },
                  ]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: presetIdx === idx }}
                  accessibilityLabel={`Close survey in ${p.label}`}
                >
                  <Text
                    style={{
                      color: presetIdx === idx ? c.statusText : c.text,
                      fontSize: ms(13),
                      fontWeight: '600',
                    }}
                  >
                    {p.label}
                  </Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity
                onPress={handleCustomPress}
                style={[
                  styles.presetChip,
                  {
                    backgroundColor: customDate ? c.accent : c.cardAlt,
                    borderColor: customDate ? c.accent : c.border,
                  },
                ]}
                accessibilityRole="radio"
                accessibilityState={{ selected: !!customDate }}
                accessibilityLabel="Set custom closing time"
              >
                <Text
                  style={{
                    color: customDate ? c.statusText : c.text,
                    fontSize: ms(13),
                    fontWeight: '600',
                  }}
                >
                  Custom
                </Text>
              </TouchableOpacity>
            </View>
            {showDatePicker && (
              <DateTimePicker
                value={customDate ?? new Date()}
                mode="datetime"
                minimumDate={new Date()}
                onChange={(_, date) => {
                  if (Platform.OS === 'android') setShowDatePicker(false);
                  if (date) setCustomDate(date);
                }}
                display={Platform.OS === 'ios' ? 'inline' : 'default'}
              />
            )}
            {closesAt && (
              <ThemedText style={[styles.closesLabel, { color: c.secondaryText }]}>
                Closes: {closesAt.toLocaleString()}
              </ThemedText>
            )}

            {/* Spacer for bottom button */}
            <View style={{ height: s(80) }} />
          </ScrollView>
        </KeyboardAvoidingView>

        {/* Create button */}
        <View style={[styles.bottomBar, { backgroundColor: c.card, borderTopColor: c.border }]}>
          <TouchableOpacity
            onPress={handleCreate}
            disabled={!canSubmit}
            style={[
              styles.createBtn,
              { backgroundColor: canSubmit ? c.accent : c.buttonDisabled },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Create survey"
            accessibilityState={{ disabled: !canSubmit }}
          >
            {createSurvey.isPending ? (
              <ActivityIndicator color={c.statusText} size="small" />
            ) : (
              <Text style={[styles.createBtnText, { color: c.statusText }]}>Create Survey</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: s(16),
    paddingTop: s(56),
    paddingBottom: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  scroll: { flex: 1, paddingHorizontal: s(16), paddingTop: s(16) },
  label: { fontSize: ms(14), fontWeight: '600', marginBottom: s(6) },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(12),
    fontSize: ms(15),
  },
  multiline: { minHeight: s(60) },
  counter: { fontSize: ms(11), textAlign: 'right', marginTop: s(2) },
  sectionHeader: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingTop: s(14),
    marginBottom: s(10),
  },
  sectionTitle: { fontSize: ms(16), fontWeight: '700' },
  // Question card
  questionCard: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(12),
    marginBottom: s(10),
    gap: s(8),
  },
  questionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  questionNum: { fontSize: ms(14), fontWeight: '700' },
  questionActions: { flexDirection: 'row', alignItems: 'center', gap: s(10) },
  typeScroll: { marginBottom: s(4) },
  typeChip: {
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 14,
    borderWidth: 1,
    marginRight: s(6),
  },
  qInput: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(10),
    fontSize: ms(14),
    minHeight: s(44),
  },
  optionsSection: { gap: s(4) },
  optionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  optionInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(10),
    paddingVertical: s(7),
    fontSize: ms(14),
  },
  addOptBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    paddingVertical: s(4),
  },
  addOptText: { fontSize: ms(13), fontWeight: '600' },
  // Add question button
  addQuestionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(8),
    paddingVertical: s(14),
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: 12,
    marginBottom: s(10),
  },
  addQuestionText: { fontSize: ms(14), fontWeight: '600' },
  // Presets
  presets: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
    marginBottom: s(8),
  },
  presetChip: {
    paddingHorizontal: s(12),
    paddingVertical: s(6),
    borderRadius: 16,
    borderWidth: 1,
  },
  closesLabel: { fontSize: ms(12), marginBottom: s(8) },
  // Bottom bar
  bottomBar: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingHorizontal: s(16),
    paddingTop: s(10),
    paddingBottom: s(34),
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  createBtn: {
    borderRadius: 10,
    paddingVertical: s(12),
    alignItems: 'center',
  },
  createBtnText: {
    fontSize: ms(16),
    fontWeight: '600',
  },
});
