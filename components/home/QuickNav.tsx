import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { ThemedText } from '../ThemedText';
import { ThemedView } from '../ThemedView';
import { IconSymbol } from '../ui/IconSymbol';

const NAV_ITEMS = [
  { icon: 'chart.bar', label: 'Scoreboard', route: '/scoreboard' },
  { icon: 'arrow.triangle.2.circlepath', label: 'Trade Room', route: '/trades' },
  { icon: 'clock', label: 'Transactions', route: '/activity' },
  { icon: 'info.circle', label: 'League Info', route: '/league-info' },
];

export function QuickNav() {
  return (
    <ThemedView style={styles.section}>
      <ThemedText type="subtitle">Quick Navigation</ThemedText>
      <View style={styles.grid}>
        {NAV_ITEMS.map(item => (
          <TouchableOpacity key={item.route} style={styles.navItem}>
            <IconSymbol name={item.icon} size={24} color="#666" />
            <ThemedText style={styles.label}>{item.label}</ThemedText>
          </TouchableOpacity>
        ))}
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  section: {
    marginBottom: 16,
    padding: 16,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 8,
  },
  navItem: {
    alignItems: 'center',
    width: '45%',
    backgroundColor: '#F5F7FA',
    padding: 16,
    borderRadius: 8,
  },
  label: {
    marginTop: 8,
    fontSize: 12,
  },
});