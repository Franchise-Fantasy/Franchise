import { StyleSheet, View } from 'react-native';

import { TeamLogo } from '@/components/team/TeamLogo';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts, cardShadow } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { type Transaction, type TransactionItem } from '@/hooks/useTransactions';
import { formatPickLabelShort } from '@/types/trade';
import { ms, s } from '@/utils/scale';

type TeamRef = { name: string; logo_key: string | null };

interface Props {
  txn: Transaction;
}

function getTypeLabel(type: string): string {
  switch (type) {
    case 'trade':
      return 'TRADE';
    case 'waiver':
      return 'ADD / DROP';
    case 'commissioner':
      return 'COMMISSIONER';
    default:
      return type.toUpperCase();
  }
}

/**
 * Type → palette token mapping. We pull from `useColors()` at the call site
 * so each transaction picks up sport-aware accent shifts (e.g. WNBA orange
 * standing in for vintage gold).
 */
function getTypeAccentKey(
  type: string,
): 'gold' | 'heritageGold' | 'danger' | 'secondaryText' {
  switch (type) {
    case 'trade':
      return 'gold';
    case 'waiver':
      return 'heritageGold';
    case 'commissioner':
      return 'danger';
    default:
      return 'secondaryText';
  }
}

function formatRelativeTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function getTradeTeams(items: TransactionItem[]): TeamRef[] {
  const map = new Map<string, TeamRef>();
  for (const item of items) {
    for (const team of [item.team_from, item.team_to]) {
      if (team?.name && !map.has(team.name)) map.set(team.name, team);
    }
  }
  return Array.from(map.values());
}

function formatItemDescription(item: TransactionItem): string | null {
  const playerName = item.player?.name;
  if (!playerName && !item.draft_pick) return null;

  const assetName =
    playerName ??
    (item.draft_pick
      ? formatPickLabelShort(item.draft_pick.season, item.draft_pick.round)
      : null);
  if (!assetName) return null;

  const toTeam = item.team_to?.name;
  const fromTeam = item.team_from?.name;

  if (fromTeam && toTeam) return `${assetName} → ${toTeam} (from ${fromTeam})`;
  if (toTeam) return `${assetName} added by ${toTeam}`;
  if (fromTeam) return `${assetName} dropped by ${fromTeam}`;
  return `${assetName} dropped`;
}

function buildTradeSummary(
  items: TransactionItem[],
): { team: string; assets: string[] }[] {
  // For 3+ team trades, append `→ Recipient` to each asset so it's clear
  // which receiver each asset is going to.
  const uniqueFromTeams = new Set(
    items.map((i) => i.team_from_id).filter(Boolean),
  );
  const isMultiTeam = uniqueFromTeams.size > 2;

  const sendsByTeam: Record<string, string[]> = {};
  for (const item of items) {
    const from = item.team_from?.name ?? 'Unknown';
    if (!sendsByTeam[from]) sendsByTeam[from] = [];
    const toSuffix =
      isMultiTeam && item.team_to?.name ? ` → ${item.team_to.name}` : '';
    if (item.player?.name) {
      sendsByTeam[from].push(item.player.name + toSuffix);
    } else if (item.draft_pick) {
      sendsByTeam[from].push(
        formatPickLabelShort(item.draft_pick.season, item.draft_pick.round) +
          toSuffix,
      );
    }
  }
  return Object.entries(sendsByTeam).map(([team, assets]) => ({ team, assets }));
}

export function TransactionCard({ txn }: Props) {
  const c = useColors();

  const items = txn.league_transaction_items ?? [];
  const isTrade = txn.type === 'trade' && items.length > 0;
  const tradeSummary = isTrade ? buildTradeSummary(items) : [];
  const tradeTeams = isTrade ? getTradeTeams(items) : [];
  const descriptions = isTrade
    ? []
    : (items.map(formatItemDescription).filter(Boolean) as string[]);

  // Logo cluster: trades show every involved team; everything else uses the
  // initiator. Keeps trade activity visually distinct at a glance.
  const headerLogos: TeamRef[] = isTrade
    ? tradeTeams
    : txn.initiator
      ? [txn.initiator]
      : [];

  const typeAccent = c[getTypeAccentKey(txn.type)];
  const typeLabel = getTypeLabel(txn.type);

  const a11y = `${typeLabel}${
    txn.initiator ? ` by ${txn.initiator.name}` : ''
  }, ${formatRelativeTime(txn.created_at)}${
    isTrade
      ? `, ${tradeSummary
          .map((g) => `${g.team} sends ${g.assets.join(', ')}`)
          .join('; ')}`
      : descriptions.length > 0
        ? `, ${descriptions.join(', ')}`
        : ''
  }`;

  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityLabel={a11y}
    >
      {/* Eyebrow: type label (left, accent varsity caps) + relative time (right) */}
      <View style={styles.eyebrowRow}>
        <ThemedText
          type="varsitySmall"
          style={[styles.typeLabel, { color: typeAccent }]}
          numberOfLines={1}
        >
          {typeLabel}
        </ThemedText>
        <ThemedText
          type="varsitySmall"
          style={[styles.timeText, { color: c.secondaryText }]}
        >
          {formatRelativeTime(txn.created_at)}
        </ThemedText>
      </View>

      {/* Initiator row: team logo cluster + initiator name */}
      {headerLogos.length > 0 && (
        <View style={styles.initiatorRow}>
          <View style={styles.logoCluster}>
            {headerLogos.map((team, idx) => (
              <View
                key={`${team.name}-${idx}`}
                style={idx > 0 ? styles.logoStacked : undefined}
              >
                <TeamLogo
                  logoKey={team.logo_key}
                  teamName={team.name}
                  size="small"
                />
              </View>
            ))}
          </View>
          {!isTrade && txn.initiator && (
            <ThemedText
              style={[styles.initiatorName, { color: c.text }]}
              numberOfLines={1}
            >
              {txn.initiator.name}
            </ThemedText>
          )}
        </View>
      )}

      {/* Body: trade groups, asset lines, or notes */}
      {isTrade ? (
        <View style={styles.body}>
          {tradeSummary.map((group, gi) => (
            <View
              key={gi}
              style={[
                styles.tradeGroup,
                gi > 0 && { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <View style={styles.tradeGroupHeader}>
                <ThemedText
                  style={[styles.tradeGroupTeam, { color: c.text }]}
                  numberOfLines={1}
                >
                  {group.team}
                </ThemedText>
                <Badge label="SENDS" variant="turf" size="small" />
              </View>
              {group.assets.map((asset, ai) => (
                <ThemedText
                  key={ai}
                  style={[styles.assetLine, { color: c.text }]}
                  numberOfLines={2}
                >
                  •  {asset}
                </ThemedText>
              ))}
            </View>
          ))}
        </View>
      ) : descriptions.length > 0 ? (
        <View style={styles.body}>
          {descriptions.map((desc, i) => (
            <ThemedText
              key={i}
              style={[styles.assetLine, { color: c.text }]}
            >
              {desc}
            </ThemedText>
          ))}
        </View>
      ) : txn.notes ? (
        <ThemedText style={[styles.notes, { color: c.secondaryText }]}>
          {txn.notes}
        </ThemedText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: s(14),
    paddingVertical: s(12),
    marginBottom: s(10),
    ...cardShadow,
  },
  eyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: s(8),
    gap: s(8),
  },
  typeLabel: {
    fontSize: ms(11),
    letterSpacing: 1.4,
    flex: 1,
  },
  timeText: {
    fontSize: ms(10),
    letterSpacing: 0.8,
  },
  initiatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(6),
  },
  logoCluster: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  logoStacked: {
    marginLeft: -s(8),
  },
  initiatorName: {
    fontFamily: Fonts.display,
    fontSize: ms(15),
    lineHeight: ms(20),
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  body: {
    marginTop: s(2),
  },
  tradeGroup: {
    paddingVertical: s(6),
  },
  tradeGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(4),
  },
  tradeGroupTeam: {
    fontFamily: Fonts.display,
    fontSize: ms(13),
    lineHeight: ms(18),
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  assetLine: {
    fontSize: ms(13),
    lineHeight: ms(19),
  },
  notes: {
    fontSize: ms(13),
    lineHeight: ms(19),
    marginTop: s(2),
  },
});
