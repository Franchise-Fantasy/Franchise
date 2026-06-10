import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { PlayerName } from '@/components/player/PlayerName';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { type Sport } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { usePlayerProjections } from '@/hooks/usePlayerProjections';
import { useProjectionToggle } from '@/hooks/useProjectionToggle';
import type { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { ms, s } from '@/utils/scale';
import {
  ANALYTICS_MIN_CURRENT_SEASON_GAMES,
  calculateAvgFantasyPoints,
  formatScore,
  projAvgRowToFpts,
} from '@/utils/scoring/fantasyPoints';

interface PerformanceVsExpectedProps {
  players: (PlayerSeasonStats & { roster_slot?: string | null })[];
  weights: ScoringWeight[] | undefined;
  sport: Sport;
}

interface Row {
  playerId: string;
  name: string;
  proj: number;
  actual: number;
  delta: number;
}

/**
 * "Performance vs Expected" — charts each rostered player's actual season
 * FPTS/G against their projected FPTS/G (from the projections engine), so the
 * manager can spot who's overperforming (sell-high) and who's underperforming
 * (buy-low). Points-league view. Replaces the ComingSoonTeaser now that
 * projections ship.
 *
 * The header carries an inline toggle so the manager can turn projections on
 * or off right where they appear; it's bound to the global projection
 * preference (shared with player detail + free-agent ranking). When off, or
 * when there are no projections for this sport yet (e.g. NBA pre-launch), the
 * card shows the teaser copy instead of the chart.
 */
export function PerformanceVsExpected({ players, weights, sport }: PerformanceVsExpectedProps) {
  const c = useColors();
  const { enabled, toggle } = useProjectionToggle();
  // "vs expected" uses the season-long projection as the baseline (the
  // pre-season expectation), not the volatile next-game line. Dormant until a
  // pre-season snapshot exists for the current season.
  const { data: projections } = usePlayerProjections(sport, 'season', enabled);

  const rows = useMemo<Row[]>(() => {
    if (!enabled || !projections || !weights?.length) return [];
    const out: Row[] = [];
    for (const p of players) {
      const projRow = projections.get(p.player_id);
      if (!projRow) continue;
      const proj = projAvgRowToFpts(projRow as Record<string, unknown>, weights);
      if (proj <= 0) continue;
      // Only compare against a meaningful current-season sample, else "actual"
      // is just early-season noise.
      if ((p.games_played ?? 0) < ANALYTICS_MIN_CURRENT_SEASON_GAMES) continue;
      const actual = calculateAvgFantasyPoints(p, weights);
      out.push({ playerId: p.player_id, name: p.name, proj, actual, delta: actual - proj });
    }
    return out.sort((a, b) => b.delta - a.delta);
  }, [enabled, projections, weights, players]);

  const maxAbsDelta = useMemo(
    () => rows.reduce((m, r) => Math.max(m, Math.abs(r.delta)), 0),
    [rows],
  );

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.headerRow}>
        <View style={[styles.rule, { backgroundColor: c.gold }]} />
        <ThemedText type="varsitySmall" style={[styles.eyebrow, { color: c.secondaryText }]}>
          PERFORMANCE VS EXPECTED
        </ThemedText>
        <TouchableOpacity
          onPress={toggle}
          accessibilityRole="switch"
          accessibilityState={{ checked: enabled }}
          accessibilityLabel={`Projections ${enabled ? 'on' : 'off'}. Tap to turn ${enabled ? 'off' : 'on'}.`}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          style={[styles.toggle, { borderColor: enabled ? c.gold : c.border }]}
        >
          <Ionicons
            name={enabled ? 'eye-outline' : 'eye-off-outline'}
            size={ms(12)}
            color={enabled ? c.gold : c.secondaryText}
          />
          <ThemedText
            type="varsitySmall"
            style={[styles.toggleText, { color: enabled ? c.gold : c.secondaryText }]}
          >
            {enabled ? 'ON' : 'OFF'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {enabled && rows.length > 0 ? (
        <View
          accessibilityLabel="Performance versus expected. Each player's actual season fantasy points per game compared to their projection."
        >
          {rows.map((r) => {
            const over = r.delta >= 0;
            const barWidth = maxAbsDelta > 0 ? Math.abs(r.delta) / maxAbsDelta : 0;
            return (
              <View key={r.playerId} style={styles.row}>
                <PlayerName
                  name={r.name}
                  style={[styles.name, { color: c.text }]}
                  containerStyle={{ flex: 1 }}
                />
                <View style={styles.barWrap}>
                  <View
                    style={[
                      styles.bar,
                      {
                        width: `${Math.max(barWidth * 100, 4)}%`,
                        backgroundColor: over ? c.success : c.danger,
                      },
                    ]}
                  />
                </View>
                <ThemedText style={[styles.figures, { color: c.secondaryText }]}>
                  {formatScore(r.actual)} vs {formatScore(r.proj)}
                </ThemedText>
                <ThemedText
                  style={[styles.delta, { color: over ? c.success : c.danger }]}
                >
                  {over ? '+' : ''}
                  {formatScore(r.delta)}
                </ThemedText>
              </View>
            );
          })}
        </View>
      ) : (
        <>
          <ThemedText type="display" style={[styles.title, { color: c.text }]}>
            {enabled ? 'No baseline yet' : 'Projections off'}
          </ThemedText>
          <ThemedText style={[styles.body, { color: c.secondaryText }]}>
            {enabled
              ? "This charts each player's actual average against what we expected them to average — so you can spot who's over- and under-performing. Waiting on a pre-season projection plus a few games logged."
              : 'Projections are hidden. Turn them on to compare each player against their expected output.'}
          </ThemedText>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(16),
    marginTop: s(14),
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(10),
  },
  rule: { height: 2, width: s(18) },
  eyebrow: { flex: 1, fontSize: ms(9.5), letterSpacing: 1.3 },
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(4),
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: s(6),
    paddingVertical: s(2),
  },
  toggleText: { fontSize: ms(8.5), letterSpacing: 1.0 },
  title: {
    fontFamily: Fonts.display,
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.2,
    marginBottom: s(6),
  },
  body: { fontSize: ms(13), lineHeight: ms(19) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    paddingVertical: s(5),
  },
  name: { flex: 1, fontSize: ms(13) },
  barWrap: { width: s(56), height: s(6), justifyContent: 'center' },
  bar: { height: s(6), borderRadius: 3 },
  figures: { fontSize: ms(11), width: s(72), textAlign: 'right' },
  delta: { fontSize: ms(12), fontWeight: '700', width: s(40), textAlign: 'right' },
});
