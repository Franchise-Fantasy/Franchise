import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ui/ThemedText';
import { formatDraftType } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { formatDateTimeWithZone } from '@/utils/dates';
import { formatClockRemaining, formatPickClock } from '@/utils/draft/pickClock';
import { ms, s } from '@/utils/scale';

interface UpcomingDraft {
  id: string;
  type: 'initial' | 'rookie';
  status: 'unscheduled' | 'pending' | 'in_progress' | 'paused' | 'complete';
  draft_date: string | null;
  time_limit: number;
  rounds: number | null;
  draft_type: string | null;
  is_offline: boolean;
}

/**
 * Compact banner at the top of the Draft Hub that surfaces the league's
 * next (non-complete) draft — when it starts and how it's configured — so
 * dynasty managers don't have to enter the room to see the schedule. Renders
 * nothing when there's no active draft (most of the season). Tapping enters the
 * room (which shows the pre-draft lobby / live board); offline drafts, recorded
 * by hand elsewhere, render as a plain info card.
 */
export function UpcomingDraftCard({ leagueId }: { leagueId: string }) {
  const colors = useColors();
  const router = useRouter();
  // Snapshot at mount — the "starts in" label is a coarse hint (days/hours),
  // not a live ticker, so a render-time now() isn't worth an interval.
  const [now] = useState(() => Date.now());

  const { data: draft } = useQuery({
    queryKey: queryKeys.upcomingDraft(leagueId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('id, type, status, draft_date, time_limit, rounds, draft_type, is_offline')
        .eq('league_id', leagueId)
        .neq('status', 'complete')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as UpcomingDraft | null;
    },
  });

  if (!draft) return null;

  const isLive = draft.status === 'in_progress' || draft.status === 'paused';
  const scheduled = draft.status === 'pending' && !!draft.draft_date;
  const title = draft.type === 'rookie' ? 'Rookie Draft' : 'Startup Draft';

  const when = isLive
    ? 'Live now'
    : scheduled
      ? `Starts in ${formatClockRemaining(new Date(draft.draft_date!).getTime() - now)}`
      : 'Not yet scheduled';

  const settingsLine = [
    formatDraftType(draft.draft_type),
    `${formatPickClock(draft.time_limit)} / pick`,
    draft.rounds ? `${draft.rounds} rd${draft.rounds === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join('  ·  ');

  const details = scheduled
    ? `${formatDateTimeWithZone(new Date(draft.draft_date!))}  ·  ${settingsLine}`
    : settingsLine;

  const tappable = !draft.is_offline;
  const onPress = () => router.push(`/draft-room/${draft.id}` as never);

  const body = (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={styles.textCol}>
        <ThemedText type="varsitySmall" style={[styles.eyebrow, { color: colors.gold }]}>
          Upcoming Draft
        </ThemedText>
        <ThemedText type="defaultSemiBold" style={[styles.title, { color: colors.text }]}>
          {title}
        </ThemedText>
        <ThemedText style={[styles.when, { color: isLive ? colors.gold : colors.secondaryText }]}>
          {when}
        </ThemedText>
        <ThemedText style={[styles.details, { color: colors.secondaryText }]} numberOfLines={2}>
          {details}
        </ThemedText>
      </View>
      {tappable && (
        <IconSymbol name="chevron.right" size={18} color={colors.secondaryText} accessible={false} />
      )}
    </View>
  );

  if (!tappable) {
    return (
      <View style={styles.wrap} accessibilityRole="summary" accessibilityLabel={`${title}. ${when}. ${settingsLine}`}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      style={styles.wrap}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${when}. ${settingsLine}. Tap to enter the draft room.`}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: s(16),
    paddingTop: s(12),
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: s(14),
    paddingVertical: s(14),
    paddingHorizontal: s(16),
    gap: s(12),
  },
  textCol: {
    flex: 1,
    gap: s(2),
  },
  eyebrow: {
    fontSize: ms(11),
    letterSpacing: 1,
  },
  title: {
    fontSize: ms(16),
  },
  when: {
    fontSize: ms(13),
    marginTop: s(1),
  },
  details: {
    fontSize: ms(12),
    marginTop: s(2),
  },
});
