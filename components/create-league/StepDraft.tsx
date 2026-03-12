import { LotteryOddsEditor } from '@/components/create-league/LotteryOddsEditor';
import { ToggleRow } from '@/components/ToggleRow';
import { ThemedText } from '@/components/ThemedText';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { DRAFT_TYPE_OPTIONS, LeagueWizardState, ROOKIE_DRAFT_ORDER_OPTIONS, TIME_PER_PICK_OPTIONS } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/lottery';
import { StyleSheet, View } from 'react-native';

interface StepDraftProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
}

export function StepDraft({ state, onChange }: StepDraftProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const timeLabels = TIME_PER_PICK_OPTIONS.map((t) => `${t}s`);
  const isDynasty = (state.leagueType ?? 'Dynasty') === 'Dynasty';

  const lotteryTeams = calcLotteryPoolSize(state.teams, state.playoffTeams);
  const effectiveOdds = state.lotteryOdds ?? generateDefaultOdds(lotteryTeams);

  return (
    <View style={styles.container}>
      <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Draft Settings</ThemedText>

      <View style={styles.section}>
        <ThemedText style={styles.label}>Draft Type</ThemedText>
        <SegmentedControl
          options={DRAFT_TYPE_OPTIONS}
          selectedIndex={DRAFT_TYPE_OPTIONS.indexOf(state.draftType)}
          onSelect={(i) => onChange('draftType', DRAFT_TYPE_OPTIONS[i])}
        />
      </View>

      <View style={styles.section}>
        <ThemedText style={styles.label}>Time Per Pick</ThemedText>
        <SegmentedControl
          options={timeLabels}
          selectedIndex={TIME_PER_PICK_OPTIONS.indexOf(state.timePerPick)}
          onSelect={(i) => onChange('timePerPick', TIME_PER_PICK_OPTIONS[i])}
        />
      </View>

      {isDynasty && (
        <>
          <View style={styles.section}>
            <NumberStepper
              label="Max Future Draft Years"
              value={state.maxDraftYears}
              onValueChange={(v) => onChange('maxDraftYears', v)}
              min={1}
              max={10}
            />
          </View>

          <View style={styles.section}>
            <ToggleRow
              icon="swap-horizontal-outline"
              label="Initial Draft, Pick Trading"
              description="Allow trading of startup draft picks before and during the draft"
              value={state.draftPickTradingEnabled}
              onToggle={(v) => onChange('draftPickTradingEnabled', v)}
              c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
            />
          </View>

          <ThemedText accessibilityRole="header" type="subtitle" style={styles.heading}>Rookie Draft</ThemedText>

          <View style={styles.section}>
            <NumberStepper
              label="Rounds"
              value={state.rookieDraftRounds}
              onValueChange={(v) => onChange('rookieDraftRounds', v)}
              min={1}
              max={5}
            />
          </View>

          <View style={styles.section}>
            <ThemedText style={styles.label}>Draft Order</ThemedText>
            <SegmentedControl
              options={ROOKIE_DRAFT_ORDER_OPTIONS}
              selectedIndex={ROOKIE_DRAFT_ORDER_OPTIONS.indexOf(state.rookieDraftOrder)}
              onSelect={(i) => onChange('rookieDraftOrder', ROOKIE_DRAFT_ORDER_OPTIONS[i])}
            />
          </View>

          {state.rookieDraftOrder === 'Lottery' && (
            <>
              {lotteryTeams <= 0 ? (
                <View style={[styles.warningBox, { backgroundColor: '#fee2e2', borderColor: '#ef4444' }]}>
                  <ThemedText style={[styles.warningText, { color: '#b91c1c' }]}>
                    All teams make the playoffs — no lottery pool. Adjust playoff teams in Season settings.
                  </ThemedText>
                </View>
              ) : (
                <>
                  <ThemedText style={[styles.hint, { color: c.secondaryText }]}>
                    {lotteryTeams} non-playoff team{lotteryTeams !== 1 ? 's' : ''} enter the lottery.
                    The top {Math.min(state.lotteryDraws, lotteryTeams)} pick{Math.min(state.lotteryDraws, lotteryTeams) !== 1 ? 's are' : ' is'} drawn
                    randomly; the rest slot in by reverse record.
                  </ThemedText>

                  <View style={styles.section}>
                    <NumberStepper
                      label="Lottery Draws"
                      value={state.lotteryDraws}
                      onValueChange={(v) => onChange('lotteryDraws', v)}
                      min={1}
                      max={lotteryTeams}
                    />
                  </View>

                  <View style={styles.section}>
                    <LotteryOddsEditor
                      odds={effectiveOdds}
                      onChange={(odds) => onChange('lotteryOdds', odds)}
                      lotteryTeams={lotteryTeams}
                    />
                  </View>
                </>
              )}
            </>
          )}
        </>
      )}
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
    fontWeight: '500',
  },
  section: {
    marginBottom: 20,
  },
  hint: {
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    marginBottom: 20,
  },
  warningText: {
    fontSize: 13,
  },
});
