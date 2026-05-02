import { Image } from 'expo-image';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

// The embroidered F patch is used as a static watermark — bundled at
// module scope so the require() runs once, not on every render.
const PATCH_SOURCE = require('../../assets/images/patch_logo.png');

export type HomeHeroTeam = {
  tricode: string | null;
  name: string;
  wins: number | null;
  losses: number | null;
  ties: number | null;
};

export type PaymentBadge =
  | { state: 'due'; amount: number }
  | { state: 'pending' }
  | null;

export type HomeHeroVariant =
  | {
      kind: 'team_identity';
      team: HomeHeroTeam;
      leagueType: string;
      season: string | number;
      payment?: PaymentBadge;
    }
  | {
      kind: 'season_complete';
      leagueName: string;
      season: string | number;
      // Champion team name/tricode to surface in the eyebrow (e.g.
      // "Season 2025-26 · Champion · LAL"). Null if we can't resolve
      // the champion yet.
      championName: string | null;
      // User's team — if they're in this league, we show their final
      // record in the stat row. Otherwise the stat row falls back to
      // the trophy "View Champion" treatment.
      myTeam?: HomeHeroTeam | null;
      // Commissioner-only CTA to transition into the offseason.
      action?: { label: string; onPress: () => void } | null;
    }
  | {
      kind: 'draft_pending';
      season: string | number;
      draftType: string;
      draftDate: string | null;
      isReadyToEnter: boolean;
      isCommissioner: boolean;
      // Optional overlay: during pre-draft signups the draft hero also
      // carries invite affordances in the top-right slot.
      invite?: { code: string; slotsOpen: number } | null;
    }
  | {
      kind: 'invite_needed';
      inviteCode: string;
      season: string | number;
      slotsRemaining: number;
      /** When present, this is an imported-league setup state —
       *  teams were pre-created and members are claiming rather than
       *  creating. Switches the hero title to "Claim Teams." and the
       *  eyebrow to a progress count ("X/Y Claimed") instead of
       *  "N Open". */
      claimProgress?: { claimed: number; total: number };
    }
  | {
      kind: 'offseason';
      season: string | number;
      stepIndex: number; // 0-based — which entry in the steps list is active
      stepCount: number;
      stepLabel: string; // display title e.g. "Draft Lottery"
      nextStepLabel: string | null; // what comes next, or null if final
      // Contextual commissioner action for the current step. Omitted for
      // non-commissioners or steps with no action (e.g. Season Over).
      action?: { label: string; onPress: () => void } | null;
      // Dynasty-only roster cap warning.
      //  - `personal` — this user's own team is over the cap (shown on
      //    every offseason step for them, since they're the one with
      //    the fix to make).
      //  - `aggregate` — commissioner's view, surfaced only when the
      //    "Start Season" action is available so they see the blocker
      //    ahead of tapping.
      warning?:
        | { scope: 'personal'; overBy: number; onPress?: () => void }
        | { scope: 'aggregate'; count: number; onPress?: () => void }
        | null;
    };

type Props = {
  variant: HomeHeroVariant;
  onPress?: () => void;
  // Team-identity callbacks
  onPaymentPress?: () => void;
  // Draft callbacks
  onSchedulePress?: () => void;
  onEnterDraft?: () => void;
  // Invite callbacks
  onCopyInvite?: () => void;
  onShareInvite?: () => void;
};

/**
 * Brand-anchored home hero. Content morphs based on league state; the
 * eyebrow row carries the contextual quick-action slot (dues pill,
 * invite copy/share, draft schedule/enter) so the primary action is
 * always a thumb-stretch from the tricode/title.
 */
export function HomeHero({
  variant,
  onPress,
  onPaymentPress,
  onSchedulePress,
  onEnterDraft,
  onCopyInvite,
  onShareInvite,
}: Props) {
  const colors = useColors();
  const Wrapper = onPress ? TouchableOpacity : View;
  const wrapperProps = onPress
    ? {
        onPress,
        activeOpacity: 0.88,
        accessibilityRole: 'button' as const,
      }
    : {};

  return (
    <Wrapper
      style={[styles.card, { backgroundColor: colors.heroSurface }, colors.heroShadow]}
      {...wrapperProps}
    >
      <Image
        source={PATCH_SOURCE}
        style={styles.patch}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={0}
        accessible={false}
      />
      <View style={styles.topRule} />

      {variant.kind === 'team_identity' && (
        <TeamIdentity variant={variant} onPaymentPress={onPaymentPress} />
      )}
      {variant.kind === 'season_complete' && <SeasonComplete variant={variant} />}
      {variant.kind === 'draft_pending' && (
        <DraftPending
          variant={variant}
          onSchedulePress={onSchedulePress}
          onEnterDraft={onEnterDraft}
          onCopyInvite={onCopyInvite}
          onShareInvite={onShareInvite}
        />
      )}
      {variant.kind === 'invite_needed' && (
        <InviteNeeded
          variant={variant}
          onCopyInvite={onCopyInvite}
          onShareInvite={onShareInvite}
        />
      )}
      {variant.kind === 'offseason' && <Offseason variant={variant} />}
    </Wrapper>
  );
}

// ── Eyebrow ──────────────────────────────────────────────────────────

function EyebrowRow({
  segments,
  rightSlot,
}: {
  segments: string[];
  rightSlot?: ReactNode;
}) {
  return (
    <View style={styles.eyebrowRow}>
      <ThemedText type="varsity" style={styles.eyebrow} numberOfLines={1}>
        {segments.join(' · ')}
      </ThemedText>
      {rightSlot}
    </View>
  );
}

// ── Action pills ─────────────────────────────────────────────────────

/**
 * Static outline pill — used for non-urgent actions like Schedule or
 * Reschedule. Keep it understated so the pulsing primary action (Enter,
 * dues) reads as the priority.
 */
function OutlinePill({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.actionPill, styles.outlinePill]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      <ThemedText type="varsity" style={[styles.actionPillText, { color: Brand.ecru }]}>
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

/**
 * Pulsing gold action pill — glow/brightness breathes to signal urgency
 * and tappability. Used for Dues-Due and Draft-Enter-Now.
 */
function PulsingPill({
  label,
  onPress,
  accessibilityLabel,
}: {
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1300, useNativeDriver: false }),
        Animated.timing(pulse, { toValue: 0, duration: 1300, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const borderColor = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: ['rgba(233, 226, 203, 0.35)', 'rgba(233, 226, 203, 1)'],
  });
  const shadowOpacity = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.55],
  });

  return (
    <Animated.View
      style={{
        borderRadius: 8,
        shadowColor: Brand.vintageGold,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: 8,
        shadowOpacity,
        elevation: 4,
      }}
    >
      <TouchableOpacity
        onPress={onPress}
        activeOpacity={0.82}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
      >
        <Animated.View
          style={[
            styles.actionPill,
            { backgroundColor: Brand.vintageGold, borderColor, borderWidth: 1 },
          ]}
        >
          <ThemedText type="varsity" style={[styles.actionPillText, { color: Brand.ink }]}>
            {label}
          </ThemedText>
        </Animated.View>
      </TouchableOpacity>
    </Animated.View>
  );
}

/**
 * Circular icon button used for compact actions (copy, share). Sized to
 * fit a pair inline with the eyebrow text on mobile.
 */
function IconPill({
  icon,
  onPress,
  accessibilityLabel,
}: {
  icon: Parameters<typeof IconSymbol>[0]['name'];
  onPress?: () => void;
  accessibilityLabel: string;
}) {
  return (
    <TouchableOpacity
      style={styles.iconPill}
      onPress={onPress}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <IconSymbol name={icon} size={15} color={Brand.ecru} />
    </TouchableOpacity>
  );
}

// ── Variants ─────────────────────────────────────────────────────────

function TeamIdentity({
  variant,
  onPaymentPress,
}: {
  variant: Extract<HomeHeroVariant, { kind: 'team_identity' }>;
  onPaymentPress?: () => void;
}) {
  const { team, leagueType, season, payment } = variant;
  const wins = team.wins ?? 0;
  const losses = team.losses ?? 0;
  const ties = team.ties ?? 0;
  const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;

  const paymentSlot = payment
    ? payment.state === 'due'
      ? (
          <PulsingPill
            label={`Dues · $${payment.amount}`}
            onPress={onPaymentPress}
            accessibilityLabel={`League dues due: $${payment.amount}. Tap to pay.`}
          />
        )
      : (
          <OutlinePill
            label="Pending"
            onPress={onPaymentPress}
            accessibilityLabel="Payment pending confirmation"
          />
        )
    : null;

  return (
    <>
      <EyebrowRow
        segments={[leagueLabel(leagueType), shortSeason(season)]}
        rightSlot={paymentSlot}
      />

      <ThemedText type="display" style={styles.tricode} numberOfLines={1}>
        {team.tricode ?? team.name.slice(0, 4).toUpperCase()}
      </ThemedText>

      <ThemedText type="default" style={styles.subline} numberOfLines={1}>
        {team.name}
      </ThemedText>

      <View style={styles.statRow}>
        <ThemedText type="mono" style={styles.statValue}>
          {record}
        </ThemedText>
        <View style={styles.statDivider} />
        <ThemedText type="varsitySmall" style={styles.statLabel}>
          Record
        </ThemedText>
      </View>
    </>
  );
}

function SeasonComplete({
  variant,
}: {
  variant: Extract<HomeHeroVariant, { kind: 'season_complete' }>;
}) {
  const { season, championName, myTeam, action } = variant;

  // Eyebrow now carries the champion callout (moved up from the stat
  // row). Falls back to "Final" when we don't know the champion yet.
  const eyebrowSegments = championName
    ? [shortSeason(season), `Champion · ${championName}`]
    : [shortSeason(season), 'Final'];

  const wins = myTeam?.wins ?? 0;
  const losses = myTeam?.losses ?? 0;
  const ties = myTeam?.ties ?? 0;
  const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;

  return (
    <>
      <EyebrowRow
        segments={eyebrowSegments}
        rightSlot={
          action ? (
            <OutlinePill
              label={action.label}
              onPress={action.onPress}
              accessibilityLabel={action.label}
            />
          ) : undefined
        }
      />

      <ThemedText type="display" style={[styles.tricode, styles.titleText]} numberOfLines={2}>
        Season{'\n'}Complete.
      </ThemedText>

      {/* Stat row shows the user's final record when they're in the
          league; falls back to a trophy + View Champion hint for
          observers. Either way the top-level tap opens the bracket. */}
      {myTeam ? (
        <View style={styles.statRow}>
          <ThemedText type="mono" style={styles.statValue}>
            {record}
          </ThemedText>
          <View style={styles.statDivider} />
          <ThemedText type="varsitySmall" style={styles.statLabel}>
            Your Record
          </ThemedText>
        </View>
      ) : (
        <View style={styles.statRow}>
          <IconSymbol name="trophy.fill" size={16} color={Brand.vintageGold} />
          <ThemedText type="varsitySmall" style={[styles.statLabel, { marginLeft: s(8) }]}>
            View Champion
          </ThemedText>
        </View>
      )}
    </>
  );
}

function DraftPending({
  variant,
  onSchedulePress,
  onEnterDraft,
  onCopyInvite,
  onShareInvite,
}: {
  variant: Extract<HomeHeroVariant, { kind: 'draft_pending' }>;
  onSchedulePress?: () => void;
  onEnterDraft?: () => void;
  onCopyInvite?: () => void;
  onShareInvite?: () => void;
}) {
  const { draftDate, draftType, season, isReadyToEnter, isCommissioner, invite } =
    variant;
  const dateLabel = formatDraftDate(draftDate);
  const isScheduled = !!draftDate;

  // Eyebrow right-slot: invite affordances during pre-draft signups.
  const eyebrowSlot = invite ? (
    <View style={styles.iconGroup}>
      <IconPill icon="doc.on.doc" onPress={onCopyInvite} accessibilityLabel="Copy invite link" />
      <IconPill
        icon="square.and.arrow.up"
        onPress={onShareInvite}
        accessibilityLabel="Share invite link"
      />
    </View>
  ) : null;

  // Stat row: date on the left, action pill (or status label) on the right.
  // Priority: Enter Now pulsing > Commissioner Schedule/Reschedule > status label.
  let statRight: ReactNode;
  if (isReadyToEnter) {
    statRight = (
      <PulsingPill
        label="Enter"
        onPress={onEnterDraft}
        accessibilityLabel="Enter draft room now"
      />
    );
  } else if (isCommissioner) {
    statRight = (
      <OutlinePill
        label={isScheduled ? 'Reschedule' : 'Schedule'}
        onPress={onSchedulePress}
        accessibilityLabel={isScheduled ? 'Reschedule draft' : 'Schedule draft'}
      />
    );
  } else {
    statRight = (
      <ThemedText type="varsitySmall" style={styles.statLabel}>
        {isScheduled ? 'Scheduled' : 'Not Scheduled'}
      </ThemedText>
    );
  }

  return (
    <>
      <EyebrowRow
        segments={
          invite
            ? [shortSeason(season), draftTypeLabel(draftType), `${invite.slotsOpen} Open`]
            : [shortSeason(season), draftTypeLabel(draftType)]
        }
        rightSlot={eyebrowSlot}
      />

      <ThemedText type="display" style={[styles.tricode, styles.titleText]} numberOfLines={2}>
        {isReadyToEnter ? 'Draft\nNow.' : 'Draft\nRoom.'}
      </ThemedText>

      <View style={styles.statRow}>
        <ThemedText type="mono" style={styles.statValue}>
          {dateLabel}
        </ThemedText>
        <View style={styles.statDivider} />
        {statRight}
      </View>
    </>
  );
}

function Offseason({
  variant,
}: {
  variant: Extract<HomeHeroVariant, { kind: 'offseason' }>;
}) {
  const { season, stepIndex, stepCount, stepLabel, nextStepLabel, action, warning } =
    variant;

  return (
    <>
      <EyebrowRow
        segments={[shortSeason(season), 'Offseason']}
        rightSlot={
          action ? (
            <OutlinePill
              label={action.label}
              onPress={action.onPress}
              accessibilityLabel={action.label}
            />
          ) : undefined
        }
      />

      <ThemedText
        type="display"
        style={[styles.tricode, styles.titleText]}
        numberOfLines={2}
      >
        {stepLabel}.
      </ThemedText>

      <View style={styles.statRow}>
        <View style={styles.pipRow}>
          {Array.from({ length: stepCount }).map((_, i) => (
            <View
              key={i}
              style={[
                styles.pip,
                i <= stepIndex ? styles.pipActive : styles.pipInactive,
              ]}
            />
          ))}
        </View>
        <View style={styles.statDivider} />
        <ThemedText type="varsitySmall" style={styles.statLabel} numberOfLines={1}>
          {nextStepLabel ? `Up Next · ${nextStepLabel}` : 'Final Step'}
        </ThemedText>
      </View>

      {warning && <RosterOverageChip warning={warning} />}
    </>
  );
}

/**
 * Dynasty roster-cap warning — two flavors:
 *  - `personal` speaks directly to the user ("Your Roster · 2 Over")
 *    since they're the one with the fix to make. Shows across every
 *    offseason step when their own team is over.
 *  - `aggregate` is the commissioner's view ("3 Teams Over Cap"),
 *    surfaced only on the Start-Season step so it flags the blocker
 *    ahead of tapping and getting stopped by the compliance alert.
 */
type OverageWarning =
  | { scope: 'personal'; overBy: number; onPress?: () => void }
  | { scope: 'aggregate'; count: number; onPress?: () => void };

function RosterOverageChip({ warning }: { warning: OverageWarning }) {
  const label =
    warning.scope === 'personal'
      ? `Your Roster · ${warning.overBy} Over Cap`
      : `${warning.count} Team${warning.count === 1 ? '' : 's'} Over Cap`;

  const Wrapper = warning.onPress ? TouchableOpacity : View;
  const wrapperProps = warning.onPress
    ? {
        onPress: warning.onPress,
        activeOpacity: 0.82,
        accessibilityRole: 'button' as const,
        accessibilityLabel:
          warning.scope === 'personal'
            ? `${label}. Tap to manage your roster.`
            : `${label}. Tap to review rosters.`,
      }
    : {};

  return (
    <Wrapper style={styles.warningChip} {...wrapperProps}>
      <IconSymbol
        name="exclamationmark.triangle.fill"
        size={12}
        color={Brand.vintageGold}
      />
      <ThemedText type="varsitySmall" style={styles.warningChipText}>
        {label}
      </ThemedText>
      {warning.onPress && (
        <IconSymbol name="arrow.right" size={10} color={Brand.ecruMuted} />
      )}
    </Wrapper>
  );
}

function InviteNeeded({
  variant,
  onCopyInvite,
  onShareInvite,
}: {
  variant: Extract<HomeHeroVariant, { kind: 'invite_needed' }>;
  onCopyInvite?: () => void;
  onShareInvite?: () => void;
}) {
  const { inviteCode, season, slotsRemaining, claimProgress } = variant;

  // Imported-league setup reads better with a progress count than
  // "N Open" — members aren't opening new slots, they're claiming
  // pre-created teams. Title also switches to match that intent.
  const isImportedClaim = !!claimProgress;
  const eyebrowCount = isImportedClaim
    ? `${claimProgress.claimed}/${claimProgress.total} Claimed`
    : `${slotsRemaining} Open`;
  const titleLine1 = isImportedClaim ? 'Claim' : 'Add';
  const titleLine2 = isImportedClaim ? 'Teams.' : 'Players.';

  return (
    <>
      <EyebrowRow
        segments={[shortSeason(season), eyebrowCount]}
        rightSlot={
          <View style={styles.iconGroup}>
            <IconPill
              icon="doc.on.doc"
              onPress={onCopyInvite}
              accessibilityLabel="Copy invite link"
            />
            <IconPill
              icon="square.and.arrow.up"
              onPress={onShareInvite}
              accessibilityLabel="Share invite link"
            />
          </View>
        }
      />

      <ThemedText type="display" style={[styles.tricode, styles.titleText]} numberOfLines={2}>
        {titleLine1}{'\n'}{titleLine2}
      </ThemedText>

      <View style={styles.statRow}>
        <ThemedText type="mono" style={styles.statValue}>
          {inviteCode}
        </ThemedText>
        <View style={styles.statDivider} />
        <ThemedText type="varsitySmall" style={styles.statLabel}>
          Invite Code
        </ThemedText>
      </View>
    </>
  );
}

// ── Utilities ────────────────────────────────────────────────────────

function leagueLabel(kind: string): string {
  if (kind === 'dynasty') return 'Dynasty';
  if (kind === 'keeper') return 'Keeper';
  return 'Redraft';
}

// Compact season label — "2025-26" → "25-26". Defensively falls back
// to the raw string if the format doesn't look like YYYY-YY.
function shortSeason(season: string | number): string {
  const s = String(season);
  return /^\d{4}-\d{2}$/.test(s) ? s.slice(2) : s;
}

function draftTypeLabel(kind: string): string {
  if (kind === 'rookie') return 'Rookie Draft';
  if (kind === 'initial') return 'Initial Draft';
  return 'Draft';
}

function formatDraftDate(iso: string | null): string {
  if (!iso) return 'TBD';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'TBD';
  return d
    .toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
    .toUpperCase();
}

const styles = StyleSheet.create({
  card: {
    position: 'relative',
    borderRadius: 16,
    paddingHorizontal: s(22),
    paddingTop: s(22),
    paddingBottom: s(20),
    marginBottom: s(18),
    overflow: 'hidden',
  },
  topRule: {
    position: 'absolute',
    top: 0,
    left: s(22),
    height: 3,
    width: s(48),
    backgroundColor: Brand.vintageGold,
  },
  patch: {
    position: 'absolute',
    right: s(-22),
    bottom: s(-28),
    width: s(170),
    height: s(170),
    opacity: 0.16,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(8),
    gap: s(8),
  },
  eyebrow: {
    color: Brand.vintageGold,
    flexShrink: 1,
  },
  actionPill: {
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    borderRadius: 8,
  },
  outlinePill: {
    borderWidth: 1,
    borderColor: 'rgba(233, 226, 203, 0.45)',
    backgroundColor: 'rgba(233, 226, 203, 0.08)',
  },
  actionPillText: {
    fontSize: ms(11),
    letterSpacing: 0.8,
  },
  iconGroup: {
    flexDirection: 'row',
    gap: s(8),
  },
  iconPill: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    borderWidth: 1,
    borderColor: 'rgba(233, 226, 203, 0.45)',
    backgroundColor: 'rgba(233, 226, 203, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tricode: {
    color: Brand.ecru,
    fontSize: ms(44),
    lineHeight: ms(52),
    letterSpacing: -0.5,
  },
  titleText: {
    fontSize: ms(34),
    lineHeight: ms(40),
  },
  subline: {
    color: Brand.ecruMuted,
    marginTop: s(2),
    fontSize: ms(14),
    lineHeight: ms(18),
  },
  statRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: s(10),
  },
  statRowSplit: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: s(10),
  },
  statValue: {
    color: Brand.ecru,
    fontSize: ms(14),
  },
  statDivider: {
    width: s(10),
    height: 1,
    backgroundColor: Brand.vintageGold,
    marginHorizontal: s(10),
    opacity: 0.6,
  },
  statLabel: {
    color: Brand.ecruMuted,
  },
  // Offseason pip stepper — filled dots trail the current step, hollow
  // dots wait ahead. Gold for completed/current, ecru-faint for upcoming.
  pipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
  },
  pip: {
    width: s(7),
    height: s(7),
    borderRadius: s(4),
  },
  pipActive: {
    backgroundColor: Brand.vintageGold,
  },
  pipInactive: {
    backgroundColor: 'rgba(233, 226, 203, 0.25)',
  },
  warningChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: s(6),
    marginTop: s(10),
    paddingHorizontal: s(10),
    paddingVertical: s(5),
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(181, 123, 48, 0.55)',
    backgroundColor: 'rgba(181, 123, 48, 0.14)',
  },
  warningChipText: {
    color: Brand.vintageGold,
  },
});
