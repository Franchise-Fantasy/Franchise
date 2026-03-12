import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { generateDefaultOdds, normalizeOdds } from '@/utils/lottery';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

interface LotteryOddsEditorProps {
  odds: number[];
  onChange: (odds: number[]) => void;
  lotteryTeams: number;
}

const POSITION_LABELS = [
  '1st (Worst)',
  '2nd',
  '3rd',
  '4th',
  '5th',
  '6th',
  '7th',
  '8th',
  '9th',
  '10th',
  '11th',
  '12th',
  '13th',
  '14th',
  '15th',
  '16th',
];

export function LotteryOddsEditor({ odds, onChange, lotteryTeams }: LotteryOddsEditorProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  const total = odds.reduce((a, b) => a + b, 0);
  const totalRounded = Math.round(total * 10) / 10;
  const isValid = totalRounded === 100;

  const updateOdd = (index: number, newVal: number) => {
    const next = [...odds];
    next[index] = Math.max(0, Math.min(100, Math.round(newVal * 10) / 10));
    onChange(next);
  };

  const startEditing = (index: number) => {
    setDraft(String(odds[index]));
    setEditingIdx(index);
  };

  const commitEdit = (index: number) => {
    setEditingIdx(null);
    const parsed = parseFloat(draft);
    if (!isNaN(parsed)) updateOdd(index, parsed);
  };

  const handleReset = () => {
    onChange(generateDefaultOdds(lotteryTeams));
  };

  return (
    <View style={[styles.container, { borderColor: c.border }]}>
      <View style={styles.header}>
        <ThemedText accessibilityRole="header" style={styles.title}>Lottery Odds</ThemedText>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Reset odds to defaults" onPress={handleReset}>
          <Text style={[styles.resetBtn, { color: c.accent }]}>Reset</Text>
        </TouchableOpacity>
      </View>

      {odds.map((pct, i) => (
        <View key={i} style={[styles.row, { borderBottomColor: c.border }]}>
          <Text style={[styles.posLabel, { color: c.secondaryText }]}>
            {POSITION_LABELS[i] ?? `${i + 1}th`}
          </Text>
          <View style={styles.controls}>
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Decrease ${POSITION_LABELS[i] ?? `${i + 1}th`} odds`}
              onPress={() => updateOdd(i, pct - 0.5)}
              disabled={pct <= 0}
              style={[styles.btn, { backgroundColor: pct <= 0 ? c.buttonDisabled : c.accent }]}
            >
              <Text style={[styles.btnText, { color: c.accentText }]}>-</Text>
            </TouchableOpacity>

            {editingIdx === i ? (
              <TextInput
                accessibilityLabel={`${POSITION_LABELS[i] ?? `${i + 1}th`} odds percentage`}
                style={[styles.valueText, styles.valueBox, { color: c.text, borderColor: c.accent }]}
                value={draft}
                onChangeText={setDraft}
                onBlur={() => commitEdit(i)}
                onSubmitEditing={() => commitEdit(i)}
                keyboardType="numeric"
                autoFocus
                selectTextOnFocus
              />
            ) : (
              <TouchableOpacity onPress={() => startEditing(i)} style={[styles.valueBox, { borderColor: c.border }]}>
                <Text style={[styles.valueText, { color: c.text }]}>{pct.toFixed(1)}%</Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel={`Increase ${POSITION_LABELS[i] ?? `${i + 1}th`} odds`}
              onPress={() => updateOdd(i, pct + 0.5)}
              disabled={pct >= 100}
              style={[styles.btn, { backgroundColor: pct >= 100 ? c.buttonDisabled : c.accent }]}
            >
              <Text style={[styles.btnText, { color: c.accentText }]}>+</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}

      <View style={styles.footer}>
        <Text style={[styles.totalLabel, { color: isValid ? c.secondaryText : '#e74c3c' }]}>
          Total: {totalRounded.toFixed(1)}%{!isValid ? ' (must equal 100%)' : ''}
        </Text>
        {!isValid && (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel="Auto-fix odds to total 100 percent" onPress={() => onChange(normalizeOdds(odds))}>
            <Text style={[styles.resetBtn, { color: c.accent }]}>Auto-fix</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  resetBtn: {
    fontSize: 14,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  posLabel: {
    fontSize: 14,
    flex: 1,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: 16,
    fontWeight: '600',
  },
  valueText: {
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  valueBox: {
    width: 60,
    height: 28,
    borderWidth: 1,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  totalLabel: {
    fontSize: 13,
    fontWeight: '500',
  },
});
