import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { useLeague } from '@/hooks/useLeague';
import { useRouter } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet } from 'react-native';

export default function LoadingScreen() {
  const router = useRouter();
  const { data: league, isLoading } = useLeague();

  useEffect(() => {
    if (!isLoading && league) {
      router.replace('/(tabs)');
    }
  }, [isLoading, league]);

  return (
    <ThemedView style={styles.container}>
      <ActivityIndicator size="large" />
      <ThemedText style={styles.text}>Setting up your league...</ThemedText>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  text: {
    marginTop: 16,
  }
});