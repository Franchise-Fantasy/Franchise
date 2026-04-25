import { StyleSheet, View } from 'react-native';

import { LotteryOddsEditor } from '@/components/create-league/LotteryOddsEditor';
import { ToggleRow } from '@/components/ToggleRow';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import {
  DRAFT_TYPE_OPTIONS,
  INITIAL_DRAFT_ORDER_OPTIONS,
  LeagueWizardState,
  ROOKIE_DRAFT_ORDER_OPTIONS,
  TIME_PER_PICK_OPTIONS,
} from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/lottery';
import { ms, s } from '@/utils/scale';

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
      <FormSection title="Startup Draft">
        <FieldGroup label="Draft Type">
          <SegmentedControl
            options={DRAFT_TYPE_OPTIONS}
            selectedIndex={DRAFT_TYPE_OPTIONS.indexOf(state.draftType)}
            onSelect={(i) => onChange('draftType', DRAFT_TYPE_OPTIONS[i])}
          />
        </FieldGroup>

        <FieldGroup label="Time Per Pick">
          <SegmentedControl
            options={timeLabels}
            selectedIndex={TIME_PER_PICK_OPTIONS.indexOf(state.timePerPick)}
            onSelect={(i) => onChange('timePerPick', TIME_PER_PICK_OPTIONS[i])}
          />
        </FieldGroup>

        <FieldGroup
          label="Draft Order"
          helperText={
            state.initialDraftOrder === 'Random'
              ? 'Teams are randomly assigned a draft position when all teams join.'
              : 'The commissioner will set the draft order before the draft begins.'
          }
        >
          <SegmentedControl
            options={[...INITIAL_DRAFT_ORDER_OPTIONS]}
            selectedIndex={INITIAL_DRAFT_ORDER_OPTIONS.indexOf(state.initialDraftOrder)}
            onSelect={(i) => onChange('initialDraftOrder', INITIAL_DRAFT_ORDER_OPTIONS[i])}
          />
        </FieldGroup>

        {isDynasty && (
          <ToggleRow
            icon="swap-horizontal-outline"
            label="Allow Pick Trading"
            description="Trade startup draft picks before and during the draft"
            value={state.draftPickTradingEnabled}
            onToggle={(v) => onChange('draftPickTradingEnabled', v)}
            c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
            last
          />
        )}
      </FormSection>

      {isDynasty && (
        <FormSection title="Rookie Draft">
          <NumberStepper
            label="Rounds"
            value={state.rookieDraftRounds}
            onValueChange={(v) => onChange('rookieDraftRounds', v)}
            min={1}
            max={5}
          />

          <FieldGroup label="Draft Order">
            <SegmentedControl
              options={ROOKIE_DRAFT_ORDER_OPTIONS}
              selectedIndex={ROOKIE_DRAFT_ORDER_OPTIONS.indexOf(state.rookieDraftOrder)}
              onSelect={(i) => onChange('rookieDraftOrder', ROOKIE_DRAFT_ORDER_OPTIONS[i])}
            />
          </FieldGroup>

          {state.rookieDraftOrder === 'Lottery' && (
            <>
              {lotteryTeams <= 0 ? (
                <View style={[styles.warningBox, { backgroundColor: c.dangerMuted, borderColor: c.danger }]}>
                  <ThemedText style={[styles.warningText, { color: c.danger }]}>
                    All teams make the playoffs — no lottery pool. Adjust playoff teams in Season settings.
                  </ThemedText>
                </View>
              ) : (
                <>
                  <NumberStepper
                    label="Lottery Draws"
                    value={state.lotteryDraws}
                    onValueChange={(v) => onChange('lotteryDraws', v)}
                    min={1}
                    max={lotteryTeams}
                    helperText={`${lotteryTeams} non-playoff team${lotteryTeams !== 1 ? 's' : ''} enter the lottery. The top ${Math.min(state.lotteryDraws, lotteryTeams)} pick${Math.min(state.lotteryDraws, lotteryTeams) !== 1 ? 's are' : ' is'} drawn randomly; the rest slot in by reverse record.`}
                    last
                  />

                  <LotteryOddsEditor
                    odds={effectiveOdds}
                    onChange={(odds) => onChange('lotteryOdds', odds)}
                    lotteryTeams={lotteryTeams}
                  />
                </>
              )}
            </>
          )}
        </FormSection>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  warningBox: {
    borderWidth: 1,
    borderRadius: 8,
    padding: s(12),
  },
  warningText: {
    fontSize: ms(13),
    lineHeight: ms(18),
  },
});
