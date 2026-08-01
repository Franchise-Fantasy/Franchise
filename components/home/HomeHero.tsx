import { Image } from 'expo-image';
import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, StyleSheet, TouchableOpacity, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { BETWEEN_SEASONS_LABEL } from '@/utils/league/offseasonState';
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
      // Champion team — surfaced in the crown strip at the bottom of the
      // hero (logo + full name + View Bracket). Null if we can't resolve
      // the champion yet, in which case the strip is omitted.
      champion: { name: string; tricode: string | null; logoKey: string | null } | null;
      // User's team — if they're in this league, we show their final
      // record in the stat row. Otherwise the stat row is omitted (the
      // champion strip carries the View Bracket affordance).
      myTeam?: HomeHeroTeam | null;
      // Commissioner-only CTA to transition into the offseason.
      action?: { label: string; onPress: () => void } | null;
    }
  | {
      kind: 'draft_pending';
      season: string | number;
      draftType: string;
      draftDate: string | null;
      // Once the draft is running or paused the start time is history — the
      // stat row shows the live status instead. `pauseReason` distinguishes a
      // commissioner pause from the automated overnight quiet-hours freeze.
      draftStatus: string | null;
      pauseReason: 'commissioner' | 'quiet_hours' | null;
      isReadyToEnter: boolean;
      isCommissioner: boolean;
      // Optional overlay: during pre-draft signups the draft hero also
      // carries invite affordances in the top-right slot.
      invite?: { code: string; slotsOpen: number } | null;
      // Dues pill for non-commissioners whose buy-in is still due —
      // mutually exclusive with `invite` (commissioner-only) in practice
      // since paymentBadge is null for commissioners.
      payment?: PaymentBadge;
      // Manual draft order — when the league's `initial_draft_order` is
      // 'manual' and this is the initial draft, commissioners need a
      // way to set / edit the team-by-team order before scheduling.
      // `null` for non-manual or non-initial drafts.
      manualOrder?: { slotsAssigned: boolean } | null;
      // Offline-eligible — an in-app rookie draft that hasn't started, so the
      // commissioner can switch it to offline from the hero. `false`/omitted
      // for non-rookie or already-offline drafts.
      offlineEligible?: boolean;
      // Offline rookie draft — the commissioner runs it in person / elsewhere
      // and records results by hand. When true the hero shows an "Offline
      // Draft" state (Enter Results for the commissioner, informational for
      // members) instead of the live Schedule/Enter pills. `canToggle` gates
      // the commissioner's mode switch (rookie draft, not yet started).
      offline?: { canToggle: boolean } | null;
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
      // Redraft/keeper dormant step only: when the incoming rookie class lands
      // and the draft opens. There is no action to offer during the wait, so
      // this is what the hero says instead of "Up Next".
      draftOpens?: { label: string; days: number } | null;
    };

type Props = {
  variant: HomeHeroVariant;
  onPress?: () => void;
  // Team-identity callbacks
  onPaymentPress?: () => void;
  // Draft callbacks
  onSchedulePress?: () => void;
  onEnterDraft?: () => void;
  onSetDraftOrder?: () => void;
  // Offline rookie draft callbacks
  onEnterOfflineResults?: () => void;
  onRunOffline?: () => void;
  onSwitchToInApp?: () => void;
  // Invite callback
  onShareInvite?: () => void;
  // Commissioner notice: an imported league still has teams whose rosters were
  // never imported ("finish rosters later"). Renders a tappable warning chip
  // under the variant content — variant-agnostic since pending rosters can
  // linger through setup, the season, and the offseason. Tapping routes to
  // League Info to finish the imports. `count` is how many teams are empty.
  rostersPending?: { count: number; onPress: () => void } | null;
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
  onSetDraftOrder,
  onEnterOfflineResults,
  onRunOffline,
  onSwitchToInApp,
  onShareInvite,
  rostersPending,
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
          onShareInvite={onShareInvite}
          onPaymentPress={onPaymentPress}
          onSetDraftOrder={onSetDraftOrder}
          onEnterOfflineResults={onEnterOfflineResults}
          onRunOffline={onRunOffline}
          onSwitchToInApp={onSwitchToInApp}
        />
      )}
      {variant.kind === 'invite_needed' && (
        <InviteNeeded variant={variant} onShareInvite={onShareInvite} />
      )}
      {variant.kind === 'offseason' && <Offseason variant={variant} />}

      {rostersPending && (
        <RostersPendingChip
          count={rostersPending.count}
          onPress={rostersPending.onPress}
        />
      )}
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
  icon,
}: {
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
  icon?: Parameters<typeof IconSymbol>[0]['name'];
}) {
  return (
    <TouchableOpacity
      style={[styles.actionPill, styles.outlinePill, icon ? styles.actionPillRow : null]}
      onPress={onPress}
      activeOpacity={0.8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
    >
      {icon && <IconSymbol name={icon} size={13} color={Brand.ecru} />}
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
            icon="dollarsign.square.fill"
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
  const { season, champion, myTeam, action } = variant;

  const wins = myTeam?.wins ?? 0;
  const losses = myTeam?.losses ?? 0;
  const ties = myTeam?.ties ?? 0;
  const record = ties > 0 ? `${wins}-${losses}-${ties}` : `${wins}-${losses}`;

  return (
    // Two-column layout spanning the full card height: the eyebrow, title and
    // record run down the left; the champion crown (and the commissioner's
    // Advance-Season CTA) occupy the top-right corner — level with the eyebrow,
    // filling the card's otherwise-empty right half without growing its height.
    // The whole hero taps through to the bracket, so the champion block is a
    // visual affordance, not its own touch target.
    <View style={styles.completeBody}>
      <View style={styles.completeMain}>
        <EyebrowRow segments={[shortSeason(season), 'Final']} />

        <ThemedText type="display" style={[styles.tricode, styles.titleText]} numberOfLines={2}>
          Season{'\n'}Complete.
        </ThemedText>

        {myTeam && (
          <View style={styles.statRow}>
            <ThemedText type="mono" style={styles.statValue}>
              {record}
            </ThemedText>
            <View style={styles.statDivider} />
            <ThemedText type="varsitySmall" style={styles.statLabel}>
              Your Record
            </ThemedText>
          </View>
        )}
      </View>

      {/* Top-right column: commissioner CTA above the champion crown. Champion
          is omitted until it resolves from the finalized bracket. */}
      {(action || champion) && (
        <View style={styles.championBlock}>
          {action && (
            <OutlinePill
              label={action.label}
              onPress={action.onPress}
              accessibilityLabel={action.label}
            />
          )}
          {champion && (
            <>
              <View style={styles.championLabelRow}>
                <IconSymbol name="trophy.fill" size={11} color={Brand.vintageGold} />
                <ThemedText type="varsitySmall" style={styles.championLabel}>
                  Champion
                </ThemedText>
              </View>
              <View style={styles.championTeamRow}>
                <TeamLogo
                  logoKey={champion.logoKey}
                  teamName={champion.name}
                  tricode={champion.tricode ?? undefined}
                  size="small"
                />
                <ThemedText
                  type="defaultSemiBold"
                  style={styles.championName}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {champion.name}
                </ThemedText>
              </View>
            </>
          )}
        </View>
      )}
    </View>
  );
}

function DraftPending({
  variant,
  onSchedulePress,
  onEnterDraft,
  onShareInvite,
  onPaymentPress,
  onSetDraftOrder,
  onEnterOfflineResults,
  onRunOffline,
  onSwitchToInApp,
}: {
  variant: Extract<HomeHeroVariant, { kind: 'draft_pending' }>;
  onSchedulePress?: () => void;
  onEnterDraft?: () => void;
  onShareInvite?: () => void;
  onPaymentPress?: () => void;
  onSetDraftOrder?: () => void;
  onEnterOfflineResults?: () => void;
  onRunOffline?: () => void;
  onSwitchToInApp?: () => void;
}) {
  const { draftDate, draftStatus, pauseReason, draftType, season, isReadyToEnter, isCommissioner, invite, payment, manualOrder, offline, offlineEligible } =
    variant;
  const statusLabel = liveStatusLabel(draftStatus, pauseReason);
  const dateLabel = formatDraftDate(draftDate);
  const isScheduled = !!draftDate;
  const needsOrderSet = manualOrder != null && !manualOrder.slotsAssigned;

  // ── Offline rookie draft ────────────────────────────────────────────────
  // The commissioner records results by hand; there's no schedule/clock. Show
  // a distinct "Offline Draft" state: Enter Results for the commissioner (plus
  // a switch back to in-app), informational for members.
  if (offline) {
    return (
      <>
        <EyebrowRow
          segments={[shortSeason(season), draftTypeLabel(draftType), 'Offline']}
          rightSlot={
            isCommissioner && offline.canToggle ? (
              <OutlinePill
                label="Use App"
                onPress={onSwitchToInApp}
                accessibilityLabel="Switch this draft back to an in-app draft"
              />
            ) : null
          }
        />
        <ThemedText type="display" style={[styles.tricode, styles.titleText]} numberOfLines={2}>
          {'Offline\nDraft.'}
        </ThemedText>
        <View style={styles.statRow}>
          <ThemedText type="varsitySmall" style={styles.statLabel}>
            {isCommissioner ? 'Enter the results' : 'Run by the commissioner'}
          </ThemedText>
          <View style={styles.statDivider} />
          {isCommissioner ? (
            <PulsingPill
              label="Enter Results"
              onPress={onEnterOfflineResults}
              accessibilityLabel="Enter offline draft results"
            />
          ) : (
            <ThemedText type="varsitySmall" style={styles.statLabel}>
              Offline
            </ThemedText>
          )}
        </View>
      </>
    );
  }

  // Eyebrow right-slot priority:
  //   1. invite icons        — commissioner, slots still open
  //   2. dues pill           — non-commissioner with buy-in due
  //   3. Edit Order          — commissioner, manual + slots assigned
  //                            (lets them fix a typo in the order any
  //                             time before the draft starts).
  // (1) and (2) are mutually exclusive in practice — paymentBadge
  // returns null for commissioners. (3) is commissioner-only and only
  // matters once slots are set, which is typically post-fill (no invite).
  let eyebrowSlot: ReactNode = null;
  if (invite) {
    eyebrowSlot = (
      <OutlinePill
        icon="square.and.arrow.up"
        label="Invite"
        onPress={onShareInvite}
        accessibilityLabel="Share invite link"
      />
    );
  } else if (payment) {
    eyebrowSlot = payment.state === 'due'
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
            icon="dollarsign.square.fill"
            onPress={onPaymentPress}
            accessibilityLabel="Payment pending confirmation"
          />
        );
  } else if (isCommissioner && manualOrder?.slotsAssigned) {
    eyebrowSlot = (
      <OutlinePill
        label="Edit Order"
        onPress={onSetDraftOrder}
        accessibilityLabel="Edit the draft order"
      />
    );
  } else if (isCommissioner && offlineEligible) {
    // Rookie draft that hasn't started — offer to run it offline (results
    // entered by hand) instead of the live draft room.
    eyebrowSlot = (
      <OutlinePill
        label="Run Offline"
        onPress={onRunOffline}
        accessibilityLabel="Run this rookie draft offline"
      />
    );
  }

  // Stat row: date on the left, action pill (or status label) on the right.
  // Priority: Enter Now pulsing > Set Draft Order (manual + unset) >
  // Commissioner Schedule/Reschedule > status label.
  let statRight: ReactNode;
  if (isReadyToEnter) {
    statRight = (
      <PulsingPill
        label="Enter"
        onPress={onEnterDraft}
        accessibilityLabel="Enter draft room now"
      />
    );
  } else if (isCommissioner && needsOrderSet) {
    statRight = (
      <PulsingPill
        label="Set Order"
        onPress={onSetDraftOrder}
        accessibilityLabel="Set the draft order before scheduling"
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
        <ThemedText
          type="mono"
          style={styles.statValue}
          accessibilityLabel={
            statusLabel ? `Draft status: ${statusLabel.toLowerCase()}` : undefined
          }
        >
          {statusLabel ?? dateLabel}
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
  const { season, stepIndex, stepCount, stepLabel, nextStepLabel, action, warning, draftOpens } =
    variant;

  // During the dormant wait the rail counts down to the draft opening — the
  // one fact that matters and the only thing that will change. Everywhere else
  // it names the step that follows this one.
  const railLabel = draftOpens
    ? `Draft Opens ${draftOpens.label}${draftOpens.days > 0 ? ` · ${draftOpens.days}d` : ''}`
    : nextStepLabel
      ? `Up Next · ${nextStepLabel}`
      : 'Final Step';
  // Only the countdown needs an override — "5d" has to be spoken as "5 days".
  // Every other rail label reads correctly as written.
  const railAccessibilityLabel = draftOpens
    ? `Draft opens ${draftOpens.label}${
        draftOpens.days > 0
          ? `, in ${draftOpens.days} day${draftOpens.days === 1 ? '' : 's'}`
          : ''
      }`
    : undefined;

  return (
    <>
      <EyebrowRow
        segments={[shortSeason(season), draftOpens ? BETWEEN_SEASONS_LABEL : 'Offseason']}
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
        {/* A dormant league gets no step pips. There is no process to be
            partway through — showing "1 of 3" is precisely the dynasty framing
            that made a sleeping redraft league look like it had work to do. */}
        {draftOpens ? (
          <ThemedText type="varsitySmall" style={styles.statLabel} numberOfLines={1}>
            History Only
          </ThemedText>
        ) : (
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
        )}
        <View style={styles.statDivider} />
        <ThemedText
          type="varsitySmall"
          style={styles.statLabel}
          numberOfLines={1}
          accessibilityLabel={railAccessibilityLabel}
        >
          {railLabel}
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

/**
 * Commissioner-only notice for an imported league whose "finish rosters later"
 * teams still have empty rosters. Shares the amber warning-chip treatment with
 * RosterOverageChip, but always tappable — it routes to League Info where the
 * per-team "Import Roster" buttons live.
 */
function RostersPendingChip({
  count,
  onPress,
}: {
  count: number;
  onPress: () => void;
}) {
  const label = `${count} Roster${count === 1 ? '' : 's'} Not Imported`;
  return (
    <TouchableOpacity
      style={styles.warningChip}
      onPress={onPress}
      activeOpacity={0.82}
      accessibilityRole="button"
      accessibilityLabel={`${label}. Tap to import the missing team rosters.`}
    >
      <IconSymbol
        name="exclamationmark.triangle.fill"
        size={12}
        color={Brand.vintageGold}
      />
      <ThemedText type="varsitySmall" style={styles.warningChipText}>
        {label}
      </ThemedText>
      <IconSymbol name="arrow.right" size={10} color={Brand.ecruMuted} />
    </TouchableOpacity>
  );
}

function InviteNeeded({
  variant,
  onShareInvite,
}: {
  variant: Extract<HomeHeroVariant, { kind: 'invite_needed' }>;
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
          <OutlinePill
            icon="square.and.arrow.up"
            label="Invite"
            onPress={onShareInvite}
            accessibilityLabel="Share invite link"
          />
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

/**
 * Status text for a draft that's already underway, or null when the draft
 * hasn't started (the hero falls back to the scheduled start time then).
 * Quiet hours is an automated overnight freeze of a slow draft's clock, so
 * it reads differently from a commissioner pause — matching the draft room.
 */
function liveStatusLabel(
  status: string | null,
  pauseReason: 'commissioner' | 'quiet_hours' | null,
): string | null {
  if (status === 'in_progress') return 'LIVE NOW';
  if (status === 'paused') {
    return pauseReason === 'quiet_hours' ? 'QUIET HOURS' : 'PAUSED';
  }
  return null;
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
  actionPillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
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
  // Season-complete body: title/record column on the left, champion crown on
  // the right — filling the card's otherwise-empty right half instead of
  // stacking a full-width strip below (which grew the card's height).
  completeBody: {
    flexDirection: 'row',
    // Top-align both columns so the champion crown sits in the true top-right
    // corner, level with the eyebrow — clear of the F crest watermark's dense
    // lower-right strokes, where it was hard to read.
    alignItems: 'flex-start',
    gap: s(12),
  },
  completeMain: {
    flex: 1.5,
    minWidth: 0,
  },
  championBlock: {
    flex: 1,
    minWidth: 0,
    alignItems: 'flex-end',
    gap: s(6),
  },
  championLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
  },
  championLabel: {
    color: Brand.vintageGold,
    fontSize: ms(10),
    letterSpacing: 0.8,
  },
  // Row hugs the right edge; the name flexShrinks + ellipsizes so a long team
  // name can't shove the logo off the card.
  championTeamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: s(8),
    maxWidth: '100%',
  },
  championName: {
    color: Brand.ecru,
    fontSize: ms(15),
    flexShrink: 1,
    textAlign: 'right',
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
