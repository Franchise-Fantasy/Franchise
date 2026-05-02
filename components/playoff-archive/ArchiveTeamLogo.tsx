import { Image } from 'expo-image';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { getProLogoUrl, hasHistoricalLogo } from '@/utils/playoffArchive';

interface Props {
  franchiseId: string;
  tricode: string;
  primaryColor: string | null;
  secondaryColor: string | null;
  /** Per-season era key from pro_franchise_season.logo_key. When set, the
   *  historical-bucket variant of the logo is used; falls back to the
   *  modern team logo when null/empty. */
  logoKey?: string | null;
  size?: number;
}

// Picks a contrasting text color for the disc fallback. Pure-luminance check
// is enough — NBA primaries are either deep saturated colors or near-black,
// so a straight 0.5 threshold maps cleanly.
function readableText(hex: string | null): string {
  if (!hex || !hex.startsWith('#') || hex.length < 7) return '#FFFFFF';
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.6 ? '#1A1A1A' : '#FFFFFF';
}

// Renders the era-correct team logo PNG from the pro-team-logos bucket via
// expo-image (memory + disk cache, much faster than RN's Image on repeat
// renders). Falls back to a tricode-on-color disc when:
//   - the image fails / hasn't been uploaded for that era, OR
//   - this era is a relocation/major rebrand AND we don't yet have a
//     historical-bucket asset for it. The modern logo would be misleading
//     (e.g. Sonics era can't show the Thunder logo, NJ Nets era can't show
//     the BKN logo), so the disc stands in until a historical SVG ships.
// We detect relocation/rebrand by tricode mismatch — every per-season row in
// pro_franchise_season has the era's actual tricode, so if it differs from
// the current franchise_id, the branding has materially changed.
export function ArchiveTeamLogo({
  franchiseId,
  tricode,
  primaryColor,
  secondaryColor,
  logoKey,
  size = 32,
}: Props) {
  const [imageFailed, setImageFailed] = useState(false);
  const isLegacyBranding = tricode !== franchiseId;
  const eraHasHistoricalLogo = hasHistoricalLogo(logoKey);

  if (!imageFailed && (!isLegacyBranding || eraHasHistoricalLogo)) {
    return (
      <Image
        source={{ uri: getProLogoUrl(franchiseId, logoKey) }}
        style={{ width: size, height: size }}
        contentFit="contain"
        cachePolicy="memory-disk"
        transition={120}
        accessibilityLabel={`${tricode} logo`}
        onError={() => setImageFailed(true)}
      />
    );
  }

  // Fallback: tricode on franchise color
  const bg = primaryColor ?? '#444444';
  const border = secondaryColor ?? '#FFFFFF';
  const text = readableText(bg);
  const fontSize = Math.round(size * 0.38);

  return (
    <View
      style={[
        styles.disc,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          borderColor: border,
          borderWidth: Math.max(1, size / 28),
        },
      ]}
      accessibilityLabel={`${tricode} logo`}
      accessibilityRole="image"
    >
      <Text style={[styles.text, { color: text, fontSize }]}>{tricode}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  disc: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: '800',
    letterSpacing: -0.3,
  },
});
