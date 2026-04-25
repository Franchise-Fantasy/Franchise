import { StyleSheet, View } from "react-native";

import { AnimatedSection } from "@/components/ui/AnimatedSection";
import { BrandTextInput } from "@/components/ui/BrandTextInput";
import { FieldGroup } from "@/components/ui/FieldGroup";
import { FormSection } from "@/components/ui/FormSection";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import {
  LEAGUE_TYPE_OPTIONS,
  LeagueWizardState,
  SPORT_OPTIONS,
  SPORT_DISPLAY,
  SPORT_TO_DB,
} from "@/constants/LeagueDefaults";
import { s } from "@/utils/scale";

interface StepBasicsProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepBasics({ state, onChange }: StepBasicsProps) {
  return (
    <View style={styles.container}>
      {/* Required fields first */}
      <FormSection title="League Identity">
        <BrandTextInput
          label="League Name"
          placeholder="Enter league name"
          value={state.name}
          onChangeText={(text) => onChange("name", text)}
          accessibilityLabel="League name"
        />

        <FieldGroup label="Sport">
          <SegmentedControl
            options={[...SPORT_OPTIONS]}
            selectedIndex={[...SPORT_OPTIONS as readonly string[]].indexOf(SPORT_DISPLAY[state.sport])}
            onSelect={(i) => onChange("sport", SPORT_TO_DB[SPORT_OPTIONS[i]])}
            accessibilityLabel="Select sport"
          />
        </FieldGroup>

        <FieldGroup label="League Type">
          <SegmentedControl
            options={[...LEAGUE_TYPE_OPTIONS]}
            selectedIndex={LEAGUE_TYPE_OPTIONS.indexOf(state.leagueType ?? 'Dynasty')}
            onSelect={(i) => onChange("leagueType", LEAGUE_TYPE_OPTIONS[i])}
            accessibilityLabel="Select league type"
          />
        </FieldGroup>

        <AnimatedSection visible={state.leagueType === 'Keeper'}>
          <NumberStepper
            label="Keepers Per Team"
            value={state.keeperCount ?? 5}
            onValueChange={(v) => onChange("keeperCount", v)}
            min={1}
            max={20}
            last
          />
        </AnimatedSection>
      </FormSection>

      {/* League structure */}
      <FormSection title="League Setup">
        <NumberStepper
          label="Number of Teams"
          value={state.teams}
          onValueChange={(v) => onChange("teams", v)}
          min={1}
          max={20}
        />

        <FieldGroup label="League Visibility">
          <SegmentedControl
            options={["Public", "Private"]}
            selectedIndex={state.isPrivate ? 1 : 0}
            onSelect={(i) => onChange("isPrivate", i === 1)}
          />
        </FieldGroup>
      </FormSection>

      {/* Optional buy-in */}
      <FormSection title="Buy-In">
        <NumberStepper
          label="Buy-In ($)"
          value={state.buyIn}
          onValueChange={(v) => onChange("buyIn", v)}
          min={0}
          max={1000}
          step={5}
        />

        <AnimatedSection visible={state.buyIn > 0}>
          <View style={styles.paymentGroup}>
            <BrandTextInput
              label="Venmo"
              placeholder="username (no @)"
              value={state.venmoUsername}
              onChangeText={(text) => onChange("venmoUsername", text)}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Venmo username"
            />

            <BrandTextInput
              label="Cash App"
              placeholder="cashtag (no $)"
              value={state.cashappTag}
              onChangeText={(text) => onChange("cashappTag", text)}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Cash App tag"
            />

            <BrandTextInput
              label="PayPal"
              placeholder="username"
              value={state.paypalUsername}
              onChangeText={(text) => onChange("paypalUsername", text)}
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="PayPal username"
            />
          </View>
        </AnimatedSection>
      </FormSection>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Payment fields sit inside an AnimatedSection which is a single
  // direct child of the FormSection — so FormSection's gap can't space
  // them. The inner wrapper gets its own gap.
  paymentGroup: {
    gap: s(10),
  },
});
