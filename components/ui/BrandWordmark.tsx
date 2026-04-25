import { Image } from 'react-native';

import { useColorScheme } from '@/hooks/useColorScheme';

const GOLD = require('@/assets/images/Wordmark_Gold.png');
const UMBER = require('@/assets/images/Wordmark_Umber.png');

interface BrandWordmarkProps {
  width?: number;
}

// Wordmark source aspect ratio is ~3.8:1 (wide script). Adjust if proportions look off.
const ASPECT = 3.8;

export function BrandWordmark({ width = 220 }: BrandWordmarkProps) {
  const scheme = useColorScheme() ?? 'light';
  const source = scheme === 'dark' ? GOLD : UMBER;
  const height = width / ASPECT;

  return (
    <Image
      source={source}
      style={{ width, height }}
      resizeMode="contain"
      accessibilityLabel="Franchise"
      accessibilityRole="image"
    />
  );
}
