  import { ThemedText } from '@/components/ThemedText';
import { ThemedView } from '@/components/ThemedView';

export default function MatchupScreen() {
return (
    <ThemedView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <ThemedText type="title">Matchup</ThemedText>
      <ThemedText>The season has not started yet.</ThemedText>
    </ThemedView>
  );
}