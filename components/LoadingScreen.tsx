import { ThemedView } from '@/components/ThemedView';
import { ActivityIndicator, Image, StyleSheet } from 'react-native';

export default function LoadingScreen() {
  return (
    <ThemedView style={styles.container}>
      <Image 
        source={require('../assets/images/react-logo.png')}
        style={styles.logo}
      />
      <ActivityIndicator size="large" style={styles.spinner} />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 20,
  },
  spinner: {
    marginTop: 20,
  },
});
