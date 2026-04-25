import { StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

type TradeStep = 'proposed' | 'accepted' | 'in_review' | 'completed';

const STEPS: TradeStep[] = ['proposed', 'accepted', 'in_review', 'completed'];

const STEP_LABELS: Record<TradeStep, string> = {
  proposed: 'Proposed',
  accepted: 'Accepted',
  in_review: 'Review',
  completed: 'Complete',
};

/** Maps the proposal status to which steps are "done" */
function getActiveStep(status: string): number {
  switch (status) {
    case 'pending':
    case 'pending_drops':
      return 0;
    case 'accepted':
      return 1;
    case 'in_review':
      return 2;
    case 'completed':
      return 3;
    default:
      return -1; // terminal states like rejected/cancelled/vetoed
  }
}

interface TradeStatusTimelineProps {
  status: string;
  /** Countdown text for review period (e.g. "12h 30m remaining") */
  reviewCountdown?: string;
}

export function TradeStatusTimeline({ status, reviewCountdown }: TradeStatusTimelineProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const activeStep = getActiveStep(status);

  // Don't show timeline for terminal states
  if (activeStep < 0) return null;

  return (
    <View style={styles.container} accessibilityRole="progressbar" accessibilityLabel={`Trade status: ${status}`}>
      {/* Dots + connector lines row */}
      <View style={styles.dotsRow}>
        {STEPS.map((step, i) => {
          const isPast = i < activeStep;
          const isCurrent = i === activeStep;
          const isDone = i <= activeStep;

          return (
            <View key={step} style={styles.dotCell}>
              {/* Left connector line (spacer for first) */}
              <View style={[
                styles.connector,
                i > 0
                  ? { backgroundColor: isPast || isCurrent ? c.accent : c.border }
                  : { backgroundColor: 'transparent' },
              ]} />
              {/* Dot */}
              <View
                style={[
                  styles.dot,
                  isDone
                    ? { backgroundColor: c.accent }
                    : { backgroundColor: 'transparent', borderWidth: 2, borderColor: c.border },
                  isCurrent && { borderWidth: 2, borderColor: c.accent, backgroundColor: c.accent },
                ]}
              />
              {/* Right connector line (spacer for last) */}
              <View style={[
                styles.connector,
                i < STEPS.length - 1
                  ? { backgroundColor: isPast ? c.accent : c.border }
                  : { backgroundColor: 'transparent' },
              ]} />
            </View>
          );
        })}
      </View>

      {/* Labels row */}
      <View style={styles.labelsRow}>
        {STEPS.map((step, i) => {
          const isDone = i <= activeStep;
          const isCurrent = i === activeStep;
          return (
            <ThemedText
              key={step}
              style={[
                styles.label,
                { color: isDone ? c.text : c.secondaryText },
                isCurrent && styles.labelCurrent,
              ]}
            >
              {STEP_LABELS[step]}
            </ThemedText>
          );
        })}
      </View>

      {/* Review countdown */}
      {reviewCountdown && status === 'in_review' && (
        <View style={[styles.countdownWrap, { backgroundColor: c.cardAlt }]}>
          <ThemedText style={[styles.countdown, { color: c.secondaryText }]}>
            {reviewCountdown}
          </ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: s(4),
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    height: s(14),
  },
  dotCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  connector: {
    flex: 1,
    height: s(2),
  },
  dot: {
    width: s(12),
    height: s(12),
    borderRadius: 6,
  },
  labelsRow: {
    flexDirection: 'row',
    marginTop: s(4),
  },
  label: {
    flex: 1,
    fontSize: ms(10),
    fontWeight: '500',
    textAlign: 'center',
  },
  labelCurrent: {
    fontWeight: '700',
  },
  countdownWrap: {
    alignSelf: 'center',
    marginTop: s(8),
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 6,
  },
  countdown: {
    fontSize: ms(11),
    fontWeight: '600',
  },
});
