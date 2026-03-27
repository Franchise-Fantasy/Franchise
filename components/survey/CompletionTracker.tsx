import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useSurveyCompletionTracker } from '@/hooks/chat/useSurveys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

interface Props {
  surveyId: string;
  leagueId: string;
}

export function CompletionTracker({ surveyId, leagueId }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: teams, isLoading } = useSurveyCompletionTracker(surveyId, leagueId);

  if (isLoading) {
    return <ActivityIndicator style={styles.loader} color={c.accent} />;
  }

  const submitted = teams?.filter((t) => t.submitted).length ?? 0;
  const total = teams?.length ?? 0;

  return (
    <View accessibilityLabel={`${submitted} of ${total} teams have submitted`}>
      <View style={styles.summaryRow}>
        <ThemedText style={[styles.summaryText, { color: c.text }]}>
          {submitted} of {total} submitted
        </ThemedText>
      </View>

      <View style={styles.list}>
        {teams?.map((team) => (
          <View
            key={team.team_id}
            style={[styles.teamRow, { borderColor: c.border }]}
            accessibilityLabel={`${team.team_name}: ${team.submitted ? 'submitted' : 'not submitted'}`}
          >
            <Ionicons
              name={team.submitted ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={team.submitted ? c.accent : c.secondaryText}
              accessible={false}
            />
            <ThemedText style={[styles.teamName, { color: c.text }]}>
              {team.team_name}
            </ThemedText>
            {team.submitted && team.submitted_at && (
              <ThemedText style={[styles.timestamp, { color: c.secondaryText }]}>
                {new Date(team.submitted_at).toLocaleDateString()}
              </ThemedText>
            )}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loader: { marginTop: 20 },
  summaryRow: {
    marginBottom: 12,
  },
  summaryText: {
    fontSize: 15,
    fontWeight: '600',
  },
  list: { gap: 4 },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamName: {
    fontSize: 14,
    flex: 1,
  },
  timestamp: {
    fontSize: 11,
  },
});
