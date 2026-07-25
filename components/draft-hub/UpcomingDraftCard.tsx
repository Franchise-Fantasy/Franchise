import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Badge } from '@/components/ui/Badge';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { formatDraftType } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useColors } from '@/hooks/useColors';
import { supabase } from '@/lib/supabase';
import { formatDateTimeWithZone } from '@/utils/dates';
import { formatClockRemaining, formatPickClock } from '@/utils/draft/pickClock';
import { formatMinuteOfDay, formatQuietWindow } from '@/utils/draft/quietHours';
import { ms, s } from '@/utils/scale';

interface UpcomingDraft {
  id: string;
  type: 'initial' | 'rookie';
  status: 'unscheduled' | 'pending' | 'in_progress' | 'paused' | 'complete';
  pause_reason: 'commissioner' | 'quiet_hours' | null;
  draft_date: string | null;
  time_limit: number;
  rounds: number | null;
  draft_type: string | null;
  is_offline: boolean;
  quiet_hours_enabled: boolean | null;
  quiet_hours_start_min: number | null;
  quiet_hours_end_min: number | null;
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
        .select(
          'id, type, status, pause_reason, draft_date, time_limit, rounds, draft_type, is_offline, quiet_hours_enabled, quiet_hours_start_min, quiet_hours_end_min'
        )
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
  const isQuietPaused = draft.status === 'paused' && draft.pause_reason === 'quiet_hours';
  const scheduled = draft.status === 'pending' && !!draft.draft_date;
  const title = draft.type === 'rookie' ? 'Rookie Draft' : 'Startup Draft';
  const quietWindow = formatQuietWindow(draft);

  const when = isQuietPaused && draft.quiet_hours_end_min != null
    ? `Quiet hours — resumes ${formatMinuteOfDay(draft.quiet_hours_end_min)} ET`
    : isLive
      ? 'Live now'
      : scheduled
        ? `${formatDateTimeWithZone(new Date(draft.draft_date!))} · Starts in ${formatClockRemaining(new Date(draft.draft_date!).getTime() - now)}`
        : 'Not yet scheduled';

  // Each setting is its own chip (rather than one middot-joined string) so
  // nothing wraps mid-phrase at narrow widths.
  const chips = [
    formatDraftType(draft.draft_type),
    `${formatPickClock(draft.time_limit)} / pick`,
    draft.rounds ? `${draft.rounds} rd${draft.rounds === 1 ? '' : 's'}` : null,
    quietWindow ? `Quiet hours ${quietWindow}` : null,
  ].filter((c): c is string => !!c);

  const accessibilitySummary = `${title}. ${when}. ${chips.join(', ')}`;
  const tappable = !draft.is_offline;
  const onPress = () => router.push(`/draft-room/${draft.id}` as never);

  const body = (
    <View style={[styles.card, { backgroundColor: colors.heroSurface }, colors.heroShadow]}>
      <View style={styles.topRule} />
      <View style={styles.eyebrowRow}>
        <ThemedText type="varsity" style={styles.eyebrow}>
          Upcoming Draft
        </ThemedText>
        <View style={styles.eyebrowRightSlot}>
          {isLive && <Badge label="LIVE" variant="merlot" size="small" />}
          {tappable && (
            <IconSymbol name="chevron.right" size={14} color={Brand.ecruMuted} accessible={false} />
          )}
        </View>
      </View>

      <ThemedText type="display" style={styles.title} numberOfLines={1}>
        {title}
      </ThemedText>

      <ThemedText
        style={[styles.when, isLive ? styles.whenLive : null]}
        numberOfLines={1}
      >
        {when}
      </ThemedText>

      {chips.length > 0 && (
        <View style={styles.chipRow}>
          {chips.map((chip) => (
            <View key={chip} style={styles.chip}>
              <ThemedText type="varsitySmall" style={styles.chipText}>
                {chip}
              </ThemedText>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  if (!tappable) {
    return (
      <View style={styles.wrap} accessibilityRole="summary" accessibilityLabel={accessibilitySummary}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      style={styles.wrap}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${accessibilitySummary}. Tap to enter the draft room.`}
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
    position: 'relative',
    borderRadius: 16,
    paddingHorizontal: s(18),
    paddingTop: s(16),
    paddingBottom: s(14),
    overflow: 'hidden',
  },
  topRule: {
    position: 'absolute',
    top: 0,
    left: s(18),
    height: 3,
    width: s(40),
    backgroundColor: Brand.vintageGold,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: s(8),
  },
  eyebrow: {
    color: Brand.vintageGold,
    flexShrink: 1,
  },
  eyebrowRightSlot: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  title: {
    color: Brand.ecru,
    fontSize: ms(24),
    lineHeight: ms(28),
    marginTop: s(6),
  },
  when: {
    color: Brand.ecruMuted,
    fontSize: ms(13),
    marginTop: s(2),
  },
  whenLive: {
    color: Brand.vintageGold,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(6),
    marginTop: s(10),
  },
  chip: {
    borderWidth: 1,
    borderColor: 'rgba(233, 226, 203, 0.30)',
    backgroundColor: 'rgba(233, 226, 203, 0.08)',
    borderRadius: 6,
    paddingHorizontal: s(8),
    paddingVertical: s(4),
  },
  chipText: {
    color: Brand.ecruMuted,
  },
});
