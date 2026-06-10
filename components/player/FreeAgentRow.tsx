import { Ionicons } from '@expo/vector-icons';
import { TouchableOpacity, View } from 'react-native';

import { PlayerName } from '@/components/player/PlayerName';
import { PlayerPortrait } from '@/components/player/PlayerPortrait';
import { Badge } from '@/components/ui/Badge';
import { ThemedText } from '@/components/ui/ThemedText';
import { type Sport } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { type PlayerSeasonStats } from '@/types/player';
import { formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import { ms, s } from '@/utils/scale';

import { freeAgentListStyles as styles } from './freeAgentListStyles';

interface FreeAgentRowProps {
  player: PlayerSeasonStats;
  index: number;
  isLast: boolean;
  fpts: number | undefined;
  /** Projected next-game FPTS. Present only when projections are enabled and
   *  the player has a game on the selected day; shown beside the matchup chip. */
  projFpts?: number | null;
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
  /** When true, the row is in compare-pick mode: tapping selects rather than
   *  opening detail, and the add/trade CTA is replaced by a selection toggle. */
  compareMode?: boolean;
  compareSelected?: boolean;
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
  projFpts,
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
  compareMode,
  compareSelected,
}: FreeAgentRowProps) {
  const c = useColors();
  const scheme = useColorScheme() ?? 'light';

  const injury = getInjuryBadge(player.status);

  const a11yLabel =
    `${player.name}, ${formatPosition(player.position)}, ${player.pro_team}` +
    (ownerTeamName ? `, rostered by ${ownerTeamName}` : '') +
    (gameToday ? `, plays ${gameToday}` : '') +
    (fpts !== undefined ? `, ${fpts} fantasy points` : '') +
    (projFpts != null && projFpts > 0
      ? `, ${projFpts.toFixed(1)} projected next game`
      : '') +
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
        compareSelected && { backgroundColor: c.activeCard },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={compareMode ? { selected: !!compareSelected } : undefined}
    >
      <PlayerPortrait
        externalIdNba={player.external_id_nba}
        proTeam={player.pro_team}
        sport={sport}
        size={s(54)}
        imageHeight={s(48)}
        teamLogoSize={s(10)}
        teamTextFontSize={ms(8)}
        containerStyle={styles.portraitWrap}
      />

      <View style={styles.info}>
        <View style={styles.nameRow}>
          <PlayerName
            name={player.name}
            type="defaultSemiBold"
            style={{ fontSize: ms(14) }}
            containerStyle={styles.nameWrap}
          />
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
              // `c.link` is sport-tinted and goes dark-merlot in WNBA dark mode
              // (~1.8:1 on the dark bg). Light text reads cleanly on the tint
              // there; light mode keeps the accent-colored label (~15:1).
              textColor={scheme === 'dark' ? c.text : c.link}
            />
          )}
          {projFpts != null && projFpts > 0 && (
            <ThemedText
              type="mono"
              style={[styles.projInline, { color: c.secondaryText }]}
            >
              {projFpts.toFixed(1)} proj
            </ThemedText>
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
        {compareMode ? (
          <Ionicons
            name={compareSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={ms(24)}
            color={compareSelected ? c.gold : c.secondaryText}
            accessible={false}
          />
        ) : !isRostered ? (
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

