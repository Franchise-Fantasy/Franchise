import { Image } from 'expo-image';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { PlayerHeadshotImage } from '@/components/player/PlayerHeadshotImage';
import { type Sport } from '@/constants/LeagueDefaults';
import { useColors } from '@/hooks/useColors';
import { getTeamLogoUrl } from '@/utils/nba/playerHeadshot';
import { ms, s } from '@/utils/scale';

interface PlayerPortraitProps {
  externalIdNba: string | number | null | undefined;
  proTeam: string | null | undefined;
  sport: Sport;
  /** Circle diameter (already scaled via `s()`). */
  size: number;
  /** Bottom-anchored headshot height (already scaled). Defaults to `size - s(8)`. */
  imageHeight?: number;
  /** Team-pill logo square (already scaled). Defaults `s(9)`. */
  teamLogoSize?: number;
  /** Team tricode font size (already moderate-scaled via `ms()`). Defaults `ms(7)`. */
  teamTextFontSize?: number;
  showTeamPill?: boolean;
  accessible?: boolean;
  /** Outer wrapper — set width/height (when the wrap differs from the circle) and margins here. */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * Circular player headshot with the team-tricode medallion overlay — the shared
 * chrome used by the free-agent rows, the trade picker, and the compare columns.
 * Each surface keeps its own sizing via the `size` / `imageHeight` props so the
 * established look at every call site is preserved.
 */
export function PlayerPortrait({
  externalIdNba,
  proTeam,
  sport,
  size,
  imageHeight,
  teamLogoSize = s(9),
  teamTextFontSize = ms(7),
  showTeamPill = true,
  accessible,
  containerStyle,
}: PlayerPortraitProps) {
  const c = useColors();
  const logoUrl = getTeamLogoUrl(proTeam, sport);

  return (
    <View style={[styles.wrap, { width: size, height: size }, containerStyle]}>
      <View
        style={[
          styles.circle,
          { width: size, height: size, borderRadius: size / 2, borderColor: c.heritageGold, backgroundColor: c.cardAlt },
        ]}
      >
        <PlayerHeadshotImage
          externalIdNba={externalIdNba}
          sport={sport}
          style={[styles.img, { height: imageHeight ?? size - s(8) }]}
          accessible={accessible}
        />
      </View>
      {showTeamPill && (
        <View style={styles.teamPill}>
          {logoUrl && (
            <Image
              source={{ uri: logoUrl }}
              style={{ width: teamLogoSize, height: teamLogoSize }}
              contentFit="contain"
              cachePolicy="memory-disk"
              recyclingKey={logoUrl}
            />
          )}
          <Text style={[styles.teamPillText, { fontSize: teamTextFontSize, color: c.statusText }]}>
            {proTeam}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'flex-end' },
  circle: { borderWidth: 1.5, overflow: 'hidden' },
  img: { position: 'absolute', bottom: s(-2), left: 0, right: 0 },
  teamPill: {
    position: 'absolute',
    bottom: 0,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: 8,
    paddingHorizontal: s(3),
    paddingVertical: s(1),
    gap: s(2),
  },
  teamPillText: { fontWeight: '700', letterSpacing: 0.3 },
});
