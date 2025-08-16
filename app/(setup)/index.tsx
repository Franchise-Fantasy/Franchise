import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useRouter } from 'expo-router';
import { StyleSheet, TouchableOpacity } from 'react-native';

export default function SetupHome() {
    const router = useRouter();
    async function createLeague() {
      router.push('/create-league');
    }
    async function joinLeague() {
        router.push('/join-league');
      }
  return (
        <ThemedView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ThemedText type="title" style={styles.title}>You arent in a league yet!</ThemedText>
          <ThemedView style={styles.section}>
            <TouchableOpacity
              style={styles.button}
              onPress={createLeague}
            >
              <ThemedText style={styles.buttonText}>Create</ThemedText>
            </TouchableOpacity>
          </ThemedView>
          <ThemedView style={styles.section}>
            <TouchableOpacity
              style={styles.button}
              onPress={joinLeague}
            >
              <ThemedText style={styles.buttonText}>Join</ThemedText>
            </TouchableOpacity>
          </ThemedView>
          </ThemedView>
  );
}


const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    gap: 24,
    backgroundColor: 'rgba(255,255,255,0.95)',
    paddingTop: 48,
  },
  title: {
    marginBottom: 12,
  },
  section: {
    marginBottom: 18,
    gap: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 6,
    padding: 12,
    fontSize: 16,
    backgroundColor: '#f5f5f5',
    color: '#333',
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 6,
    alignItems: 'center',
    marginTop: 12,
  },
  buttonDisabled: {
    backgroundColor: '#A0A0A0',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});