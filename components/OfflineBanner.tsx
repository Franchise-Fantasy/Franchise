import { useNetInfo } from '@react-native-community/netinfo';
import { StyleSheet, Text, View } from 'react-native';

export function OfflineBanner() {
  const { isConnected } = useNetInfo();

  // null means unknown (still loading), don't show banner
  if (isConnected !== false) return null;

  return (
    <View style={styles.banner}>
      <Text style={styles.text}>No internet connection</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FF3B30',
    paddingVertical: 6,
    alignItems: 'center',
  },
  text: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});
