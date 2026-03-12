import { ThemedText } from "@/components/ThemedText";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { Colors } from "@/constants/Colors";
import { LEAGUE_TYPE_OPTIONS, LeagueWizardState } from "@/constants/LeagueDefaults";
import { useColorScheme } from "@/hooks/useColorScheme";
import { StyleSheet, TextInput, View } from "react-native";

interface StepBasicsProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepBasics({ state, onChange }: StepBasicsProps) {
  const scheme = useColorScheme() ?? "light";
  const c = Colors[scheme];

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>
        League Basics
      </ThemedText>

      <View style={styles.section}>
        <ThemedText style={styles.label}>League Type</ThemedText>
        <SegmentedControl
          options={[...LEAGUE_TYPE_OPTIONS]}
          selectedIndex={LEAGUE_TYPE_OPTIONS.indexOf(state.leagueType ?? 'Dynasty')}
          onSelect={(i) => onChange("leagueType", LEAGUE_TYPE_OPTIONS[i])}
          accessibilityLabel="Select league type"
        />
      </View>

      {state.leagueType === 'Keeper' && (
        <View style={styles.section}>
          <NumberStepper
            label="Keepers Per Team"
            value={state.keeperCount ?? 5}
            onValueChange={(v) => onChange("keeperCount", v)}
            min={1}
            max={20}
          />
        </View>
      )}

      <ThemedText style={styles.label}>League Name</ThemedText>
      <TextInput
        accessibilityLabel="League name"
        style={[
          styles.input,
          { borderColor: c.border, backgroundColor: c.input, color: c.text },
        ]}
        placeholder="Enter league name"
        placeholderTextColor={c.secondaryText}
        value={state.name}
        onChangeText={(text) => onChange("name", text)}
      />

      <View style={styles.section}>
        <NumberStepper
          label="Number of Teams"
          value={state.teams}
          onValueChange={(v) => onChange("teams", v)}
          min={1}
          max={20}
        />
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.label}>League Visibility</ThemedText>
        <SegmentedControl
          options={["Public", "Private"]}
          selectedIndex={state.isPrivate ? 1 : 0}
          onSelect={(i) => onChange("isPrivate", i === 1)}
        />
      </View>

      <View style={styles.section}>
        <NumberStepper
          label="Buy-In ($)"
          value={state.buyIn}
          onValueChange={(v) => onChange("buyIn", v)}
          min={0}
          max={1000}
          step={5}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heading: {
    marginBottom: 20,
  },
  label: {
    marginBottom: 8,
    fontSize: 14,
    fontWeight: "500",
  },
  input: {
    borderWidth: 1,
    padding: 12,
    borderRadius: 6,
    fontSize: 16,
    marginBottom: 16,
  },
  section: {
    marginTop: 8,
  },
});
