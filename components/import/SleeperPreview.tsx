import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { SleeperPreviewResult } from '@/hooks/useImportSleeper';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

interface SleeperPreviewProps {
  data: SleeperPreviewResult;
}

export function SleeperPreview({ data }: SleeperPreviewProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const { league, teams, player_matches, unmatched_players, historical_seasons } = data;
  const totalPlayers = player_matches.length + unmatched_players.length;
  const matchRate = totalPlayers > 0
    ? Math.round((player_matches.length / totalPlayers) * 100)
    : 0;

  return (
    <View style={styles.container}>
      {/* League Info Card */}
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]} accessibilityRole="summary">
        <ThemedText type="defaultSemiBold" style={styles.cardTitle} accessibilityRole="header">
          League Info
        </ThemedText>
        <InfoRow label="Name" value={league.name} />
        <InfoRow label="Season" value={league.season} />
        <InfoRow label="Teams" value={String(league.total_rosters)} />
        <InfoRow label="Status" value={league.status} />
      </View>

      {/* Roster Positions */}
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.cardTitle} accessibilityRole="header">
          Roster Positions
        </ThemedText>
        <View style={styles.posRow}>
          {Object.entries(league.position_counts).map(([pos, count]) => (
            <View key={pos} style={[styles.posBadge, { backgroundColor: c.accent + '20' }]}>
              <ThemedText style={styles.posBadgeText}>
                {count}x {pos}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      {/* Scoring */}
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.cardTitle} accessibilityRole="header">
          Scoring Settings
        </ThemedText>
        <View style={styles.scoringGrid}>
          {Object.entries(league.scoring_settings).map(([stat, value]) => (
            <View key={stat} style={styles.scoringItem}>
              <ThemedText style={[styles.scoringStat, { color: c.secondaryText }]}>{stat}</ThemedText>
              <ThemedText style={styles.scoringValue}>
                {value > 0 ? '+' : ''}{value}
              </ThemedText>
            </View>
          ))}
        </View>
      </View>

      {/* Teams */}
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.cardTitle} accessibilityRole="header">
          Teams ({teams.length})
        </ThemedText>
        {teams.map((t, idx) => (
          <View key={t.roster_id} style={[styles.teamRow, { borderBottomColor: c.border }, idx === teams.length - 1 && { borderBottomWidth: 0 }]}>
            <ThemedText style={styles.teamName} numberOfLines={1}>{t.team_name}</ThemedText>
            <ThemedText style={[styles.teamMeta, { color: c.secondaryText }]}>
              {t.players} players
            </ThemedText>
          </View>
        ))}
      </View>

      {/* Player Matching Summary */}
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText type="defaultSemiBold" style={styles.cardTitle} accessibilityRole="header">
          Player Matching
        </ThemedText>
        <View style={styles.matchSummary}>
          <View style={styles.matchStat}>
            <Ionicons
              name="checkmark-circle"
              size={20}
              color={c.success}
              accessible={false}
            />
            <ThemedText style={styles.matchText}>
              {player_matches.length} matched
            </ThemedText>
          </View>
          {unmatched_players.length > 0 && (
            <View style={styles.matchStat}>
              <Ionicons
                name="alert-circle"
                size={20}
                color={c.warning}
                accessible={false}
              />
              <ThemedText style={styles.matchText}>
                {unmatched_players.length} unmatched
              </ThemedText>
            </View>
          )}
          <ThemedText style={[styles.matchRate, { color: c.secondaryText }]}>
            {matchRate}% match rate
          </ThemedText>
        </View>
      </View>

      {/* Historical Seasons */}
      {historical_seasons.length > 0 && (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText type="defaultSemiBold" style={styles.cardTitle} accessibilityRole="header">
            History ({historical_seasons.length} seasons)
          </ThemedText>
          {historical_seasons.map((hs) => (
            <ThemedText
              key={hs.season}
              style={[styles.historySeason, { color: c.secondaryText }]}
            >
              {hs.season} — {hs.teams.length} teams
            </ThemedText>
          ))}
        </View>
      )}
    </View>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.infoRow}>
      <ThemedText style={[styles.infoLabel, { color: c.secondaryText }]}>{label}</ThemedText>
      <ThemedText style={styles.infoValue}>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: s(16),
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: s(16),
  },
  cardTitle: {
    fontSize: ms(16),
    marginBottom: s(12),
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: s(4),
  },
  infoLabel: {
    fontSize: ms(14),
  },
  infoValue: {
    fontSize: ms(14),
    fontWeight: '500',
  },
  posRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(8),
  },
  posBadge: {
    paddingHorizontal: s(10),
    paddingVertical: s(4),
    borderRadius: 6,
  },
  posBadgeText: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  scoringGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(4),
  },
  scoringItem: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '45%',
    gap: s(6),
    paddingVertical: s(2),
  },
  scoringStat: {
    fontSize: ms(13),
    width: s(36),
  },
  scoringValue: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  teamRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamName: {
    fontSize: ms(14),
    fontWeight: '500',
    flex: 1,
  },
  teamMeta: {
    fontSize: ms(13),
  },
  matchSummary: {
    gap: s(8),
  },
  matchStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
  },
  matchText: {
    fontSize: ms(14),
  },
  matchRate: {
    fontSize: ms(13),
    marginTop: s(4),
  },
  historySeason: {
    fontSize: ms(14),
    paddingVertical: s(2),
  },
});
