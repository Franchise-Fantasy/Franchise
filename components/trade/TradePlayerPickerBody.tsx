import { Ionicons } from '@expo/vector-icons';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { PlayerName } from '@/components/player/PlayerName';
import { PlayerPortrait } from '@/components/player/PlayerPortrait';
import { AppTextInput } from '@/components/ui/AppTextInput';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayerStatBasis } from '@/hooks/usePlayerStatBasis';
import { TradeRosterPlayer, useTeamRosterForTrade } from '@/hooks/useTeamRosterForTrade';
import { foldSearchText, formatPosition } from '@/utils/formatting';
import { getInjuryBadge } from '@/utils/nba/injuryBadge';
import { ms, s } from '@/utils/scale';
import { calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';
import { formatShootingPct, shootingPct } from '@/utils/scoring/shootingPct';
import { spokenStatBasis } from '@/utils/scoring/statBasis';

const fixed1 = (v: number | null | undefined) => (v ?? 0).toFixed(1);

interface TradePlayerPickerBodyProps {
  teamId: string;
  leagueId: string;
  selectedPlayerIds: string[];
  lockedPlayerIds?: Set<string>;
  pendingDropPlayerIds?: Set<string>;
  /** League setting: when true, IR players are selectable (they land on the
   *  receiver's bench). Defaults to false — IR rows stay blocked. */
  irTradingEnabled?: boolean;
  onToggle: (player: TradeRosterPlayer, avgFpts: number) => void;
  isCategories?: boolean;
  /** Controlled search query — lifted to caller so collapse/reopen retains it. */
  search: string;
  onSearchChange: (q: string) => void;
}

/**
 * The interactive body of the player picker: search input + roster list +
 * per-row state badges (selected / IR / locked-in-other-trade / pending-drop).
 *
 * Extracted so two surfaces can compose it:
 * - The full-screen `TradePlayerPicker` (header + this body).
 * - The inline picker reveal in the upcoming `TradeFloor` rework, where
 *   the body lives directly under a team's lane chip row with a tighter
 *   header and capped maxHeight.
 *
 * Search is controlled (passed in) so the caller can persist queries
 * across collapse/reopen — important for the inline-reveal pattern.
 */
export function TradePlayerPickerBody({
  teamId,
  leagueId,
  selectedPlayerIds,
  lockedPlayerIds,
  pendingDropPlayerIds,
  irTradingEnabled = false,
  onToggle,
  isCategories,
  search,
  onSearchChange,
}: TradePlayerPickerBodyProps) {
  const c = useColors();
  const sport = useActiveLeagueSport(leagueId);

  const { data: roster, isLoading } = useTeamRosterForTrade(teamId, leagueId);
  const { data: scoringWeights } = useLeagueScoring(leagueId);
  // Between seasons every matview row is empty, which would hand the fairness
  // bar 0.0 for every player while draft picks keep their estimatePickFpts
  // value — a lopsided offer reading as even. Falls back to the season
  // projection, then last season, both labelled on the row.
  const { resolve } = usePlayerStatBasis(sport, roster);

  const searchKey = foldSearchText(search);
  const filtered = (roster ?? []).filter((p) =>
    foldSearchText(p.name).includes(searchKey),
  );

  const renderItem = ({ item, index }: { item: TradeRosterPlayer; index: number }) => {
    const isSelected = selectedPlayerIds.includes(item.player_id);
    const isLocked = lockedPlayerIds?.has(item.player_id) ?? false;
    const isPendingDrop = pendingDropPlayerIds?.has(item.player_id) ?? false;
    const isOnIR = item.roster_slot === 'IR';
    const irBlocked = isOnIR && !irTradingEnabled;
    const isDisabled = isLocked || irBlocked || isPendingDrop;
    // `row` is the line to READ — current season, or a projection / last season
    // when the current sample is empty. `item` stays the asset being traded.
    const { row, hasStats, basis, label: basisLabel } = resolve(item);
    // sport matters: without it an NFL row scores 0 (the NBA stat map finds
    // none of PASS_YD/RUSH_TD/...), and that 0 is what onToggle hands to the
    // trade's fairness bar — every NFL proposal would read as perfectly even.
    const fpts =
      hasStats && scoringWeights && !isCategories
        ? calculateAvgFantasyPoints(row, scoringWeights, sport)
        : null;
    const badge = getInjuryBadge(item.status);
    // Raw interpolation of these used to speak "null points" for the whole
    // pool between seasons, when every avg_* column is NULL.
    const spokenStats = !hasStats
      ? ', no stats yet this season'
      : isCategories
        ? `, ${spokenStatBasis(basis)}${fixed1(row.avg_pts)} points, ${fixed1(row.avg_reb)} rebounds, ${fixed1(row.avg_ast)} assists, ${fixed1(row.avg_stl)} steals, ${fixed1(row.avg_blk)} blocks`
        : fpts !== null
          ? `, ${fpts} ${spokenStatBasis(basis)}fantasy points`
          : '';

    return (
      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${formatPosition(item.position)}${isOnIR ? ', on injured reserve' : ''}${isLocked ? ', in active trade' : ''}${isPendingDrop ? ', queued for drop' : ''}${spokenStats}`}
        accessibilityState={{ selected: isSelected, disabled: isDisabled }}
        disabled={isDisabled}
        style={[
          styles.row,
          { borderBottomColor: c.border },
          isSelected && { backgroundColor: c.activeCard },
          isDisabled && { opacity: 0.45 },
          index === filtered.length - 1 && { borderBottomWidth: 0 },
        ]}
        onPress={() => onToggle(item, fpts ?? 0)}
      >
        <PlayerPortrait
          externalIdNba={item.external_id_nba}
          proTeam={item.pro_team}
          sport={sport}
          size={s(50)}
          imageHeight={s(42)}
          containerStyle={styles.portrait}
        />

        <View style={styles.info}>
          <View style={styles.nameRow}>
            <PlayerName
              name={item.name}
              type="defaultSemiBold"
              style={styles.playerName}
              containerStyle={{ flexShrink: 1 }}
            />
            {badge && (
              <View style={[styles.injuryBadge, { backgroundColor: badge.color }]}>
                <Text style={styles.injuryBadgeText}>{badge.label}</Text>
              </View>
            )}
            {isOnIR && (
              <View style={[styles.injuryBadge, { backgroundColor: c.danger }]}>
                <Text style={[styles.injuryBadgeText, { color: c.statusText }]}>IR</Text>
              </View>
            )}
            {isLocked && (
              <View style={[styles.injuryBadge, { backgroundColor: c.warning }]}>
                <Text style={[styles.injuryBadgeText, { color: c.statusText }]}>IN TRADE</Text>
              </View>
            )}
            {isPendingDrop && (
              <View style={[styles.injuryBadge, { backgroundColor: c.danger }]}>
                <Text style={[styles.injuryBadgeText, { color: c.statusText }]}>QUEUED DROP</Text>
              </View>
            )}
          </View>
          <ThemedText style={[styles.sub, { color: c.secondaryText }]}>
            {formatPosition(item.position)}
          </ThemedText>
        </View>
        {isCategories ? (
          <View style={styles.catStats}>
            <ThemedText style={[styles.catStatLine, { color: c.secondaryText }]}>
              {hasStats
                ? `${fixed1(row.avg_pts)}/${fixed1(row.avg_reb)}/${fixed1(row.avg_ast)}/${fixed1(row.avg_stl)}/${fixed1(row.avg_blk)}`
                : '—'}
            </ThemedText>
            {hasStats && (
              <ThemedText style={[styles.catSubLine, { color: c.secondaryText }]}>
                {formatShootingPct(shootingPct(row, 'fg'))} FG ·{' '}
                {formatShootingPct(shootingPct(row, 'ft'))} FT · {fixed1(row.avg_tov)} TO
              </ThemedText>
            )}
            {basisLabel && (
              <ThemedText style={[styles.basisTag, { color: c.gold }]} accessibilityElementsHidden>
                {basisLabel}
              </ThemedText>
            )}
          </View>
        ) : scoringWeights ? (
          <View style={styles.fptsCol}>
            <ThemedText style={[styles.fpts, { color: c.gold }]}>
              {fpts !== null ? fpts : '—'}
            </ThemedText>
            {basisLabel && (
              <ThemedText style={[styles.basisTag, { color: c.gold }]} accessibilityElementsHidden>
                {basisLabel}
              </ThemedText>
            )}
          </View>
        ) : null}
        {isSelected ? (
          <Ionicons name="checkmark-circle" size={20} color={c.gold} accessible={false} />
        ) : (
          <View style={styles.checkSpacer} />
        )}
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.container}>
      <AppTextInput
        accessibilityLabel="Search players"
        style={[styles.search, { backgroundColor: c.cardAlt, color: c.text, borderColor: c.border }]}
        placeholder="Search players..."
        placeholderTextColor={c.secondaryText}
        value={search}
        onChangeText={onSearchChange}
      />

      {isLoading ? (
        <View style={styles.loader}>
          <LogoSpinner />
        </View>
      ) : (
        <FlatList
          data={filtered}
          renderItem={renderItem}
          keyExtractor={(item) => item.player_id}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  search: {
    margin: s(10),
    padding: s(8),
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    fontSize: ms(14),
  },
  loader: { marginTop: s(20) },
  list: { paddingBottom: s(16) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(8),
    paddingHorizontal: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  portrait: { marginRight: s(8) },
  info: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
  },
  playerName: { fontSize: ms(14) },
  injuryBadge: {
    paddingHorizontal: s(4),
    paddingVertical: s(1),
    borderRadius: 3,
  },
  injuryBadgeText: {
    fontSize: ms(8),
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  sub: { fontSize: ms(11), marginTop: s(1) },
  fptsCol: {
    alignItems: 'flex-end' as const,
    marginRight: s(10),
  },
  fpts: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  catStats: {
    alignItems: 'flex-end' as const,
    marginRight: s(10),
  },
  catStatLine: { fontSize: ms(11) },
  catSubLine: { fontSize: ms(9), marginTop: s(1) },
  basisTag: {
    fontSize: ms(8),
    fontWeight: '700',
    letterSpacing: 0.5,
    marginTop: 1,
  },
  checkSpacer: { width: s(20) },
});
