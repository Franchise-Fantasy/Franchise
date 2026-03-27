import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useClosePoll, usePoll, usePollResults, useVotePoll } from '@/hooks/chat';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';

interface Props {
  pollId: string;
  teamId: string;
  isCommissioner: boolean;
}

function formatCountdown(closesAt: string): string {
  const diff = new Date(closesAt).getTime() - Date.now();
  if (diff <= 0) return 'Closed';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `Closes in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Closes in ${hrs}h ${mins % 60}m`;
  const days = Math.floor(hrs / 24);
  return `Closes in ${days}d ${hrs % 24}h`;
}

export const PollBubble = React.memo(function PollBubble({ pollId, teamId, isCommissioner }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: poll } = usePoll(pollId);
  const { data: results } = usePollResults(pollId, poll, teamId);
  const voteMutation = useVotePoll(pollId);
  const closeMutation = useClosePoll(pollId);

  const [selected, setSelected] = useState<number[]>([]);
  const [countdown, setCountdown] = useState('');

  const isClosed = useMemo(
    () => poll ? new Date(poll.closes_at) <= new Date() : false,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [poll?.closes_at, countdown],
  );

  const hasVoted = results?.myVote != null;
  const canVote = !isClosed && !hasVoted;
  const showResults =
    isClosed || (poll?.show_live_results && (hasVoted || isCommissioner));
  const showHiddenMsg =
    hasVoted && !poll?.show_live_results && !isClosed;

  // Countdown timer
  useEffect(() => {
    if (!poll) return;
    setCountdown(formatCountdown(poll.closes_at));
    const interval = setInterval(() => {
      setCountdown(formatCountdown(poll.closes_at));
    }, 10_000);
    return () => clearInterval(interval);
  }, [poll?.closes_at, poll]);

  const handleToggleOption = useCallback(
    (idx: number) => {
      if (!canVote || !poll) return;
      if (poll.poll_type === 'single') {
        setSelected([idx]);
      } else {
        setSelected((prev) =>
          prev.includes(idx) ? prev.filter((i) => i !== idx) : [...prev, idx],
        );
      }
    },
    [canVote, poll],
  );

  const handleVote = useCallback(() => {
    if (selected.length === 0) return;
    voteMutation.mutate(selected, {
      onError: (err: any) => {
        Alert.alert('Vote Failed', err.message ?? 'Something went wrong');
      },
    });
  }, [selected, voteMutation]);

  if (!poll || !results) {
    // Skeleton that approximates a typical poll's height to prevent layout jump
    return (
      <View
        style={[styles.container, { backgroundColor: c.cardAlt, borderColor: c.border }]}
        accessibilityLabel="Loading poll"
      >
        {/* Header skeleton */}
        <View style={[styles.skeletonBar, styles.skeletonHeader, { backgroundColor: c.border }]} />
        {/* Question skeleton */}
        <View style={[styles.skeletonBar, styles.skeletonQuestion, { backgroundColor: c.border }]} />
        {/* Option skeletons (3 typical options) */}
        <View style={styles.skeletonOptions}>
          <View style={[styles.skeletonBar, styles.skeletonOption, { backgroundColor: c.border }]} />
          <View style={[styles.skeletonBar, styles.skeletonOption, { backgroundColor: c.border }]} />
          <View style={[styles.skeletonBar, styles.skeletonOption, { backgroundColor: c.border }]} />
        </View>
        {/* Footer skeleton */}
        <View style={[styles.skeletonBar, styles.skeletonFooter, { backgroundColor: c.border }]} />
      </View>
    );
  }

  const maxCount = Math.max(1, ...results.optionCounts);
  const teamCount = results.totalVotes; // used in participation label

  return (
    <View
      style={[styles.container, { backgroundColor: c.cardAlt, borderColor: c.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`Commissioner poll: ${poll.question}`}
    >
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="bar-chart-outline" size={16} color={c.accent} accessible={false} />
        <ThemedText style={[styles.headerLabel, { color: c.accent }]}>
          Commissioner Poll
        </ThemedText>
        {poll.is_anonymous && (
          <View style={styles.anonBadge}>
            <Ionicons name="lock-closed" size={12} color={c.secondaryText} accessible={false} />
            <ThemedText style={[styles.badgeText, { color: c.secondaryText }]}>
              Anonymous
            </ThemedText>
          </View>
        )}
      </View>

      {/* Question */}
      <ThemedText style={[styles.question, { color: c.text }]}>
        {poll.question}
      </ThemedText>

      {/* Poll type indicator */}
      <ThemedText style={[styles.typeHint, { color: c.secondaryText }]}>
        {poll.poll_type === 'multi' ? 'Select all that apply' : 'Select one'}
      </ThemedText>

      {/* Options */}
      <View
        style={styles.options}
        accessibilityRole={poll.poll_type === 'single' ? 'radiogroup' : 'none'}
      >
        {poll.options.map((option: string, idx: number) => {
          const isMyVote = results.myVote?.includes(idx);
          const isSelected = selected.includes(idx);
          const count = results.optionCounts[idx] ?? 0;
          const pct = results.totalVotes > 0 ? Math.round((count / results.totalVotes) * 100) : 0;
          const barWidth = results.totalVotes > 0 ? (count / maxCount) * 100 : 0;

          return (
            <TouchableOpacity
              key={idx}
              onPress={() => handleToggleOption(idx)}
              disabled={!canVote}
              style={[
                styles.optionRow,
                {
                  borderColor: isMyVote
                    ? c.accent
                    : isSelected
                      ? c.activeBorder
                      : c.border,
                  backgroundColor: isMyVote
                    ? c.activeCard
                    : c.card,
                },
              ]}
              accessibilityRole={poll.poll_type === 'single' ? 'radio' : 'checkbox'}
              accessibilityState={{
                checked: isMyVote || isSelected,
                disabled: !canVote,
              }}
              accessibilityLabel={
                showResults
                  ? `${option}, ${count} votes, ${pct} percent${isMyVote ? ', your vote' : ''}`
                  : `${option}${isMyVote ? ', your vote' : ''}`
              }
            >
              {/* Selection indicator */}
              {canVote && (
                <View
                  style={[
                    poll.poll_type === 'single' ? styles.radio : styles.checkbox,
                    {
                      borderColor: isSelected ? c.accent : c.border,
                      backgroundColor: isSelected ? c.accent : 'transparent',
                    },
                  ]}
                >
                  {isSelected && (
                    <Ionicons
                      name={poll.poll_type === 'single' ? 'ellipse' : 'checkmark'}
                      size={poll.poll_type === 'single' ? 8 : 12}
                      color={c.statusText}
                    />
                  )}
                </View>
              )}

              {/* Voted checkmark */}
              {hasVoted && isMyVote && (
                <Ionicons name="checkmark-circle" size={18} color={c.accent} style={styles.votedIcon} />
              )}

              {/* Option text + result bar */}
              <View style={styles.optionContent}>
                <View style={styles.optionTextRow}>
                  <ThemedText
                    style={[styles.optionText, { color: c.text }]}
                    numberOfLines={2}
                  >
                    {option}
                  </ThemedText>
                  {showResults && (
                    <ThemedText style={[styles.pctText, { color: c.secondaryText }]}>
                      {pct}%
                    </ThemedText>
                  )}
                </View>
                {showResults && (
                  <View style={[styles.barBg, { backgroundColor: c.border }]}>
                    <View
                      style={[
                        styles.barFill,
                        {
                          width: `${barWidth}%`,
                          backgroundColor: isMyVote ? c.accent : c.activeBorder,
                        },
                      ]}
                    />
                  </View>
                )}
              </View>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Voter names (non-anonymous, results visible) */}
      {results.votersByOption && !poll.is_anonymous && showResults && (
        <View style={styles.votersSection}>
          {poll.options.map((option: string, idx: number) => {
            const voters = results.votersByOption?.[idx];
            if (!voters || voters.length === 0) return null;
            return (
              <ThemedText key={idx} style={[styles.voterLine, { color: c.secondaryText }]}>
                {option}: {voters.join(', ')}
              </ThemedText>
            );
          })}
        </View>
      )}

      {/* Hidden results message */}
      {showHiddenMsg && (
        <ThemedText style={[styles.hiddenMsg, { color: c.secondaryText }]}>
          Results will be revealed when the poll closes.
        </ThemedText>
      )}

      {/* Vote button */}
      {canVote && (
        <TouchableOpacity
          onPress={handleVote}
          disabled={selected.length === 0 || voteMutation.isPending}
          style={[
            styles.voteBtn,
            {
              backgroundColor:
                selected.length > 0 ? c.accent : c.buttonDisabled,
            },
          ]}
          accessibilityRole="button"
          accessibilityLabel="Submit vote"
          accessibilityState={{ disabled: selected.length === 0 || voteMutation.isPending }}
        >
          {voteMutation.isPending ? (
            <ActivityIndicator size="small" color={c.statusText} />
          ) : (
            <ThemedText style={[styles.voteBtnText, { color: c.statusText }]}>Vote</ThemedText>
          )}
        </TouchableOpacity>
      )}

      {/* Close poll early (commissioner only) */}
      {isCommissioner && !isClosed && (
        <TouchableOpacity
          onPress={() => {
            Alert.alert('Close Poll', 'Close this poll now? Voting will end immediately.', [
              { text: 'Cancel', style: 'cancel' },
              {
                text: 'Close Poll',
                style: 'destructive',
                onPress: () => closeMutation.mutate(),
              },
            ]);
          }}
          disabled={closeMutation.isPending}
          style={[styles.closeBtn, { borderColor: c.border }]}
          accessibilityRole="button"
          accessibilityLabel="Close poll early"
        >
          <Ionicons name="lock-closed" size={14} color={c.secondaryText} accessible={false} />
          <ThemedText style={[styles.closeBtnText, { color: c.secondaryText }]}>
            {closeMutation.isPending ? 'Closing...' : 'Close Poll'}
          </ThemedText>
        </TouchableOpacity>
      )}

      {/* Footer */}
      <View style={styles.footer}>
        <ThemedText style={[styles.footerText, { color: c.secondaryText }]}>
          {isClosed ? 'Poll closed' : countdown}
        </ThemedText>
        <ThemedText style={[styles.footerText, { color: c.secondaryText }]}>
          {results.totalVotes} vote{results.totalVotes !== 1 ? 's' : ''}
        </ThemedText>
      </View>

      {/* Non-anonymous warning */}
      {!poll.is_anonymous && !isClosed && (
        <View style={styles.visibilityNote}>
          <Ionicons name="eye-outline" size={12} color={c.secondaryText} accessible={false} />
          <ThemedText style={[styles.visibilityText, { color: c.secondaryText }]}>
            Votes are visible to all members
          </ThemedText>
        </View>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
    marginVertical: 4,
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  headerLabel: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  anonBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 'auto',
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  question: {
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 22,
    marginBottom: 4,
  },
  typeHint: {
    fontSize: 12,
    marginBottom: 10,
  },
  options: {
    gap: 6,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    gap: 8,
  },
  radio: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 4,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  votedIcon: {
    marginRight: -2,
  },
  optionContent: {
    flex: 1,
    gap: 4,
  },
  optionTextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  optionText: {
    fontSize: 14,
    flex: 1,
  },
  pctText: {
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 8,
  },
  barBg: {
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 2,
  },
  votersSection: {
    marginTop: 8,
    gap: 2,
  },
  voterLine: {
    fontSize: 11,
  },
  hiddenMsg: {
    fontSize: 12,
    fontStyle: 'italic',
    textAlign: 'center',
    marginTop: 10,
  },
  voteBtn: {
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 10,
  },
  voteBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 8,
    marginTop: 10,
  },
  closeBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  footerText: {
    fontSize: 11,
  },
  visibilityNote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
    justifyContent: 'center',
  },
  visibilityText: {
    fontSize: 11,
  },
  // Skeleton styles
  skeletonBar: {
    borderRadius: 6,
    opacity: 0.4,
  },
  skeletonHeader: {
    width: 120,
    height: 14,
    marginBottom: 10,
  },
  skeletonQuestion: {
    width: '75%',
    height: 18,
    marginBottom: 12,
  },
  skeletonOptions: {
    gap: 6,
  },
  skeletonOption: {
    height: 42,
    borderRadius: 10,
    width: '100%',
  },
  skeletonFooter: {
    width: 100,
    height: 12,
    marginTop: 12,
  },
});
