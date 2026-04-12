import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface FormSectionProps {
  title?: string;
  children: ReactNode;
}

/**
 * Visual card grouping for related form fields within a wizard step.
 * Provides a subtle bordered container with an optional section header.
 */
export function FormSection({ title, children }: FormSectionProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View
      style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      accessibilityRole={title ? 'group' : undefined}
      accessibilityLabel={title}
    >
      {title && (
        <Text style={[styles.title, { color: c.secondaryText }]}>{title}</Text>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: s(14),
    marginBottom: s(16),
  },
  title: {
    fontSize: ms(12),
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: s(12),
  },
});
