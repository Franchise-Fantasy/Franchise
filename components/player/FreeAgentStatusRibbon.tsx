import { Ionicons } from '@expo/vector-icons';
import { ScrollView, TouchableOpacity, View, StyleSheet } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { type PlayerSeasonStats } from '@/types/player';
import {
  getProcessDate,
  type WaiverType,
} from '@/utils/freeAgent/waiverLabels';
import { ms, s } from '@/utils/scale';

import { freeAgentListStyles as listStyles } from './freeAgentListStyles';

export interface PendingClaim {
  id: string;
  player_id: string;
  drop_player_id: string | null;
  bid_amount: number | null;
  created_at: string | null;
  player?: { name: string; position: string | null; pro_team: string | null } | null;
}

export interface WaiverOrderRow {
  team_id: string;
  priority: number;
  faab_remaining: number | null;
  team?: { name: string } | null;
}

/** Whether the inline `Pending Claims` section is open. Waiver order is
 *  no longer an inline expand — it opens its own modal via a callback. */
export type ExpandedSection = 'claims' | null;

interface FreeAgentStatusRibbonProps {
  weeklyLimit: number | null;
  weeklyAddsUsed: number;
  weeklyLimitReached: boolean;
  waiverType: WaiverType;
  faabRemaining: number | null;
  pendingClaims: PendingClaim[];
  rosterIsFull: boolean;
  waiverPlayerMap: Map<string, string> | undefined;
  seasonStatsMap: Map<string, PlayerSeasonStats>;
  /** Which expandable section is currently open. Lifted so the parent
   *  can poke claims open after a roster-full warning. */
  expandedSection: ExpandedSection;
  onToggleClaims: () => void;
  onAcquisitionsInfoPress: () => void;
  onWaiverOrderPress: () => void;
  onRequestCancelClaim: (claim: PendingClaim) => void;
  /** Edit the bid amount on a pending FAAB bid (reopens the bid modal). */
  onEditClaimBid: (claim: PendingClaim) => void;
  /** Edit/set the drop player on a pending claim. Only surfaced when the
   *  roster is full, since a drop is otherwise unnecessary. */
  onEditClaimDrop: (claim: PendingClaim) => void;
}

/**
 * Ribbon of pill-style status indicators (acquisitions / claims / FAAB or
 * waiver order) above the free-agent list, plus inline-expandable detail
 * sections for pending claims and waiver order. Expanded-section state is
 * lifted to the parent so a roster-full warning flow can poke the claims
 * pane open programmatically.
 */
export function FreeAgentStatusRibbon({
  weeklyLimit,
  weeklyAddsUsed,
  weeklyLimitReached,
  waiverType,
  faabRemaining,
  pendingClaims,
  rosterIsFull,
  waiverPlayerMap,
  seasonStatsMap,
  expandedSection,
  onToggleClaims,
  onAcquisitionsInfoPress,
  onWaiverOrderPress,
  onRequestCancelClaim,
  onEditClaimBid,
  onEditClaimDrop,
}: FreeAgentStatusRibbonProps) {
  const c = useColors();

  const claimCount = pendingClaims.length;

  return (
    <View>
      <View style={listStyles.ribbonRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          contentContainerStyle={listStyles.ribbonContent}
        >
          {weeklyLimit != null && (
            <RibbonPill
              icon={weeklyLimitReached ? 'lock-closed' : 'swap-horizontal'}
              label={`Acq ${weeklyAddsUsed}/${weeklyLimit}`}
              active={false}
              tone={weeklyLimitReached ? 'danger' : 'default'}
              onPress={onAcquisitionsInfoPress}
              accessibilityLabel={`Weekly acquisitions: ${weeklyAddsUsed} of ${weeklyLimit} used${weeklyLimitReached ? ', limit reached' : ''}`}
              c={c}
            />
          )}

          {waiverType !== 'none' && claimCount > 0 && (
            <RibbonPill
              icon="time-outline"
              label={`Claims · ${claimCount}`}
              active={expandedSection === 'claims'}
              tone="default"
              onPress={onToggleClaims}
              accessibilityLabel={`Pending claims, ${claimCount}`}
              accessibilityState={{ expanded: expandedSection === 'claims' }}
              c={c}
            />
          )}

          {waiverType !== 'none' && (
            <RibbonPill
              icon={waiverType === 'faab' ? 'cash-outline' : 'list-outline'}
              label={waiverType === 'faab' ? `FAAB · $${faabRemaining ?? 0}` : 'Waiver Order'}
              active={false}
              tone="default"
              onPress={onWaiverOrderPress}
              accessibilityLabel={
                waiverType === 'faab'
                  ? `FAAB budget, ${faabRemaining ?? 0} dollars`
                  : 'Waiver priority order'
              }
              c={c}
            />
          )}
        </ScrollView>
      </View>

      {expandedSection === 'claims' && claimCount > 0 && (
        <View
          style={[
            listStyles.claimsList,
            { backgroundColor: c.card, borderColor: c.border },
          ]}
        >
          <SectionEyebrow label="PENDING CLAIMS" color={c.gold} />
          {pendingClaims.map((claim, idx) => {
            const dropName = claim.drop_player_id
              ? (seasonStatsMap.get(claim.drop_player_id)?.name ?? null)
              : null;
            const hasNoDrop = !claim.drop_player_id;
            const isLast = idx === pendingClaims.length - 1;
            return (
              <View
                key={claim.id}
                style={[
                  listStyles.claimRow,
                  { borderBottomColor: c.border },
                  isLast && { borderBottomWidth: 0 },
                ]}
              >
                <View style={{ flex: 1 }}>
                  <ThemedText style={{ fontSize: ms(13), fontWeight: '600' }}>
                    {claim.player?.name ?? 'Unknown'}
                  </ThemedText>
                  <ThemedText style={{ fontSize: ms(11), color: c.secondaryText }}>
                    {claim.player?.position} - {claim.player?.pro_team}
                    {waiverType === 'faab' ? ` | $${claim.bid_amount} bid` : ''}
                    {' · Processes ' +
                      getProcessDate(
                        claim.player_id,
                        waiverType,
                        waiverPlayerMap,
                      )}
                  </ThemedText>
                  <ThemedText
                    style={{
                      fontSize: ms(11),
                      color: hasNoDrop && rosterIsFull ? c.danger : c.secondaryText,
                    }}
                  >
                    {dropName ? `Drop: ${dropName}` : 'No drop player'}
                    {hasNoDrop && rosterIsFull ? ' ⚠ Roster full — claim will fail' : ''}
                  </ThemedText>
                </View>
                {waiverType === 'faab' && (
                  <TouchableOpacity
                    onPress={() => onEditClaimBid(claim)}
                    hitSlop={8}
                    style={{ marginRight: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Edit bid for ${claim.player?.name ?? 'player'} claim`}
                  >
                    <Ionicons name="pencil" size={18} color={c.accent} />
                  </TouchableOpacity>
                )}
                {rosterIsFull && (
                  <TouchableOpacity
                    onPress={() => onEditClaimDrop(claim)}
                    hitSlop={8}
                    style={{ marginRight: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`${hasNoDrop ? 'Set' : 'Change'} drop player for ${claim.player?.name ?? 'player'} claim`}
                  >
                    <Ionicons
                      name="person-remove-outline"
                      size={18}
                      color={hasNoDrop ? c.danger : c.accent}
                    />
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  onPress={() => onRequestCancelClaim(claim)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel claim for ${claim.player?.name ?? 'player'}`}
                >
                  <Ionicons name="close-circle" size={20} color={c.secondaryText} />
                </TouchableOpacity>
              </View>
            );
          })}
        </View>
      )}

    </View>
  );
}

/** Gold-rule + varsity-caps eyebrow above expanded ribbon sections. */
function SectionEyebrow({ label, color }: { label: string; color: string }) {
  return (
    <View style={eyebrowStyles.row}>
      <View style={[eyebrowStyles.rule, { backgroundColor: color }]} />
      <ThemedText type="varsitySmall" style={[eyebrowStyles.label, { color }]}>
        {label}
      </ThemedText>
    </View>
  );
}

/**
 * Restrained pill chrome to match the home page's `leagueInfoPill` —
 * cardAlt background, hairline border, gold icon, varsity-caps label.
 * `active` swaps the border to gold; `tone="danger"` adds a small
 * red dot to flag a limit-reached state without bathing the pill in red.
 */
function RibbonPill({
  icon,
  label,
  active,
  tone,
  onPress,
  accessibilityLabel,
  accessibilityState,
  c,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  active: boolean;
  tone: 'default' | 'danger';
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityState?: { expanded?: boolean; checked?: boolean };
  c: ReturnType<typeof useColors>;
}) {
  return (
    <TouchableOpacity
      style={[
        ribbonStyles.pill,
        {
          backgroundColor: c.cardAlt,
          borderColor: active ? c.gold : c.border,
        },
      ]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}
    >
      <Ionicons name={icon} size={13} color={active || tone === 'danger' ? c.gold : c.gold} accessible={false} />
      <ThemedText
        type="varsitySmall"
        style={[ribbonStyles.label, { color: c.text }]}
      >
        {label}
      </ThemedText>
      {tone === 'danger' && (
        <View style={[ribbonStyles.dangerDot, { backgroundColor: c.danger }]} />
      )}
    </TouchableOpacity>
  );
}

const ribbonStyles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
    paddingHorizontal: s(10),
    paddingVertical: s(6),
    borderRadius: 8,
    borderWidth: 1,
  },
  label: {
    fontSize: ms(10),
    letterSpacing: 1.0,
  },
  dangerDot: {
    width: s(6),
    height: s(6),
    borderRadius: 3,
    marginLeft: s(2),
  },
});

const eyebrowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingTop: s(8),
    paddingBottom: s(6),
  },
  rule: {
    height: 2,
    width: s(14),
  },
  label: {
    fontSize: ms(9),
    letterSpacing: 1.4,
  },
});
