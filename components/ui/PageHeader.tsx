import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { IconSymbol } from '@/components/ui/IconSymbol';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { ms, s } from '@/utils/scale';

interface PageHeaderProps {
  title: string;
  /** Optional rich-content title; replaces the static text title when set.
   *  Use for interactive title clusters (e.g. season picker with arrows).
   *  pointerEvents falls through to "box-none" so back/right slot stay tappable. */
  titleNode?: React.ReactNode;
  rightAction?: React.ReactNode;
  onBack?: () => void;
}

export function PageHeader({ title, titleNode, rightAction, onBack }: PageHeaderProps) {
  const router = useRouter();
  const c = useColors();

  return (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      {/* Title is absolutely centered so it stays put even when the right
          action is wider than the back button (which would shift it under
          the previous flex-1 layout). */}
      <View
        style={styles.titleAbsolute}
        pointerEvents={titleNode ? 'box-none' : 'none'}
      >
        {titleNode ?? (
          <ThemedText
            type="varsity"
            style={[styles.title, { color: c.secondaryText }]}
            numberOfLines={1}
            accessibilityRole="header"
          >
            {title}
          </ThemedText>
        )}
      </View>

      <TouchableOpacity
        onPress={onBack ?? (() => router.back())}
        style={styles.side}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <IconSymbol name="chevron.backward" size={20} color={c.icon} accessible={false} />
      </TouchableOpacity>
      <View style={[styles.side, styles.sideRight]}>
        {rightAction ?? null}
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
    position: 'relative',
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
  titleAbsolute: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(56),
  },
  title: {
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
});
