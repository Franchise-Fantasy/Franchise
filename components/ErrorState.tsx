import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
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
    padding: 24,
    minHeight: 200,
  },
  message: {
    fontSize: 15,
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
