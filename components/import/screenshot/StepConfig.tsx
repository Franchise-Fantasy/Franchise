import { StepDraft } from '@/components/create-league/StepDraft';
import { StepSeason } from '@/components/create-league/StepSeason';
import { StepTrade } from '@/components/create-league/StepTrade';
import { StepWaivers } from '@/components/create-league/StepWaivers';
import { type LeagueWizardState } from '@/constants/LeagueDefaults';
import { StyleSheet, View } from 'react-native';

interface StepConfigProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

/**
 * Remaining wizard settings — delegates to the same Trade / Waivers /
 * Season / Draft components create-league uses, so the feel is
 * identical. Roster + Scoring are handled earlier inside the Settings
 * step (since those are the two Sleeper/screenshots can actually
 * extract from the uploaded images).
 */
export function StepConfig({ state, onChange }: StepConfigProps) {
  return (
    <View style={styles.container}>
      <StepTrade state={state} onChange={onChange} />
      <StepWaivers state={state} onChange={onChange} />
      <StepSeason state={state} onChange={onChange} />
      <StepDraft state={state} onChange={onChange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
