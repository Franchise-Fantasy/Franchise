import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/IconSymbol';
import { SportBadge } from '@/components/ui/SportBadge';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface PageHeaderProps {
  title: string;
  rightAction?: React.ReactNode;
  onBack?: () => void;
  /** Hide the sport badge — use on screens outside league context (auth, setup). */
  hideSport?: boolean;
}

export function PageHeader({ title, rightAction, onBack, hideSport }: PageHeaderProps) {
  const router = useRouter();
  const c = useColors();
  const sport = useActiveLeagueSport();

  return (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      <TouchableOpacity
        onPress={onBack ?? (() => router.back())}
        style={styles.side}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <IconSymbol name="chevron.backward" size={20} color={c.icon} accessible={false} />
      </TouchableOpacity>
      <ThemedText
        type="varsity"
        style={[styles.title, { color: c.secondaryText }]}
        numberOfLines={1}
        accessibilityRole="header"
      >
        {title}
      </ThemedText>
      <View style={[styles.side, styles.sideRight]}>
        {rightAction ?? (!hideSport && sport !== 'nba' ? <SportBadge sport={sport} /> : null)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    padding: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    height: s(50),
    justifyContent: 'space-between',
  },
  side: {
    paddingHorizontal: s(8),
    minWidth: s(36),
    alignItems: 'center',
    justifyContent: 'center',
  },
  sideRight: {
    alignItems: 'flex-end',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
    marginHorizontal: s(8),
  },
});
