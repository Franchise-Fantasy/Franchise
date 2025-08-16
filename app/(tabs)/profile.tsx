import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';
import { useSession } from '@/context/AuthProvider';
import { supabase } from '@/lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, StyleSheet, TouchableOpacity } from 'react-native';

export default function ProfileScreen() {
  const session = useSession();
  const [email, setEmail] = useState(session?.user.email ?? '');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSignOut() {
    setLoading(true);
    const before = await AsyncStorage.getAllKeys();
    console.log('Before signOut keys:', before);

    const { error } = await supabase.auth.signOut();

    const keys = await AsyncStorage.getAllKeys();
    const supabaseKeys = keys.filter(k => k.startsWith('sb-'));
    if (supabaseKeys.length > 0) {
      await AsyncStorage.multiRemove(supabaseKeys);
    }

    const after = await AsyncStorage.getAllKeys();
    console.log('After signOut keys:', after);

    setLoading(false);
    if (error) {
      Alert.alert('Error', error.message);
    } else {
      router.replace('/auth'); // Redirect to Auth screen
      console.log('User signed out successfully');
    }
  }

  return (
    <ThemedView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ThemedText type="title" style={styles.title}>Account Settings</ThemedText>

      <ThemedView style={styles.section}>
        <TouchableOpacity
          style={[styles.button, loading && styles.buttonDisabled]}
          onPress={handleSignOut}
          disabled={loading}
        >
          <ThemedText style={styles.buttonText}>Sign Out</ThemedText>
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