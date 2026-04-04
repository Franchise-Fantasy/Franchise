import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useSurvey, useSurveyResponseCount, useSurveyStatus } from '@/hooks/chat/useSurveys';
import { useLeague } from '@/hooks/useLeague';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useEffect, useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface Props {
  surveyId: string;
  teamId: string;
  isCommissioner: boolean;
  /** Embedded data from get_messages_page to avoid extra fetch */
  embedded?: {
    title?: string;
    description?: string;
    questionCount?: number;
    closesAt?: string;
    resultsVisibility?: string;
  };
}

function formatCountdown(closesAt: string): string {
  const diff = new Date(closesAt).getTime() - Date.now();
  if (diff <= 0) return 'Closed';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m left`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ${mins % 60}m left`;
  const days = Math.floor(hrs / 24);
  return `${days}d ${hrs % 24}h left`;
}

export const SurveyBubble = React.memo(function SurveyBubble({
  surveyId,
  teamId,
  isCommissioner,
  embedded,
}: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();

  const { data: surveyData } = useSurvey(surveyId);
  const { data: status } = useSurveyStatus(surveyId, teamId);
  const { data: league } = useLeague();
  const { data: responseCount } = useSurveyResponseCount(surveyId, isCommissioner);
  const [countdown, setCountdown] = useState('');

  // Use embedded data as fallback while full data loads
  const title = surveyData?.survey.title ?? embedded?.title;
  const description = surveyData?.survey.description ?? embedded?.description;
  const questionCount = surveyData?.questions.length ?? embedded?.questionCount ?? 0;
  const closesAt = surveyData?.survey.closes_at ?? embedded?.closesAt;
  const resultsVisibility =
    surveyData?.survey.results_visibility ?? embedded?.resultsVisibility ?? 'commissioner';

  const isClosed = useMemo(
    () => (closesAt ? new Date(closesAt) <= new Date() : false),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [closesAt, countdown],
  );

  const hasSubmitted = status?.hasSubmitted ?? false;

  // Countdown timer
  useEffect(() => {
    if (!closesAt) return;
    setCountdown(formatCountdown(closesAt));
    const interval = setInterval(() => setCountdown(formatCountdown(closesAt)), 10_000);
    return () => clearInterval(interval);
  }, [closesAt]);

  // Loading skeleton
  if (!title) {
    return (
      <View
        style={[styles.container, { backgroundColor: c.cardAlt, borderColor: c.border }]}
        accessibilityLabel="Loading survey"
      >
        <View style={[styles.skeletonBar, styles.skeletonHeader, { backgroundColor: c.border }]} />
        <View style={[styles.skeletonBar, styles.skeletonTitle, { backgroundColor: c.border }]} />
        <View style={[styles.skeletonBar, styles.skeletonBtn, { backgroundColor: c.border }]} />
      </View>
    );
  }

  // Determine action button state
  let btnLabel: string;
  let btnDisabled = false;
  let navigateTo = `/survey/${surveyId}`;

  if (!isClosed && !hasSubmitted) {
    btnLabel = 'Take Survey';
  } else if (!isClosed && hasSubmitted && isCommissioner) {
    btnLabel = 'View Results';
    navigateTo = `/survey/${surveyId}?tab=results`;
  } else if (!isClosed && hasSubmitted) {
    btnLabel = 'Submitted';
    btnDisabled = true;
  } else if (isClosed && (resultsVisibility === 'everyone' || isCommissioner)) {
    btnLabel = 'View Results';
    navigateTo = `/survey/${surveyId}?tab=results`;
  } else {
    btnLabel = 'Survey Closed';
    btnDisabled = true;
  }

  return (
    <View
      style={[styles.container, { backgroundColor: c.cardAlt, borderColor: c.border }]}
      accessibilityRole="summary"
      accessibilityLabel={`Commissioner survey: ${title}`}
    >
      {/* Header */}
      <View style={styles.header}>
        <Ionicons name="clipboard-outline" size={16} color={c.accent} accessible={false} />
        <ThemedText style={[styles.headerLabel, { color: c.accent }]}>
          Commissioner Survey
        </ThemedText>
      </View>

      {/* Title */}
      <ThemedText style={[styles.title, { color: c.text }]}>{title}</ThemedText>

      {/* Description */}
      {!!description && description.length > 0 && (
        <ThemedText
          style={[styles.description, { color: c.secondaryText }]}
          numberOfLines={2}
        >
          {description}
        </ThemedText>
      )}

      {/* Meta row */}
      <View style={styles.metaRow}>
        <ThemedText style={[styles.metaText, { color: c.secondaryText }]}>
          {questionCount} question{questionCount !== 1 ? 's' : ''}
        </ThemedText>
        <ThemedText style={[styles.metaDot, { color: c.secondaryText }]}>·</ThemedText>
        <ThemedText style={[styles.metaText, { color: c.secondaryText }]}>
          {isClosed ? 'Closed' : countdown}
        </ThemedText>
        {isCommissioner && responseCount != null && (
          <>
            <ThemedText style={[styles.metaDot, { color: c.secondaryText }]}>·</ThemedText>
            <ThemedText
              style={[styles.metaText, { color: c.secondaryText }]}
              accessibilityLabel={`${responseCount} of ${league?.league_teams?.length ?? '?'} responses`}
            >
              {responseCount}/{league?.league_teams?.length ?? '?'} responded
            </ThemedText>
          </>
        )}
      </View>

      {/* Action button */}
      <TouchableOpacity
        onPress={() => {
          if (!btnDisabled) router.push(navigateTo as any);
        }}
        disabled={btnDisabled}
        style={[
          styles.actionBtn,
          {
            backgroundColor: btnDisabled ? c.buttonDisabled : c.accent,
          },
        ]}
        accessibilityRole="button"
        accessibilityLabel={btnLabel}
        accessibilityState={{ disabled: btnDisabled }}
      >
        {hasSubmitted && !isClosed && (
          <Ionicons name="checkmark-circle" size={18} color={c.statusText} style={{ marginRight: s(4) }} />
        )}
        <ThemedText style={[styles.actionBtnText, { color: c.statusText }]}>{btnLabel}</ThemedText>
      </TouchableOpacity>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: 16,
    borderWidth: 1,
    padding: s(14),
    marginVertical: s(4),
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    marginBottom: s(8),
  },
  headerLabel: {
    fontSize: ms(12),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  title: {
    fontSize: ms(16),
    fontWeight: '600',
    lineHeight: ms(22),
    marginBottom: s(2),
  },
  description: {
    fontSize: ms(13),
    lineHeight: ms(18),
    marginBottom: s(4),
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    marginBottom: s(10),
  },
  metaText: { fontSize: ms(12) },
  metaDot: { fontSize: ms(12) },
  actionBtn: {
    borderRadius: 10,
    paddingVertical: s(10),
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  actionBtnText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
  // Skeleton
  skeletonBar: { borderRadius: 6, opacity: 0.4 },
  skeletonHeader: { width: s(140), height: s(14), marginBottom: s(10) },
  skeletonTitle: { width: '70%', height: s(18), marginBottom: s(12) },
  skeletonBtn: { height: s(40), borderRadius: 10, width: '100%' },
});
