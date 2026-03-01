import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface PageHeaderProps {
  title: string;
  rightAction?: React.ReactNode;
  onBack?: () => void;
}

export function PageHeader({ title, rightAction, onBack }: PageHeaderProps) {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={[styles.header, { borderBottomColor: c.border }]}>
      <TouchableOpacity
        onPress={onBack ?? (() => router.back())}
        style={styles.side}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Ionicons name="chevron-back" size={22} color={c.accent} />
        <ThemedText style={[styles.backText, { color: c.accent }]}>Back</ThemedText>
      </TouchableOpacity>
      <ThemedText type="defaultSemiBold" style={styles.title} numberOfLines={1} accessibilityRole="header">
        {title}
      </ThemedText>
      <View style={styles.side}>
        {rightAction ?? null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    height: 50,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  side: {
    width: 70,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backText: {
    fontSize: 16,
    fontWeight: '500',
  },
  title: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
  },
});
