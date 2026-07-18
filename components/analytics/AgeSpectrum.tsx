import { useState } from 'react';
import { LayoutChangeEvent, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { useColors } from '@/hooks/useColors';
import { ordinalSuffix } from '@/utils/formatting';
import { type TeamAgeProfile } from '@/utils/roster/rosterAge';
import { ms, s } from '@/utils/scale';

const DOT_R = s(4);
const MY_DOT_R = s(6);
const TRACK_H = s(18);
const COMPACT_TRACK_H = s(12);
const CAPTION_W = s(40);

interface AgeSpectrumProps {
  /** Every team with enough age data — `LeagueAgeComparison.allProfiles`. */
  profiles: TeamAgeProfile[];
  /** The team to highlight. On the analytics page this is the charted team
   *  (the TeamRail repoints it), not necessarily the signed-in user's. */
  teamId: string;
  /** 1 = youngest. Rendered in the accessibility label only. */
  rank: number;
  /** Track and axis words only — for the narrow home-preview column. */
  compact?: boolean;
}

/**
 * Every team's weighted production age laid out on one youngest→oldest axis,
 * with the charted team highlighted.
 *
 * This replaces the ordinal that used to mirror itself — rank 9 of 12 rendered
 * as "4th oldest" — which flipped the scale out from under you as the TeamRail
 * moved between teams. Dots sit at each team's real weighted age, so the strip
 * also shows what an ordinal can't: whether the charted team is an outlier or
 * buried in a tight pack.
 */
export function AgeSpectrum({
  profiles,
  teamId,
  rank,
  compact = false,
}: AgeSpectrumProps) {
  const c = useColors();
  const [trackW, setTrackW] = useState(0);

  const ages = profiles.map((p) => p.weightedProductionAge);
  // Both callers only render once buildLeagueComparison returns a comparison
  // (which needs 2+ teams), but an empty list would put every dot at NaN via
  // Math.min(...[]) === Infinity — fail visibly-absent rather than silently wrong.
  if (!ages.length) return null;

  const min = Math.min(...ages);
  const max = Math.max(...ages);
  const span = max - min;

  // A league whose teams all land on the same weighted age has no axis to
  // speak of — stack everyone mid-track rather than dividing by zero.
  const fraction = (age: number) => (span > 0 ? (age - min) / span : 0.5);

  // Inset by the largest dot so the end teams sit fully on the track instead of
  // half-hanging off it.
  const usable = Math.max(0, trackW - MY_DOT_R * 2);
  const xFor = (age: number) => MY_DOT_R + fraction(age) * usable;

  const mine = profiles.find((p) => p.teamId === teamId);
  const myAge = mine?.weightedProductionAge ?? null;

  // Paint order = array order, so a rival tied at the same weighted age would
  // land on top of the highlighted dot and mud its center. Draw the highlighted
  // team last so it always wins the overlap.
  const painted = [...profiles].sort(
    (a, b) => Number(a.teamId === teamId) - Number(b.teamId === teamId),
  );

  const onLayout = (e: LayoutChangeEvent) => setTrackW(e.nativeEvent.layout.width);

  const label =
    `Weighted age ${myAge?.toFixed(1) ?? 'unknown'}, ` +
    `${rank}${ordinalSuffix(rank)} youngest of ${profiles.length} teams. ` +
    `League weighted ages run from ${min.toFixed(1)} (youngest) to ${max.toFixed(1)} (oldest).`;

  const track = (
    <View
      style={[styles.track, { height: compact ? COMPACT_TRACK_H : TRACK_H }]}
      onLayout={onLayout}
    >
      <View style={[styles.rule, { backgroundColor: c.border }]} />
      {trackW > 0 &&
        painted.map((p) => {
          const isMine = p.teamId === teamId;
          const r = isMine ? MY_DOT_R : DOT_R;
          return (
            <View
              key={p.teamId}
              style={[
                styles.dot,
                {
                  width: r * 2,
                  height: r * 2,
                  borderRadius: r,
                  left: xFor(p.weightedProductionAge) - r,
                  marginTop: -r,
                  backgroundColor: isMine ? c.tint : c.secondaryText,
                  // Rival dots stay quiet and read as a distribution; overlapping
                  // ones darken, which is the right signal for a tight pack.
                  opacity: isMine ? 1 : 0.4,
                  borderColor: c.card,
                  borderWidth: isMine ? 1.5 : 0,
                },
              ]}
            />
          );
        })}
    </View>
  );

  if (compact) {
    return (
      <View accessible accessibilityLabel={label} style={styles.compactWrap}>
        {track}
        <View style={styles.endsRow}>
          <ThemedText
            type="varsitySmall"
            style={[styles.endLabel, { color: c.secondaryText }]}
          >
            YOUNG
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.endLabel, { color: c.secondaryText }]}
          >
            OLD
          </ThemedText>
        </View>
      </View>
    );
  }

  return (
    <View accessible accessibilityLabel={label}>
      <View style={styles.endsRow}>
        <ThemedText
          type="varsitySmall"
          style={[styles.endLabel, { color: c.secondaryText }]}
        >
          {`YOUNGEST ${min.toFixed(1)}`}
        </ThemedText>
        <ThemedText
          type="varsitySmall"
          style={[styles.endLabel, { color: c.secondaryText }]}
        >
          {`${max.toFixed(1)} OLDEST`}
        </ThemedText>
      </View>

      {track}

      {/* Anchors the highlighted dot to the WEIGHTED AGE figure beside it.
          Clamped to the track so an end team's caption doesn't hang off. */}
      <View style={styles.captionRow}>
        {myAge !== null && trackW > 0 ? (
          <ThemedText
            type="varsitySmall"
            style={[
              styles.caption,
              {
                color: c.tint,
                left: Math.max(
                  0,
                  Math.min(trackW - CAPTION_W, xFor(myAge) - CAPTION_W / 2),
                ),
              },
            ]}
          >
            {myAge.toFixed(1)}
          </ThemedText>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  compactWrap: {
    alignSelf: 'stretch',
  },
  endsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  endLabel: {
    fontSize: ms(9),
    letterSpacing: 1.0,
  },
  track: {
    position: 'relative',
    justifyContent: 'center',
  },
  rule: {
    height: 1,
    width: '100%',
  },
  dot: {
    position: 'absolute',
    top: '50%',
  },
  captionRow: {
    position: 'relative',
    height: ms(12),
  },
  caption: {
    position: 'absolute',
    top: 0,
    width: CAPTION_W,
    textAlign: 'center',
    fontSize: ms(9.5),
    letterSpacing: 0.5,
  },
});
