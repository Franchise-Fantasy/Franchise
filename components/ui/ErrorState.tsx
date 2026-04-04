import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

interface ErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ErrorState({ message = 'Something went wrong', onRetry }: ErrorStateProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <Ionicons name="alert-circle-outline" size={40} color={c.secondaryText} />
      <ThemedText style={[styles.message, { color: c.secondaryText }]}>
        {message}
      </ThemedText>
      {onRetry && (
        <TouchableOpacity
          style={[styles.retryButton, { backgroundColor: c.accent }]}
          onPress={onRetry}
          activeOpacity={0.8}
        >
          <ThemedText style={[styles.retryText, { color: c.accentText }]}>
            Retry
          </ThemedText>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: s(24),
    minHeight: s(200),
  },
  message: {
    fontSize: ms(15),
    textAlign: 'center',
    marginTop: s(12),
    marginBottom: s(16),
  },
  retryButton: {
    paddingHorizontal: s(24),
    paddingVertical: s(10),
    borderRadius: 8,
  },
  retryText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
});
