import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useSurveyCompletionTracker } from '@/hooks/chat/useSurveys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

interface Props {
  surveyId: string;
  leagueId: string;
}

export function CompletionTracker({ surveyId, leagueId }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data: teams, isLoading } = useSurveyCompletionTracker(surveyId, leagueId);

  if (isLoading) {
    return <View style={styles.loader}><LogoSpinner /></View>;
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
  loader: { marginTop: s(20) },
  summaryRow: {
    marginBottom: s(12),
  },
  summaryText: {
    fontSize: ms(15),
    fontWeight: '600',
  },
  list: { gap: s(4) },
  teamRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  teamName: {
    fontSize: ms(14),
    flex: 1,
  },
  timestamp: {
    fontSize: ms(11),
  },
});
