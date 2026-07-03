import { StyleSheet, View } from 'react-native';

import { BrandTextInput } from '@/components/ui/BrandTextInput';
import { FormSection } from '@/components/ui/FormSection';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import type { Action, TeamRosterData } from './state';

interface StepTeamsProps {
  teams: TeamRosterData[];
  dispatch: React.Dispatch<Action>;
}

/**
 * Name every team up front, before the league-config and roster steps.
 * Names are the stable identity that traded picks, lottery order, and
 * historical standings all reference, so locking them here keeps those
 * references intact no matter what order the rest of the import is done in.
 * Change the team count back on the Basics step.
 */
export function StepTeams({ teams, dispatch }: StepTeamsProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <FormSection title={`Name Your Teams (${teams.length})`}>
        <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
          Set each team&apos;s name now. You can capture their rosters later — even
          after the league is created.
        </ThemedText>
        {teams.map((team, index) => (
          <BrandTextInput
            key={index}
            label={`Team ${index + 1}`}
            value={team.team_name}
            onChangeText={(name) => dispatch({ type: 'SET_TEAM_NAME', teamIndex: index, name })}
            placeholder={`Team ${index + 1}`}
            accessibilityLabel={`Team ${index + 1} name`}
          />
        ))}
      </FormSection>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hint: {
    fontSize: ms(12),
    lineHeight: ms(17),
    marginBottom: s(4),
  },
});
