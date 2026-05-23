import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Image } from 'expo-image';
import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { PlayerHeadshotImage } from '@/components/player/PlayerHeadshotImage';
import { Badge } from '@/components/ui/Badge';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { TradeBlockPlayer, TradeBlockTeamGroup, useToggleTradeBlockInterest } from '@/hooks/useTrades';
import { formatPosition } from '@/utils/formatting';
import { logger } from '@/utils/logger';
import { getTeamLogoUrl } from '@/utils/nba/playerHeadshot';
import { ms, s } from '@/utils/scale';

interface TradeBlockSheetProps {
  visible: boolean;
  tradeBlock: TradeBlockTeamGroup[];
  leagueId: string;
  teamId: string;
  onClose: () => void;
  /** Tapping a player's row — opens their detail modal. */
  onPlayerPress: (player: TradeBlockPlayer) => void;
  /** The Propose button on another team's listing. */
  onProposeTrade: (player: TradeBlockPlayer) => void;
}

export function TradeBlockSheet({
  visible,
  tradeBlock,
  leagueId,
  teamId,
  onClose,
  onPlayerPress,
  onProposeTrade,
}: TradeBlockSheetProps) {
  const c = useColors();
  const [hiddenPlayers, setHiddenPlayers] = useState<Set<string>>(new Set());
  const { mutate: toggleInterest } = useToggleTradeBlockInterest(leagueId);

  const storageKey = `hiddenTradeBlock:${leagueId}`;

  // Load hidden players from storage on mount
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(storageKey)
      .then((raw) => {
        if (cancelled || !raw) return;
        try {
          setHiddenPlayers(new Set(JSON.parse(raw)));
        } catch (e) {
          logger.warn('Parse hidden trade-block list failed', e);
        }
      })
      .catch((e) => logger.warn('Load hidden trade-block list failed', e));
    return () => {
      cancelled = true;
    };
  }, [storageKey]);

  const persistHidden = useCallback(
    (next: Set<string>) => {
      setHiddenPlayers(next);
      AsyncStorage.setItem(storageKey, JSON.stringify([...next]));
    },
    [storageKey],
  );

  const toggleHidden = (playerId: string) => {
    const next = new Set(hiddenPlayers);
    if (next.has(playerId)) next.delete(playerId);
    else next.add(playerId);
    persistHidden(next);
  };

  // Filter hidden players from other teams only (always show your own). Sort
  // so your own listings sit up top — that's where you manage interest.
  const filteredBlock = tradeBlock
    .map((group) => ({
      ...group,
      players: group.players.filter(
        (p) => group.team_id === teamId || !hiddenPlayers.has(p.player_id),
      ),
    }))
    .filter((g) => g.players.length > 0)
    .sort((a, b) => (a.team_id === teamId ? -1 : b.team_id === teamId ? 1 : 0));

  const totalPlayers = filteredBlock.reduce((sum, g) => sum + g.players.length, 0);
  const hiddenCount = hiddenPlayers.size;

  const subtitle = hiddenCount > 0 ? `Trade Block · ${hiddenCount} Hidden` : 'Trade Block';
  const title = `${totalPlayers} ${totalPlayers === 1 ? 'Player' : 'Players'} Available`;

  const headerAction = hiddenCount > 0 ? (
    <TouchableOpacity
      onPress={() => persistHidden(new Set())}
      style={[styles.showAllBtn, { borderColor: c.gold }]}
      accessibilityRole="button"
      accessibilityLabel="Show all hidden players"
    >
      <Ionicons name="eye-outline" size={13} color={c.gold} accessible={false} />
      <ThemedText style={[styles.showAllText, { color: c.gold }]}>Show all</ThemedText>
    </TouchableOpacity>
  ) : null;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      headerAction={headerAction}
      bodyStyle={styles.body}
    >
      {filteredBlock.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyIcon, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
            <Ionicons name="eye-off-outline" size={ms(22)} color={c.secondaryText} accessible={false} />
          </View>
          <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
            You&apos;ve hidden every listing. Tap “Show all” to bring them back.
          </ThemedText>
        </View>
      ) : (
        filteredBlock.map((group) => {
          const isOwn = group.team_id === teamId;
          return (
            <View
              key={group.team_id}
              style={[styles.section, { borderColor: c.border, backgroundColor: c.card }]}
            >
              {/* Team eyebrow — gold-rule + varsity caps rhythm matching the
                  receives blocks elsewhere in the trade UI. */}
              <View style={styles.sectionHeader}>
                <View style={[styles.sectionRule, { backgroundColor: c.gold }]} />
                <ThemedText
                  type="varsitySmall"
                  style={[styles.teamName, { color: c.gold }]}
                  numberOfLines={1}
                >
                  {isOwn ? 'Your Team' : group.team_name}
                </ThemedText>
                <Badge label={String(group.players.length)} variant="neutral" size="small" />
              </View>

              {group.players.map((p, i) => (
                <BlockRow
                  key={p.player_id}
                  player={p}
                  isOwn={isOwn}
                  isFirst={i === 0}
                  c={c}
                  isInterested={p.trade_block_interest.includes(teamId)}
                  onViewPlayer={() => onPlayerPress(p)}
                  onProposeTrade={() => onProposeTrade(p)}
                  onToggleInterest={() =>
                    toggleInterest({
                      playerId: p.player_id,
                      teamId,
                      currentInterest: p.trade_block_interest,
                      ownerTeamId: p.team_id,
                      playerName: p.name,
                    })
                  }
                  onHide={() => toggleHidden(p.player_id)}
                />
              ))}
            </View>
          );
        })
      )}
    </BottomSheet>
  );
}

interface BlockRowProps {
  player: TradeBlockPlayer;
  isOwn: boolean;
  isFirst: boolean;
  c: ReturnType<typeof useColors>;
  isInterested: boolean;
  onViewPlayer: () => void;
  onProposeTrade: () => void;
  onToggleInterest: () => void;
  onHide: () => void;
}

function BlockRow({
  player: p,
  isOwn,
  isFirst,
  c,
  isInterested,
  onViewPlayer,
  onProposeTrade,
  onToggleInterest,
  onHide,
}: BlockRowProps) {
  const sport = useActiveLeagueSport();
  const logoUrl = getTeamLogoUrl(p.pro_team, sport);
  const interestCount = p.trade_block_interest.length;

  const portrait = (
    <View style={styles.portraitWrap}>
      <View style={[styles.headshotCircle, { borderColor: c.heritageGold, backgroundColor: c.cardAlt }]}>
        <PlayerHeadshotImage externalIdNba={p.external_id_nba} sport={sport} style={styles.headshotImg} />
      </View>
      {logoUrl && (
        <View style={styles.teamPill}>
          <Image
            source={{ uri: logoUrl }}
            style={styles.teamPillLogo}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={logoUrl}
          />
          <Text style={[styles.teamPillText, { color: c.statusText }]}>{p.pro_team}</Text>
        </View>
      )}
    </View>
  );

  const info = (
    <View style={styles.info}>
      <ThemedText type="defaultSemiBold" style={styles.playerName} numberOfLines={1}>
        {p.name}
      </ThemedText>
      <ThemedText style={[styles.playerMeta, { color: c.secondaryText }]} numberOfLines={1}>
        {formatPosition(p.position)}
      </ThemedText>
    </View>
  );

  return (
    <View style={[styles.rowWrap, !isFirst && { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth }]}>
      <View style={styles.rowTop}>
        <TouchableOpacity
          style={styles.rowMain}
          onPress={onViewPlayer}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel={`${p.name}, ${formatPosition(p.position)}, ${p.pro_team}`}
          accessibilityHint="View player details"
        >
          {portrait}
          {info}
        </TouchableOpacity>

        {/* Right rail, inline + vertically centered so the row reads as one
            unit. Own listings show their interest count; other teams get the
            bookmark / hide / Propose cluster. */}
        {isOwn ? (
          <ThemedText type="varsitySmall" style={[styles.listedTag, { color: c.secondaryText }]}>
            Listed
          </ThemedText>
        ) : (
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.iconBtn}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              onPress={onToggleInterest}
              accessibilityRole="button"
              accessibilityState={{ selected: isInterested }}
              accessibilityLabel={isInterested ? `Bookmarked ${p.name} — tap to remove` : `Bookmark ${p.name} to register interest`}
            >
              <Ionicons
                name={isInterested ? 'bookmark' : 'bookmark-outline'}
                size={18}
                color={isInterested ? c.gold : c.secondaryText}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.iconBtn}
              hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
              onPress={onHide}
              accessibilityRole="button"
              accessibilityLabel={`Hide ${p.name}`}
            >
              <Ionicons name="eye-off-outline" size={18} color={c.secondaryText} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.proposeBtn, { backgroundColor: c.gold }]}
              onPress={onProposeTrade}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel={`Propose a trade for ${p.name}`}
            >
              <Ionicons name="swap-horizontal" size={ms(14)} color={c.statusText} accessible={false} />
              <Text style={[styles.proposeText, { color: c.statusText }]}>Propose</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* "Looking for" sits below the row as a light footnote so it never
          distorts the row's height or the inline action rhythm. */}
      {p.trade_block_note ? (
        <View style={styles.noteLine}>
          <Ionicons name="pricetag-outline" size={ms(11)} color={c.gold} accessible={false} />
          <ThemedText style={[styles.noteText, { color: c.gold }]} numberOfLines={2}>
            <Text style={styles.noteLabel}>Looking for: </Text>
            {p.trade_block_note}
          </ThemedText>
        </View>
      ) : null}

      {/* Interested teams as a footnote (own listings only), mirroring the
          "Looking for" line so the row stays light instead of boxed. */}
      {isOwn ? (
        <View style={styles.noteLine}>
          <Ionicons
            name="people-outline"
            size={ms(12)}
            color={interestCount > 0 ? c.gold : c.secondaryText}
            accessible={false}
          />
          <ThemedText style={[styles.noteText, { color: c.secondaryText }]} numberOfLines={2}>
            {interestCount > 0 ? (
              <>
                <Text style={[styles.noteLabel, { color: c.gold }]}>Interested: </Text>
                {p.trade_block_interest
                  .map((tid) => p.interest_team_names[tid] ?? 'Unknown')
                  .join(', ')}
              </>
            ) : (
              'No interest yet'
            )}
          </ThemedText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: s(16),
  },
  showAllBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 999,
    paddingHorizontal: s(10),
    paddingVertical: s(5),
  },
  showAllText: {
    fontSize: ms(12),
    fontWeight: '600',
  },
  empty: {
    alignItems: 'center',
    paddingVertical: s(40),
    paddingHorizontal: s(24),
    gap: s(14),
  },
  emptyIcon: {
    width: s(52),
    height: s(52),
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: ms(13),
    textAlign: 'center',
    lineHeight: ms(19),
  },
  section: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 14,
    paddingHorizontal: s(12),
    paddingTop: s(12),
    paddingBottom: s(4),
    marginBottom: s(12),
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(6),
  },
  sectionRule: { height: 2, width: s(14) },
  teamName: {
    fontSize: ms(11),
    letterSpacing: 1.4,
    flexShrink: 1,
  },
  rowWrap: {
    paddingVertical: s(10),
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    minWidth: 0,
  },
  // Portrait chrome mirrors the roster page (rosterStyles.ts) exactly so
  // players read identically across the app — 48px circle, bottom-anchored
  // headshot, team pill clamped to the bottom edge.
  portraitWrap: {
    width: s(48),
    height: s(48),
    alignItems: 'center',
  },
  headshotCircle: {
    width: s(48),
    height: s(48),
    borderRadius: s(24),
    borderWidth: 1.5,
    overflow: 'hidden',
  },
  headshotImg: {
    position: 'absolute',
    bottom: -2,
    left: 0,
    right: 0,
    height: s(42),
  },
  teamPill: {
    position: 'absolute',
    bottom: -1,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: s(3),
    paddingVertical: 1,
    gap: s(2),
  },
  teamPillLogo: { width: s(9), height: s(9) },
  teamPillText: {
    fontSize: ms(7),
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: s(1),
  },
  playerName: {
    fontSize: ms(14),
  },
  playerMeta: {
    fontSize: ms(11),
  },
  noteLine: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: s(5),
    marginLeft: s(58), // align under the info column (portrait 48 + gap 10)
    marginTop: s(6),
  },
  noteText: {
    fontSize: ms(11),
    flex: 1,
    lineHeight: ms(15),
  },
  noteLabel: {
    fontWeight: '700',
  },
  listedTag: {
    fontSize: ms(9),
    letterSpacing: 1.2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  iconBtn: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  proposeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: s(5),
    height: s(34),
    borderRadius: 17,
    paddingHorizontal: s(12),
    marginLeft: s(6),
  },
  proposeText: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(11),
    letterSpacing: 0.8,
  },
});
