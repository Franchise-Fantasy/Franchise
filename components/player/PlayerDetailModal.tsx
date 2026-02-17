import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayerGameLog } from '@/hooks/usePlayerGameLog';
import { PlayerGameLog, PlayerSeasonStats } from '@/types/player';
import { calculateAvgFantasyPoints, calculateGameFantasyPoints } from '@/utils/fantasyPoints';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatPosition } from '@/utils/formatting';

interface PlayerDetailModalProps {
  player: PlayerSeasonStats | null;
  leagueId: string;
  onClose: () => void;
}

function StatBox({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <View style={styles.statBox}>
      <ThemedText style={[styles.statLabel, { color }]}>{label}</ThemedText>
      <ThemedText type="defaultSemiBold">{value}</ThemedText>
    </View>
  );
}

export function PlayerDetailModal({ player, leagueId, onClose }: PlayerDetailModalProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { data: scoringWeights } = useLeagueScoring(leagueId);
  const { data: gameLog, isLoading: isLoadingGameLog } = usePlayerGameLog(
    player?.player_id ?? ''
  );

  if (!player) return null;

  const avgFpts = scoringWeights
    ? calculateAvgFantasyPoints(player, scoringWeights)
    : null;

  const fgPct = player.avg_fga > 0
    ? ((player.avg_fgm / player.avg_fga) * 100).toFixed(1)
    : '0.0';
  const threePct = player.avg_3pa > 0
    ? ((player.avg_3pm / player.avg_3pa) * 100).toFixed(1)
    : '0.0';
  const ftPct = player.avg_fta > 0
    ? ((player.avg_ftm / player.avg_fta) * 100).toFixed(1)
    : '0.0';

  const renderGameRow = ({ item }: { item: PlayerGameLog }) => {
    const gameFpts = scoringWeights
      ? calculateGameFantasyPoints(item, scoringWeights)
      : null;

    return (
      <View style={[styles.gameRow, { borderBottomColor: c.border }]}>
        <ThemedText style={[styles.gameCell, styles.gameCellWide, { color: c.secondaryText }]} numberOfLines={1}>
          {item.matchup ?? item.game_date ?? '—'}
        </ThemedText>
        <ThemedText style={styles.gameCell}>{item.pts}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.reb}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.ast}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.stl}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.blk}</ThemedText>
        <ThemedText style={styles.gameCell}>{item.tov}</ThemedText>
        {gameFpts !== null && (
          <ThemedText style={[styles.gameCell, { color: c.accent, fontWeight: '600' }]}>
            {gameFpts}
          </ThemedText>
        )}
      </View>
    );
  };

  return (
    <Modal visible={!!player} animationType="slide" presentationStyle="pageSheet">
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: c.border }]}>
          <View style={styles.headerInfo}>
            <ThemedText type="title" style={styles.playerName}>{player.name}</ThemedText>
            <ThemedText style={[styles.subtitle, { color: c.secondaryText }]}>
              {formatPosition(player.position)} · {player.nba_team} · {player.games_played} GP
            </ThemedText>
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <ThemedText style={styles.closeText}>✕</ThemedText>
          </TouchableOpacity>
        </View>

        <FlatList
          data={gameLog ?? []}
          renderItem={renderGameRow}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={
            <>
              {/* Fantasy Points Summary */}
              {avgFpts !== null && (
                <View style={[styles.fptsSection, { backgroundColor: c.activeCard, borderColor: c.activeBorder }]}>
                  <ThemedText style={[styles.fptsLabel, { color: c.secondaryText }]}>
                    Avg Fantasy Points
                  </ThemedText>
                  <ThemedText style={[styles.fptsValue, { color: c.activeText }]}>
                    {avgFpts}
                  </ThemedText>
                </View>
              )}

              {/* Season Averages */}
              <View style={styles.section}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Season Averages
                </ThemedText>
                <View style={[styles.statsGrid, { backgroundColor: c.card }]}>
                  <StatBox label="PPG" value={String(player.avg_pts)} color={c.secondaryText} />
                  <StatBox label="RPG" value={String(player.avg_reb)} color={c.secondaryText} />
                  <StatBox label="APG" value={String(player.avg_ast)} color={c.secondaryText} />
                  <StatBox label="SPG" value={String(player.avg_stl)} color={c.secondaryText} />
                  <StatBox label="BPG" value={String(player.avg_blk)} color={c.secondaryText} />
                  <StatBox label="TPG" value={String(player.avg_tov)} color={c.secondaryText} />
                  <StatBox label="FG%" value={`${fgPct}%`} color={c.secondaryText} />
                  <StatBox label="3P%" value={`${threePct}%`} color={c.secondaryText} />
                  <StatBox label="FT%" value={`${ftPct}%`} color={c.secondaryText} />
                  <StatBox label="MPG" value={String(player.avg_min)} color={c.secondaryText} />
                </View>
              </View>

              {/* Game Log Header */}
              <View style={styles.section}>
                <ThemedText type="subtitle" style={styles.sectionTitle}>
                  Game Log
                </ThemedText>
                <View style={[styles.gameRow, styles.gameHeader, { borderBottomColor: c.border }]}>
                  <ThemedText style={[styles.gameCell, styles.gameCellWide, styles.gameHeaderText, { color: c.secondaryText }]}>
                    GAME
                  </ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>PTS</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>REB</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>AST</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>STL</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>BLK</ThemedText>
                  <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>TO</ThemedText>
                  {scoringWeights && (
                    <ThemedText style={[styles.gameCell, styles.gameHeaderText, { color: c.secondaryText }]}>FPTS</ThemedText>
                  )}
                </View>
              </View>

              {isLoadingGameLog && <ActivityIndicator style={styles.loading} />}
            </>
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerInfo: {
    flex: 1,
  },
  playerName: {
    fontSize: 22,
  },
  subtitle: {
    fontSize: 13,
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
    marginTop: -4,
    marginRight: -4,
  },
  closeText: {
    fontSize: 18,
  },
  fptsSection: {
    margin: 16,
    paddingHorizontal: 24,
    paddingVertical: 16,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
  },
  fptsLabel: {
    fontSize: 13,
  },
  fptsValue: {
    fontSize: 32,
    lineHeight: 40,
    fontWeight: '700',
    marginTop: 4,
  },
  section: {
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  sectionTitle: {
    marginBottom: 8,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderRadius: 8,
    padding: 8,
  },
  statBox: {
    width: '20%',
    alignItems: 'center',
    paddingVertical: 8,
  },
  statLabel: {
    fontSize: 11,
    marginBottom: 2,
  },
  gameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  gameHeader: {
    paddingBottom: 6,
  },
  gameHeaderText: {
    fontSize: 10,
    fontWeight: '600',
  },
  gameCell: {
    width: 40,
    textAlign: 'center',
    fontSize: 13,
  },
  gameCellWide: {
    flex: 1,
    textAlign: 'left',
  },
  loading: {
    padding: 20,
  },
});
