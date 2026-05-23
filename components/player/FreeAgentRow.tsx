import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { useState } from 'react';
import { Text, TouchableOpacity, View } from 'react-native';

import { PlayerHeadshotImage } from '@/components/player/PlayerHeadshotImage';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { type Sport } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { type PlayerSeasonStats } from '@/types/player';
import { abbreviateFirstName, formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import { getTeamLogoUrl } from '@/utils/nba/playerHeadshot';
import { ms } from '@/utils/scale';

import { freeAgentListStyles as styles } from './freeAgentListStyles';

interface FreeAgentRowProps {
  player: PlayerSeasonStats;
  index: number;
  isLast: boolean;
  fpts: number | undefined;
  isCategories: boolean;
  isAdding: boolean;
  needsClaim: boolean;
  waiverLabel: string | null;
  gameToday: string | null;
  isRostered: boolean;
  ownerTeamName: string | null;
  sport: Sport;
  isDisabled: boolean;
  onPress: () => void;
  onAddOrClaimPress: () => void;
  /** Present only when the player is rostered by another team — taps open a
   *  trade proposal pre-seeded with this player on that team's side. */
  onTradePress?: () => void;
}

/**
 * Single free-agent / rostered-player row. Owns its visual chrome —
 * circular headshot + team-pill medallion, name + injury / waiver /
 * game-today badges, slash-line stats, add or claim CTA. Stateless;
 * spinner / disabled state is driven by parent.
 */
export function FreeAgentRow({
  player,
  index,
  isLast,
  fpts,
  isCategories,
  isAdding,
  needsClaim,
  waiverLabel,
  gameToday,
  isRostered,
  ownerTeamName,
  sport,
  isDisabled,
  onPress,
  onAddOrClaimPress,
  onTradePress,
}: FreeAgentRowProps) {
  const c = useColors();

  const logoUrl = getTeamLogoUrl(player.pro_team, sport);
  const injury = getInjuryBadge(player.status);

  // Swap to "F. LastName" only when the full name would have been clipped.
  // A hidden Text laid out in the same flex slot reports its natural line
  // count via onTextLayout — > 1 line means the full name doesn't fit.
  const [nameOverflows, setNameOverflows] = useState(false);
  const displayName = nameOverflows ? abbreviateFirstName(player.name) : player.name;

  const a11yLabel =
    `${player.name}, ${formatPosition(player.position)}, ${player.pro_team}` +
    (ownerTeamName ? `, rostered by ${ownerTeamName}` : '') +
    (fpts !== undefined ? `, ${fpts} fantasy points` : '') +
    (isCategories
      ? `, ${player.avg_pts} points, ${player.avg_reb} rebounds, ${player.avg_ast} assists, ${player.avg_stl} steals, ${player.avg_blk} blocks`
      : '');

  return (
    <TouchableOpacity
      style={[
        styles.row,
        { borderBottomColor: c.border },
        index % 2 === 1 && { backgroundColor: c.cardAlt },
        isLast && { borderBottomWidth: 0 },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.portraitWrap}>
        <View
          style={[
            styles.headshotCircle,
            { borderColor: c.heritageGold, backgroundColor: c.cardAlt },
          ]}
        >
          <PlayerHeadshotImage
            externalIdNba={player.external_id_nba}
            sport={sport}
            style={styles.headshotImg}
          />
        </View>
        <View style={styles.teamPill}>
          {logoUrl && (
            <Image
              source={{ uri: logoUrl }}
              style={styles.teamPillLogo}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={logoUrl}
            />
          )}
          <Text style={[styles.teamPillText, { color: c.statusText }]}>
            {player.pro_team}
          </Text>
        </View>
      </View>

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <View style={styles.nameWrap}>
            {!nameOverflows && (
              <ThemedText
                type="defaultSemiBold"
                style={[styles.nameMeasure, { fontSize: ms(14) }]}
                onTextLayout={(e) => {
                  if (e.nativeEvent.lines.length > 1) setNameOverflows(true);
                }}
                pointerEvents="none"
                accessibilityElementsHidden
                importantForAccessibility="no"
              >
                {player.name}
              </ThemedText>
            )}
            <ThemedText
              type="defaultSemiBold"
              numberOfLines={1}
              style={{ fontSize: ms(14) }}
            >
              {displayName}
            </ThemedText>
          </View>
          {injury && (
            <Badge
              label={injury.label}
              size="small"
              backgroundColor={injury.color}
              textColor={c.statusText}
            />
          )}
        </View>
        <View style={styles.posRow}>
          <ThemedText style={[styles.posText, { color: c.secondaryText }]}>
            {formatPosition(player.position)}
          </ThemedText>
          {ownerTeamName && (
            <ThemedText
              style={[styles.posText, { color: c.secondaryText, marginLeft: 4 }]}
            >
              · {ownerTeamName}
            </ThemedText>
          )}
          {!isRostered && waiverLabel && (
            <Badge
              label={waiverLabel}
              variant="gold"
              size="small"
              backgroundColor={c.gold + '20'}
              textColor={c.gold}
              style={{ marginLeft: 4 }}
            />
          )}
          {gameToday && (
            <Badge
              label={gameToday}
              size="small"
              backgroundColor={c.link + '22'}
              textColor={c.link}
            />
          )}
        </View>
      </View>

      <View style={styles.rightSide}>
        <View
          style={[
            styles.stats,
            isCategories ? styles.statsCategories : styles.statsPoints,
          ]}
        >
          {isCategories ? (
            <>
              <ThemedText
                type="mono"
                style={[styles.statLine, { color: c.secondaryText }]}
              >
                {player.avg_pts.toFixed(1)}/{player.avg_reb.toFixed(1)}/{player.avg_ast.toFixed(1)}/{player.avg_stl.toFixed(1)}/{player.avg_blk.toFixed(1)}
              </ThemedText>
              <ThemedText style={[styles.catLine, { color: c.secondaryText }]}>
                {player.avg_fga > 0
                  ? ((player.avg_fgm / player.avg_fga) * 100).toFixed(1)
                  : '0.0'}
                % FG ·{' '}
                {player.avg_fta > 0
                  ? ((player.avg_ftm / player.avg_fta) * 100).toFixed(1)
                  : '0.0'}
                % FT · {player.avg_tov.toFixed(1)} TO
              </ThemedText>
            </>
          ) : (
            <>
              <ThemedText
                type="mono"
                style={[styles.statLine, { color: c.secondaryText }]}
              >
                {player.avg_pts.toFixed(1)}/{player.avg_reb.toFixed(1)}/{player.avg_ast.toFixed(1)}
              </ThemedText>
              {fpts !== undefined && (
                <ThemedText
                  type="mono"
                  style={[styles.fptsValue, { color: c.gold }]}
                >
                  {fpts.toFixed(1)}
                </ThemedText>
              )}
            </>
          )}
        </View>
        {!isRostered ? (
          <TouchableOpacity
            style={[
              needsClaim
                ? [styles.claimButton, { backgroundColor: c.gold }]
                : [styles.addButton, { backgroundColor: c.success }],
              (isAdding || isDisabled) && styles.addButtonDisabled,
            ]}
            onPress={onAddOrClaimPress}
            disabled={isAdding || isDisabled}
            accessibilityRole="button"
            accessibilityLabel={needsClaim ? `Claim ${player.name}` : `Add ${player.name}`}
          >
            <ThemedText style={[styles.addButtonText, { color: c.statusText }]}>
              {'+'}
            </ThemedText>
          </TouchableOpacity>
        ) : onTradePress ? (
          <TouchableOpacity
            style={[styles.tradeButton, { borderColor: c.link }]}
            onPress={onTradePress}
            accessibilityRole="button"
            accessibilityLabel={
              `Propose a trade for ${player.name}` +
              (ownerTeamName ? ` with ${ownerTeamName}` : '')
            }
          >
            <Ionicons name="swap-horizontal" size={ms(16)} color={c.link} />
          </TouchableOpacity>
        ) : null}
      </View>
    </TouchableOpacity>
  );
}

