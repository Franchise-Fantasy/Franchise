import { StyleSheet, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors, cardShadow } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useAllTimeRecords } from '@/hooks/useLeagueHistory';
import { ms, s } from '@/utils/scale';


interface AllTimeRecordsProps {
  leagueId: string;
}

/**
 * Record Book — always-visible grid of the league's all-time highs and
 * lows. Each record sits on its own tile: varsitySmall label, display-
 * font value, the team that owns it, then a smaller detail line.
 */
export function AllTimeRecords({ leagueId }: AllTimeRecordsProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: records, isLoading } = useAllTimeRecords(leagueId);

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <View style={[styles.labelRule, { backgroundColor: c.gold }]} />
        <ThemedText type="sectionLabel" style={{ color: c.text }}>
          Record Book
        </ThemedText>
      </View>

      <View
        style={[
          styles.card,
          { backgroundColor: c.card, borderColor: c.border, ...cardShadow },
        ]}
      >
        {isLoading ? (
          <View style={styles.loading}>
            <LogoSpinner />
          </View>
        ) : !records || records.length === 0 ? (
          <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
            Records will appear once the league has played a season.
          </ThemedText>
        ) : (
          <View style={styles.grid}>
            {records.map((rec, i) => (
              <View
                key={i}
                style={[
                  styles.tile,
                  { backgroundColor: c.cardAlt, borderColor: c.border },
                ]}
                accessibilityLabel={`${rec.label}: ${rec.value} by ${rec.teamName}. ${rec.detail}`}
              >
                <ThemedText
                  type="varsitySmall"
                  style={[styles.tileLabel, { color: c.secondaryText }]}
                >
                  {rec.label}
                </ThemedText>
                <ThemedText
                  type="display"
                  style={[styles.tileValue, { color: c.text }]}
                  numberOfLines={1}
                  adjustsFontSizeToFit
                >
                  {rec.value}
                </ThemedText>
                <ThemedText
                  style={[styles.tileTeam, { color: c.text }]}
                  numberOfLines={1}
                  ellipsizeMode="tail"
                >
                  {rec.teamName}
                </ThemedText>
                <ThemedText style={[styles.tileDetail, { color: c.secondaryText }]}>
                  {rec.detail}
                </ThemedText>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginBottom: s(4),
  },
  labelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: s(10),
    gap: s(10),
  },
  labelRule: {
    height: 2,
    width: s(18),
  },
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingTop: s(14),
    paddingBottom: s(14),
    marginBottom: s(16),
    overflow: 'hidden',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: s(10),
  },
  tile: {
    flexBasis: '47%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: s(12),
    paddingHorizontal: s(12),
  },
  tileLabel: {
    fontSize: ms(9.5),
    marginBottom: s(6),
  },
  tileValue: {
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
    marginBottom: s(4),
  },
  tileTeam: {
    fontSize: ms(12),
    fontWeight: '600',
    marginBottom: s(2),
  },
  tileDetail: {
    fontSize: ms(10.5),
  },
  emptyText: {
    fontSize: ms(13),
    textAlign: 'center',
    paddingVertical: s(20),
  },
  loading: {
    paddingVertical: s(24),
  },
});
