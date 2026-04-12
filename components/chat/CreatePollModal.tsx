import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ToggleRow';
import { Colors } from '@/constants/Colors';
import { useToast } from '@/context/ToastProvider';
import { useCreatePoll } from '@/hooks/chat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { containsBlockedContent } from '@/utils/moderation';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
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

const POLL_TYPES = ['Single Choice', 'Multi-Select'] as const;
const PRESETS = [
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: '24 hours', hours: 24 },
  { label: '1 week', hours: 168 },
] as const;

interface Props {
  visible: boolean;
  leagueId: string;
  conversationId: string;
  teamId: string;
  onClose: () => void;
}

export function CreatePollModal({
  visible,
  leagueId,
  conversationId,
  teamId,
  onClose,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { showToast } = useToast();
  const createPoll = useCreatePoll();

  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);
  const [pollTypeIdx, setPollTypeIdx] = useState(0);
  const [presetIdx, setPresetIdx] = useState<number | null>(null);
  const [customDate, setCustomDate] = useState<Date | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [showLiveResults, setShowLiveResults] = useState(true);

  function handleClose() {
    setQuestion('');
    setOptions(['', '']);
    setPollTypeIdx(0);
    setPresetIdx(null);
    setCustomDate(null);
    setShowDatePicker(false);
    setIsAnonymous(false);
    setShowLiveResults(true);
    onClose();
  }

  function addOption() {
    if (options.length >= 10) return;
    setOptions([...options, '']);
  }

  function removeOption(idx: number) {
    if (options.length <= 2) return;
    setOptions(options.filter((_, i) => i !== idx));
  }

  function updateOption(idx: number, val: string) {
    const next = [...options];
    next[idx] = val.slice(0, 200);
    setOptions(next);
  }

  function selectPreset(idx: number) {
    setPresetIdx(idx);
    setCustomDate(null);
    setShowDatePicker(false);
  }

  function handleCustomPress() {
    setPresetIdx(null);
    const initial = new Date();
    initial.setHours(initial.getHours() + 1);
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

  const closesAt = getClosesAt();
  const trimmedQ = question.trim();
  const filledOptions = options.filter((o) => o.trim().length > 0);
  const canSubmit =
    trimmedQ.length > 0 &&
    filledOptions.length >= 2 &&
    closesAt != null &&
    closesAt > new Date() &&
    !createPoll.isPending;

  async function handleCreate() {
    if (!canSubmit || !closesAt) return;
    const allText = [trimmedQ, ...filledOptions].join(' ');
    if (containsBlockedContent(allText)) {
      Alert.alert('Content blocked', 'Your poll contains language that isn\u2019t allowed.');
      return;
    }

    createPoll.mutate(
      {
        league_id: leagueId,
        conversation_id: conversationId,
        question: trimmedQ,
        options: options.map((o) => o.trim()).filter((o) => o.length > 0),
        poll_type: pollTypeIdx === 0 ? 'single' : 'multi',
        closes_at: closesAt.toISOString(),
        is_anonymous: isAnonymous,
        show_live_results: showLiveResults,
      },
      {
        onSuccess: () => {
          showToast('success', 'Poll created');
          handleClose();
        },
        onError: (err: any) => {
          Alert.alert('Error', err.message ?? 'Failed to create poll');
        },
      },
    );
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <View style={[styles.content, { backgroundColor: c.card }]} accessibilityViewIsModal>
          {/* Header */}
          <View style={styles.header}>
            <ThemedText accessibilityRole="header" type="subtitle">
              Create Poll
            </ThemedText>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Close"
              onPress={handleClose}
            >
              <Ionicons name="close" size={24} color={c.text} />
            </TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll}>
            {/* Question */}
            <ThemedText style={[styles.label, { color: c.text }]}>Question</ThemedText>
            <TextInput
              accessibilityLabel="Poll question"
              style={[styles.input, { color: c.text, backgroundColor: c.cardAlt, borderColor: c.border }]}
              placeholder="What do you want to ask?"
              placeholderTextColor={c.secondaryText}
              value={question}
              onChangeText={(t) => setQuestion(t.slice(0, 500))}
              multiline
              maxLength={500}
              textAlignVertical="top"
              autoFocus
            />
            <ThemedText style={[styles.counter, { color: c.secondaryText }]}>
              {question.length}/500
            </ThemedText>

            {/* Options */}
            <ThemedText style={[styles.label, { color: c.text, marginTop: s(14) }]}>
              Options
            </ThemedText>
            {options.map((opt, idx) => (
              <View key={idx} style={styles.optionInputRow}>
                <TextInput
                  accessibilityLabel={`Poll option ${idx + 1}`}
                  style={[
                    styles.optionInput,
                    { color: c.text, backgroundColor: c.cardAlt, borderColor: c.border },
                  ]}
                  placeholder={`Option ${idx + 1}`}
                  placeholderTextColor={c.secondaryText}
                  value={opt}
                  onChangeText={(t) => updateOption(idx, t)}
                  maxLength={200}
                />
                {options.length > 2 && (
                  <TouchableOpacity
                    onPress={() => removeOption(idx)}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove option ${idx + 1}`}
                    style={styles.removeBtn}
                  >
                    <Ionicons name="close-circle" size={22} color={c.secondaryText} />
                  </TouchableOpacity>
                )}
              </View>
            ))}
            {options.length < 10 && (
              <TouchableOpacity
                onPress={addOption}
                style={styles.addBtn}
                accessibilityRole="button"
                accessibilityLabel="Add another option"
              >
                <Ionicons name="add-circle-outline" size={20} color={c.accent} />
                <ThemedText style={[styles.addText, { color: c.accent }]}>
                  Add Option
                </ThemedText>
              </TouchableOpacity>
            )}

            {/* Poll Type */}
            <ThemedText style={[styles.label, { color: c.text, marginTop: s(14) }]}>
              Poll Type
            </ThemedText>
            <SegmentedControl
              options={POLL_TYPES}
              selectedIndex={pollTypeIdx}
              onSelect={setPollTypeIdx}
            />

            {/* Closing Time */}
            <ThemedText style={[styles.label, { color: c.text, marginTop: s(14) }]}>
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
                  accessibilityLabel={`Close poll in ${p.label}`}
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

            {/* Toggles */}
            <View style={[styles.toggleSection, { borderTopColor: c.border }]}>
              <ToggleRow
                icon="lock-closed"
                label="Anonymous Voting"
                description="Votes are truly anonymous — no one can see who voted for what."
                value={isAnonymous}
                onToggle={setIsAnonymous}
                c={c}
              />
              <ToggleRow
                icon="eye"
                label="Show Live Results"
                description="Members see vote counts as they come in. If off, results are hidden until the poll closes."
                value={showLiveResults}
                onToggle={setShowLiveResults}
                c={c}
              />
            </View>
          </ScrollView>

          {/* Create button */}
          <TouchableOpacity
            onPress={handleCreate}
            disabled={!canSubmit}
            style={[
              styles.createBtn,
              { backgroundColor: canSubmit ? c.accent : c.buttonDisabled },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Create poll"
            accessibilityState={{ disabled: !canSubmit }}
          >
            {createPoll.isPending ? (
              <LogoSpinner size={18} />
            ) : (
              <Text style={[styles.createBtnText, { color: c.statusText }]}>Create Poll</Text>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, justifyContent: 'flex-end' },
  content: {
    borderTopLeftRadius: 14,
    borderTopRightRadius: 14,
    padding: s(20),
    paddingBottom: s(32),
    maxHeight: '90%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: s(12),
  },
  scroll: {
    flexGrow: 0,
  },
  label: {
    fontSize: ms(14),
    fontWeight: '600',
    marginBottom: s(6),
  },
  input: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(12),
    fontSize: ms(15),
    minHeight: s(60),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  counter: {
    fontSize: ms(11),
    textAlign: 'right',
    marginTop: s(2),
  },
  optionInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    marginBottom: s(6),
  },
  optionInput: {
    flex: 1,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(8),
    fontSize: ms(15),
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
    elevation: 1,
  },
  removeBtn: {
    padding: s(4),
  },
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingVertical: s(6),
  },
  addText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
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
  closesLabel: {
    fontSize: ms(12),
    marginBottom: s(8),
  },
  toggleSection: {
    borderTopWidth: StyleSheet.hairlineWidth,
    marginTop: s(14),
    paddingTop: s(8),
  },
  createBtn: {
    borderRadius: 10,
    paddingVertical: s(12),
    alignItems: 'center',
    marginTop: s(12),
  },
  createBtnText: {
    fontSize: ms(16),
    fontWeight: '600',
  },
});
