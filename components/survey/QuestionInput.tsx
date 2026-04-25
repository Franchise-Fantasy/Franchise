import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TextInput, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { SurveyAnswerValue, SurveyQuestion } from '@/types/survey';
import { ms, s } from '@/utils/scale';

import { RankedChoiceInput } from './RankedChoiceInput';

interface Props {
  question: SurveyQuestion;
  value: SurveyAnswerValue | null;
  onChange: (val: SurveyAnswerValue) => void;
}

export function QuestionInput({ question, value, onChange }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  switch (question.type) {
    case 'multiple_choice_single':
      return (
        <MCInput
          options={question.options ?? []}
          value={value as number[] | null}
          onChange={onChange}
          multi={false}
          c={c}
        />
      );
    case 'multiple_choice_multi':
      return (
        <MCInput
          options={question.options ?? []}
          value={value as number[] | null}
          onChange={onChange}
          multi
          c={c}
        />
      );
    case 'free_text':
      return (
        <View>
          <TextInput
            accessibilityLabel={`Answer for: ${question.prompt}`}
            style={[styles.textArea, { color: c.text, backgroundColor: c.cardAlt, borderColor: c.border }]}
            placeholder="Type your answer…"
            placeholderTextColor={c.secondaryText}
            value={(value as string) ?? ''}
            onChangeText={(t) => onChange(t.slice(0, 2000))}
            multiline
            maxLength={2000}
            textAlignVertical="top"
          />
          <ThemedText style={[styles.counter, { color: c.secondaryText }]}>
            {((value as string) ?? '').length}/2000
          </ThemedText>
        </View>
      );
    case 'rating':
      return <RatingInput value={value as number | null} onChange={onChange} c={c} />;
    case 'ranked_choice':
      return (
        <RankedChoiceInput
          options={question.options ?? []}
          value={value as number[] | null}
          onChange={onChange}
        />
      );
    default:
      return null;
  }
}

// ─── Multiple Choice ──────────────────────────────────────────

function MCInput({
  options,
  value,
  onChange,
  multi,
  c,
}: {
  options: string[];
  value: number[] | null;
  onChange: (val: number[]) => void;
  multi: boolean;
  c: typeof Colors.light;
}) {
  const selected = value ?? [];

  function toggle(idx: number) {
    if (multi) {
      const next = selected.includes(idx)
        ? selected.filter((i) => i !== idx)
        : [...selected, idx];
      onChange(next);
    } else {
      onChange([idx]);
    }
  }

  return (
    <View
      style={styles.mcContainer}
      accessibilityRole={multi ? 'none' : 'radiogroup'}
    >
      {options.map((opt, idx) => {
        const active = selected.includes(idx);
        return (
          <TouchableOpacity
            key={idx}
            onPress={() => toggle(idx)}
            style={[
              styles.mcOption,
              {
                borderColor: active ? c.accent : c.border,
                backgroundColor: active ? c.activeCard : c.card,
              },
            ]}
            accessibilityRole={multi ? 'checkbox' : 'radio'}
            accessibilityState={{ checked: active }}
            accessibilityLabel={opt}
          >
            <View
              style={[
                multi ? styles.checkbox : styles.radio,
                {
                  borderColor: active ? c.accent : c.border,
                  backgroundColor: active ? c.accent : 'transparent',
                },
              ]}
            >
              {active && (
                <Ionicons
                  name={multi ? 'checkmark' : 'ellipse'}
                  size={multi ? 12 : 8}
                  color="#FFFFFF"
                />
              )}
            </View>
            <ThemedText style={[styles.mcText, { color: c.text }]} numberOfLines={3}>
              {opt}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ─── Rating (1-5) ─────────────────────────────────────────────

function RatingInput({
  value,
  onChange,
  c,
}: {
  value: number | null;
  onChange: (val: number) => void;
  c: any;
}) {
  return (
    <View style={styles.ratingRow} accessibilityRole="radiogroup">
      {[1, 2, 3, 4, 5].map((n) => {
        const active = value === n;
        return (
          <TouchableOpacity
            key={n}
            onPress={() => onChange(n)}
            style={[
              styles.ratingBtn,
              {
                backgroundColor: active ? c.accent : c.cardAlt,
                borderColor: active ? c.accent : c.border,
              },
            ]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`${n} out of 5`}
          >
            <Ionicons
              name={active ? 'star' : 'star-outline'}
              size={20}
              color={active ? '#FFFFFF' : c.secondaryText}
            />
            <ThemedText
              style={[
                styles.ratingLabel,
                { color: active ? '#FFFFFF' : c.text },
              ]}
            >
              {n}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // MC
  mcContainer: { gap: s(6) },
  mcOption: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: s(12),
    gap: s(10),
  },
  radio: {
    width: s(20),
    height: s(20),
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: s(20),
    height: s(20),
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mcText: { fontSize: ms(15), flex: 1 },
  // Free text
  textArea: {
    borderWidth: 1,
    borderRadius: 10,
    padding: s(12),
    fontSize: ms(15),
    minHeight: s(100),
  },
  counter: { fontSize: ms(11), textAlign: 'right', marginTop: s(2) },
  // Rating
  ratingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: s(8),
  },
  ratingBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: s(12),
    borderRadius: 10,
    borderWidth: 1,
    gap: s(4),
  },
  ratingLabel: { fontSize: ms(13), fontWeight: '600' },
});
