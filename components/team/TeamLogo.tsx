import { Image, View, StyleSheet, Text } from 'react-native';

import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';

interface TeamLogoProps {
  /** URL to a remote logo image, or null/undefined for initials fallback */
  logoKey: string | null | undefined;
  teamName: string;
  /** Fallback text if no logo (tricode or first 2 chars of name) */
  tricode?: string;
  size?: 'small' | 'medium' | 'large';
}

const SIZES = { small: 28, medium: 36, large: 56 } as const;
const FONT_SCALE = { small: 11, medium: 13, large: 20 } as const;

export function TeamLogo({ logoKey, teamName, tricode, size = 'medium' }: TeamLogoProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const dim = SIZES[size];
  const fontSize = FONT_SCALE[size];

  // If logoKey is a URL, render the remote image
  if (logoKey && (logoKey.startsWith('http://') || logoKey.startsWith('https://'))) {
    return (
      <Image
        source={{ uri: logoKey }}
        style={[styles.container, { width: dim, height: dim, borderRadius: dim / 2 }]}
        accessibilityLabel={`${teamName} logo`}
        accessibilityRole="image"
      />
    );
  }

  // Fallback: initials circle
  const initials = tricode ?? teamName.slice(0, 2).toUpperCase();
  return (
    <View
      style={[styles.container, { width: dim, height: dim, borderRadius: dim / 2, backgroundColor: c.cardAlt }]}
      accessibilityLabel={`${teamName} logo`}
      accessibilityRole="image"
    >
      <Text style={[styles.initials, { fontSize, color: c.text }]}>{initials}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  initials: {
    fontWeight: '700',
    textAlign: 'center',
  },
});
