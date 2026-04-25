import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow, Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { SurveyQuestionResult } from '@/types/survey';
import { ms, s } from '@/utils/scale';

interface Props {
  result: SurveyQuestionResult;
  index: number;
}

export function QuestionResult({ result, index }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View
      style={[styles.container, { backgroundColor: c.cardAlt, borderColor: c.border }]}
      accessibilityLabel={`Question ${index + 1} results: ${result.prompt}`}
    >
      <ThemedText style={[styles.questionNum, { color: c.secondaryText }]}>
        Q{index + 1}
      </ThemedText>
      <ThemedText style={[styles.prompt, { color: c.text }]}>
        {result.prompt}
      </ThemedText>
      <ThemedText style={[styles.responseCount, { color: c.secondaryText }]}>
        {result.total_responses} response{result.total_responses !== 1 ? 's' : ''}
      </ThemedText>

      {(result.type === 'multiple_choice_single' || result.type === 'multiple_choice_multi') && (
        <MCResults
          options={result.options}
          counts={result.option_counts}
          total={result.total_responses}
          c={c}
        />
      )}

      {result.type === 'rating' && (
        <RatingResults
          average={result.average}
          distribution={result.distribution}
          total={result.total_responses}
          c={c}
        />
      )}

      {result.type === 'free_text' && (
        <FreeTextResults responses={result.responses} c={c} />
      )}

      {result.type === 'ranked_choice' && (
        <RankedResults
          options={result.options}
          scores={result.borda_scores}
          c={c}
        />
      )}
    </View>
  );
}

// ─── Multiple Choice Results ──────────────────────────────────

function MCResults({
  options,
  counts,
  total,
  c,
}: {
  options: string[];
  counts: number[];
  total: number;
  c: any;
}) {
  const maxCount = Math.max(1, ...counts);

  return (
    <View style={styles.mcContainer}>
      {options.map((opt, idx) => {
        const count = counts[idx] ?? 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const barWidth = total > 0 ? (count / maxCount) * 100 : 0;

        return (
          <View key={idx} style={styles.mcRow}>
            <View style={styles.mcTextRow}>
              <ThemedText style={[styles.mcOption, { color: c.text }]} numberOfLines={2}>
                {opt}
              </ThemedText>
              <ThemedText style={[styles.mcPct, { color: c.secondaryText }]}>
                {count} ({pct}%)
              </ThemedText>
            </View>
            <View style={[styles.barBg, { backgroundColor: c.border }]}>
              <View
                style={[styles.barFill, { width: `${barWidth}%`, backgroundColor: c.accent }]}
              />
            </View>
          </View>
        );
      })}
    </View>
  );
}

// ─── Rating Results ───────────────────────────────────────────

function RatingResults({
  average,
  distribution,
  total,
  c,
}: {
  average: number;
  distribution: Record<string, number>;
  total: number;
  c: any;
}) {
  const maxCount = Math.max(1, ...Object.values(distribution));

  return (
    <View style={styles.ratingContainer}>
      {/* Average */}
      <View style={styles.averageRow}>
        <Ionicons name="star" size={24} color={c.accent} />
        <ThemedText style={[styles.averageText, { color: c.text }]}>
          {average.toFixed(1)}
        </ThemedText>
        <ThemedText style={[styles.averageLabel, { color: c.secondaryText }]}>
          / 5 average
        </ThemedText>
      </View>
      {/* Distribution */}
      <View style={styles.distContainer}>
        {[5, 4, 3, 2, 1].map((n) => {
          const count = distribution[String(n)] ?? 0;
          const barWidth = total > 0 ? (count / maxCount) * 100 : 0;
          return (
            <View key={n} style={styles.distRow}>
              <ThemedText style={[styles.distLabel, { color: c.secondaryText }]}>
                {n}
              </ThemedText>
              <View style={[styles.distBarBg, { backgroundColor: c.border }]}>
                <View
                  style={[styles.barFill, { width: `${barWidth}%`, backgroundColor: c.accent }]}
                />
              </View>
              <ThemedText style={[styles.distCount, { color: c.secondaryText }]}>
                {count}
              </ThemedText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─── Free Text Results ────────────────────────────────────────

function FreeTextResults({ responses, c }: { responses: string[]; c: any }) {
  if (responses.length === 0) {
    return (
      <ThemedText style={[styles.noResponses, { color: c.secondaryText }]}>
        No responses yet
      </ThemedText>
    );
  }

  return (
    <View style={styles.textContainer}>
      {responses.map((text, idx) => (
        <View
          key={idx}
          style={[styles.textResponse, { backgroundColor: c.card, borderColor: c.border }]}
        >
          <ThemedText style={[styles.textResponseContent, { color: c.text }]}>
            {text}
          </ThemedText>
        </View>
      ))}
    </View>
  );
}

// ─── Ranked Choice Results ────────────────────────────────────

function RankedResults({
  options,
  scores,
  c,
}: {
  options: string[];
  scores: number[];
  c: any;
}) {
  // Sort by score descending
  const ranked = options
    .map((opt, idx) => ({ opt, score: scores[idx] ?? 0, idx }))
    .sort((a, b) => b.score - a.score);
  const maxScore = Math.max(1, ...scores);

  return (
    <View style={styles.rankedContainer}>
      {ranked.map((item, pos) => {
        const barWidth = (item.score / maxScore) * 100;
        return (
          <View key={item.idx} style={styles.rankedRow}>
            <View style={styles.rankedLeft}>
              <ThemedText
                style={[
                  styles.rankedRank,
                  { color: pos === 0 ? c.accent : c.secondaryText },
                ]}
              >
                #{pos + 1}
              </ThemedText>
              <ThemedText style={[styles.rankedOption, { color: c.text }]} numberOfLines={2}>
                {item.opt}
              </ThemedText>
            </View>
            <View style={styles.rankedRight}>
              <View style={[styles.barBg, { backgroundColor: c.border }]}>
                <View
                  style={[
                    styles.barFill,
                    { width: `${barWidth}%`, backgroundColor: pos === 0 ? c.accent : c.activeBorder },
                  ]}
                />
              </View>
              <ThemedText style={[styles.rankedScore, { color: c.secondaryText }]}>
                {item.score} pts
              </ThemedText>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 1,
    padding: s(14),
    gap: s(6),
    ...cardShadow,
  },
  questionNum: { fontSize: ms(11), fontWeight: '700', textTransform: 'uppercase' },
  prompt: { fontSize: ms(15), fontWeight: '600', lineHeight: ms(20) },
  responseCount: { fontSize: ms(11), marginBottom: s(6) },
  // MC
  mcContainer: { gap: s(8) },
  mcRow: { gap: s(4) },
  mcTextRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  mcOption: { fontSize: ms(14), flex: 1 },
  mcPct: { fontSize: ms(12), fontWeight: '600', marginLeft: s(8) },
  // Bars (shared)
  barBg: { height: s(6), borderRadius: 3, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3 },
  // Rating
  ratingContainer: { gap: s(10) },
  averageRow: { flexDirection: 'row', alignItems: 'center', gap: s(6) },
  averageText: { fontSize: ms(28), fontWeight: '700' },
  averageLabel: { fontSize: ms(14) },
  distContainer: { gap: s(4) },
  distRow: { flexDirection: 'row', alignItems: 'center', gap: s(6) },
  distLabel: { width: s(14), fontSize: ms(12), fontWeight: '600', textAlign: 'center' },
  distBarBg: { flex: 1, height: s(6), borderRadius: 3, overflow: 'hidden' },
  distCount: { width: s(24), fontSize: ms(11), textAlign: 'right' },
  // Free text
  noResponses: { fontSize: ms(13), fontStyle: 'italic', textAlign: 'center', paddingVertical: s(12) },
  textContainer: { gap: s(6) },
  textResponse: { borderRadius: 8, borderWidth: 1, padding: s(10) },
  textResponseContent: { fontSize: ms(14), lineHeight: ms(20) },
  // Ranked
  rankedContainer: { gap: s(8) },
  rankedRow: { gap: s(4) },
  rankedLeft: { flexDirection: 'row', alignItems: 'center', gap: s(6) },
  rankedRank: { fontSize: ms(13), fontWeight: '700', width: s(26) },
  rankedOption: { fontSize: ms(14), flex: 1 },
  rankedRight: { gap: s(4), paddingLeft: s(32) },
  rankedScore: { fontSize: ms(11), textAlign: 'right' },
});
