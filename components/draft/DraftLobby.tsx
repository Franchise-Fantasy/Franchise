import { useMemo } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { LobbyDraftOrder } from '@/components/draft/LobbyDraftOrder';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { formatDraftType } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { useDraftStartCountdown } from '@/hooks/useDraftStartCountdown';
import { DraftState } from '@/types/draft';
import { formatDateTimeWithZone } from '@/utils/dates';
import { formatPickClock } from '@/utils/draft/pickClock';
import { ms, s } from '@/utils/scale';

type Colors = ReturnType<typeof useColors>;

interface DraftLobbyProps {
  draft: DraftState;
  draftId: string;
  leagueId: string;
  /** The viewing member's team, badged in the draft order list. */
  myTeamId: string | undefined;
  isRookieDraft: boolean;
  draftPickTradingEnabled: boolean;
}

/**
 * The one ticking element — isolated in its own component so the per-second
 * countdown update (and the start-draft kickoff the hook fires) don't re-render
 * the lobby's static hero + settings card every second. Only mounts while the
 * draft is scheduled, which is exactly when the hook has work to do.
 */
function LobbyCountdown({ draft, draftId, colors }: { draft: DraftState; draftId: string; colors: Colors }) {
  const { timeUntilDraft } = useDraftStartCountdown(draft, draftId);
  return (
    <>
      <ThemedText type="varsitySmall" style={[styles.countdownLabel, { color: colors.secondaryText }]}>
        {timeUntilDraft ? 'Starts In' : 'Starting…'}
      </ThemedText>
      {timeUntilDraft && (
        <ThemedText
          style={[styles.countdown, { color: colors.text }]}
          accessibilityLabel={`Draft starts in ${timeUntilDraft}`}
        >
          {timeUntilDraft}
        </ThemedText>
      )}
    </>
  );
}

/** Label/value line inside the settings card. */
function SettingRow({ label, value, colors }: { label: string; value: string; colors: Colors }) {
  return (
    <View style={styles.settingRow} accessibilityLabel={`${label}: ${value}`}>
      <ThemedText type="varsitySmall" style={[styles.settingLabel, { color: colors.secondaryText }]}>
        {label}
      </ThemedText>
      <ThemedText type="defaultSemiBold" style={[styles.settingValue, { color: colors.text }]}>
        {value}
      </ThemedText>
    </View>
  );
}

/**
 * Pre-draft lobby shown in the draft room while the draft is scheduled but not
 * yet live. Surfaces the live countdown, the local start time, and the draft's
 * settings so managers know exactly what they're walking into. Swaps over to
 * the live board automatically once `start-draft` flips the status (the shared
 * countdown hook owns that transition).
 */
export function DraftLobby({
  draft,
  draftId,
  leagueId,
  myTeamId,
  isRookieDraft,
  draftPickTradingEnabled,
}: DraftLobbyProps) {
  const colors = useColors();
  const scheduled = draft.status === 'pending' && !!draft.draft_date;

  const startLabel = useMemo(
    () => (draft.draft_date ? formatDateTimeWithZone(new Date(draft.draft_date)) : null),
    [draft.draft_date],
  );

  const settings = useMemo<{ label: string; value: string }[]>(() => {
    const rows = [
      { label: 'Format', value: formatDraftType(draft.draft_type) },
      { label: 'Rounds', value: String(draft.rounds) },
      { label: 'Time / Pick', value: formatPickClock(draft.time_limit) },
    ];
    if (draft.accelerate_after_round && draft.accelerated_time_limit) {
      rows.push({
        label: 'Speeds Up',
        value: `After R${draft.accelerate_after_round} → ${formatPickClock(draft.accelerated_time_limit)}`,
      });
    }
    if (!isRookieDraft) {
      rows.push({ label: 'Pick Trading', value: draftPickTradingEnabled ? 'On' : 'Off' });
    }
    return rows;
  }, [
    draft.draft_type,
    draft.rounds,
    draft.time_limit,
    draft.accelerate_after_round,
    draft.accelerated_time_limit,
    isRookieDraft,
    draftPickTradingEnabled,
  ]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <View
        style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}
        accessibilityRole="summary"
      >
        <ThemedText
          type="varsitySmall"
          style={[styles.eyebrow, { color: colors.gold }]}
          accessibilityRole="header"
        >
          {isRookieDraft ? 'Rookie Draft' : 'Draft'} Lobby
        </ThemedText>

        {scheduled ? (
          <>
            <LobbyCountdown draft={draft} draftId={draftId} colors={colors} />
            <ThemedText style={[styles.startTime, { color: colors.secondaryText }]}>{startLabel}</ThemedText>
          </>
        ) : (
          <>
            <ThemedText style={[styles.countdown, { color: colors.text }]}>Not Scheduled</ThemedText>
            <ThemedText style={[styles.startTime, { color: colors.secondaryText }]}>
              The commissioner hasn&apos;t set a start time yet.
            </ThemedText>
          </>
        )}
      </View>

      <View style={[styles.settingsCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {settings.map((row, i) => (
          <View key={row.label}>
            {i > 0 && <View style={[styles.divider, { backgroundColor: colors.border }]} />}
            <SettingRow label={row.label} value={row.value} colors={colors} />
          </View>
        ))}
      </View>

      <LobbyDraftOrder
        draftId={draftId}
        leagueId={leagueId}
        myTeamId={myTeamId}
        isRookieDraft={isRookieDraft}
        isSnake={draft.draft_type !== 'linear'}
      />

      <ThemedText style={[styles.footnote, { color: colors.secondaryText }]}>
        The board opens automatically when the draft begins. You can leave and come back — your spot
        is saved.
      </ThemedText>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: s(20),
    gap: s(16),
  },
  hero: {
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: s(16),
    paddingVertical: s(28),
    paddingHorizontal: s(20),
    gap: s(6),
  },
  eyebrow: {
    fontSize: ms(13),
    letterSpacing: 1,
    marginBottom: s(4),
  },
  countdownLabel: {
    fontSize: ms(12),
    letterSpacing: 1,
  },
  countdown: {
    fontFamily: Fonts.mono,
    fontSize: ms(48),
    fontVariant: ['tabular-nums'],
    lineHeight: ms(54),
  },
  startTime: {
    fontSize: ms(14),
    marginTop: s(4),
    textAlign: 'center',
  },
  settingsCard: {
    borderWidth: 1,
    borderRadius: s(16),
    paddingHorizontal: s(16),
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: s(14),
  },
  settingLabel: {
    fontSize: ms(13),
    letterSpacing: 0.5,
  },
  settingValue: {
    fontSize: ms(15),
    flexShrink: 1,
    textAlign: 'right',
    marginLeft: s(12),
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  footnote: {
    fontSize: ms(12),
    textAlign: 'center',
    lineHeight: ms(18),
    paddingHorizontal: s(12),
  },
});
