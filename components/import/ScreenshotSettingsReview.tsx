import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import type { SettingsExtractionResult } from '@/hooks/useImportScreenshot';
import { Ionicons } from '@expo/vector-icons';
import { useCallback } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

interface ScreenshotSettingsReviewProps {
  extracted: SettingsExtractionResult;
  onAcceptScoring: (scoring: Record<string, number>) => void;
  onAcceptRosterPositions: (positions: Array<{ position: string; count: number }>) => void;
  onAcceptLeagueName: (name: string) => void;
  onAcceptTeamCount: (count: number) => void;
}

export function ScreenshotSettingsReview({
  extracted,
  onAcceptScoring,
  onAcceptRosterPositions,
  onAcceptLeagueName,
  onAcceptTeamCount,
}: ScreenshotSettingsReviewProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const hasScoring = extracted.scoring_values && Object.keys(extracted.scoring_values).length > 0;
  const hasRoster = extracted.roster_positions && extracted.roster_positions.length > 0;

  return (
    <View style={styles.container}>
      <ThemedText type="defaultSemiBold" style={styles.header} accessibilityRole="header">
        Extracted Settings
      </ThemedText>
      <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
        Review what was extracted from your screenshot. Accept the values you want to use, or skip to configure manually.
      </ThemedText>

      {/* League name */}
      {extracted.league_name && (
        <SettingCard
          label="League Name"
          value={extracted.league_name}
          onAccept={() => onAcceptLeagueName(extracted.league_name!)}
        />
      )}

      {/* Team count */}
      {extracted.team_count && (
        <SettingCard
          label="Teams"
          value={String(extracted.team_count)}
          onAccept={() => onAcceptTeamCount(extracted.team_count!)}
        />
      )}

      {/* Scoring type */}
      {extracted.scoring_type && (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="stats-chart-outline" size={18} color={c.accent} accessible={false} />
            <ThemedText type="defaultSemiBold" style={styles.cardLabel}>
              Scoring Type
            </ThemedText>
          </View>
          <ThemedText style={[styles.cardValue, { color: c.secondaryText }]}>
            {extracted.scoring_type === 'categories' ? 'H2H Categories' : 'Points'}
          </ThemedText>
        </View>
      )}

      {/* Scoring values */}
      {hasScoring && (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="calculator-outline" size={18} color={c.accent} accessible={false} />
            <ThemedText type="defaultSemiBold" style={styles.cardLabel}>
              Scoring Values
            </ThemedText>
          </View>
          <View style={styles.scoringGrid}>
            {Object.entries(extracted.scoring_values!).map(([stat, value]) => (
              <View key={stat} style={styles.scoringItem}>
                <ThemedText style={styles.statName}>{stat}</ThemedText>
                <ThemedText style={[styles.statValue, { color: value < 0 ? '#FF3B30' : '#34C759' }]}>
                  {value > 0 ? '+' : ''}{value}
                </ThemedText>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.acceptBtn, { backgroundColor: c.accent }]}
            onPress={() => onAcceptScoring(extracted.scoring_values!)}
            accessibilityRole="button"
            accessibilityLabel="Use these scoring values"
          >
            <Text style={[styles.acceptBtnText, { color: c.accentText }]}>
              Use These Values
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Roster positions */}
      {hasRoster && (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.cardHeader}>
            <Ionicons name="people-outline" size={18} color={c.accent} accessible={false} />
            <ThemedText type="defaultSemiBold" style={styles.cardLabel}>
              Roster Positions
            </ThemedText>
          </View>
          <View style={styles.rosterGrid}>
            {extracted.roster_positions!.map((rp) => (
              <View key={rp.position} style={styles.rosterItem}>
                <ThemedText style={styles.posName}>{rp.position}</ThemedText>
                <ThemedText style={[styles.posCount, { color: c.accent }]}>×{rp.count}</ThemedText>
              </View>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.acceptBtn, { backgroundColor: c.accent }]}
            onPress={() => onAcceptRosterPositions(extracted.roster_positions!)}
            accessibilityRole="button"
            accessibilityLabel="Use these roster positions"
          >
            <Text style={[styles.acceptBtnText, { color: c.accentText }]}>
              Use These Positions
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {!hasScoring && !hasRoster && !extracted.league_name && !extracted.team_count && (
        <View style={[styles.emptyCard, { backgroundColor: c.card, borderColor: c.border }]}>
          <Ionicons name="alert-circle-outline" size={24} color={c.secondaryText} accessible={false} />
          <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
            Could not extract any settings from this screenshot. You can configure settings manually in the next steps.
          </ThemedText>
        </View>
      )}
    </View>
  );
}

function SettingCard({
  label,
  value,
  onAccept,
}: {
  label: string;
  value: string;
  onAccept: () => void;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.settingRow}>
        <View>
          <ThemedText style={[styles.cardLabel, { fontSize: 13 }]}>{label}</ThemedText>
          <ThemedText type="defaultSemiBold" style={styles.settingValue}>{value}</ThemedText>
        </View>
        <TouchableOpacity
          style={[styles.useBtn, { backgroundColor: c.accent }]}
          onPress={onAccept}
          accessibilityRole="button"
          accessibilityLabel={`Use ${label}: ${value}`}
        >
          <Text style={[styles.useBtnText, { color: c.accentText }]}>Use</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: 12,
  },
  header: {
    fontSize: 16,
  },
  desc: {
    fontSize: 13,
    lineHeight: 18,
  },
  card: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardLabel: {
    fontSize: 14,
  },
  cardValue: {
    fontSize: 14,
    fontWeight: '500',
  },
  scoringGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  scoringItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.1)',
  },
  statName: {
    fontSize: 13,
    fontWeight: '600',
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
  },
  rosterGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  rosterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: 'rgba(128,128,128,0.1)',
  },
  posName: {
    fontSize: 13,
    fontWeight: '600',
  },
  posCount: {
    fontSize: 13,
    fontWeight: '700',
  },
  acceptBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  acceptBtnText: {
    fontSize: 14,
    fontWeight: '700',
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  settingValue: {
    fontSize: 16,
    marginTop: 2,
  },
  useBtn: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  useBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  emptyCard: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 20,
    gap: 10,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
});
