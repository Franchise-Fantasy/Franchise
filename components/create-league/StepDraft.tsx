import { StyleSheet, View } from 'react-native';

import { LotteryOddsEditor } from '@/components/create-league/LotteryOddsEditor';
import { FieldGroup } from '@/components/ui/FieldGroup';
import { FormSection } from '@/components/ui/FormSection';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { ThemedText } from '@/components/ui/ThemedText';
import { ToggleRow } from '@/components/ui/ToggleRow';
import { Colors } from '@/constants/Colors';
import {
  DRAFT_TYPE_OPTIONS,
  getMaxRookieDraftRounds,
  INITIAL_DRAFT_ORDER_OPTIONS,
  LeagueWizardState,
  ROOKIE_DRAFT_ORDER_OPTIONS,
  TIME_PER_PICK_MAX,
  TIME_PER_PICK_MIN,
  TIME_PER_PICK_STEP,
} from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { calcLotteryPoolSize, generateDefaultOdds } from '@/utils/league/lottery';
import { ROSTER_SLOT } from '@/utils/roster/rosterSlotsShared';
import { ms, s } from '@/utils/scale';

interface StepDraftProps {
  state: LeagueWizardState;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
  /**
   * Hide the "Startup Draft" section. Imported leagues already have rosters —
   * no startup draft ever runs — so only the Rookie Draft settings apply.
   */
  hideStartupDraft?: boolean;
}

export function StepDraft({ state, onChange, hideStartupDraft }: StepDraftProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const isDynasty = (state.leagueType ?? 'Dynasty') === 'Dynasty';

  const lotteryTeams = calcLotteryPoolSize(state.teams, state.playoffTeams);
  const effectiveOdds = state.lotteryOdds ?? generateDefaultOdds(lotteryTeams);
  const maxRookieRounds = getMaxRookieDraftRounds(state.sport, state.teams);

  // Startup draft rounds = active roster slots (mirrors `rosterSize` in
  // create-league). IR/Taxi don't get drafted into, so they don't add rounds.
  const totalRounds = state.rosterSlots.reduce(
    (sum, slot) =>
      slot.position === 'IR' || slot.position === ROSTER_SLOT.TAXI ? sum : sum + slot.count,
    0,
  );
  const accelEnabled = state.accelerateAfterRound != null;
  const acceleratedTime = state.acceleratedTimePerPick ?? 30;

  return (
    <View style={styles.container}>
      {!hideStartupDraft && (
      <FormSection title="Startup Draft">
        <FieldGroup label="Draft Type">
          <SegmentedControl
            options={DRAFT_TYPE_OPTIONS}
            selectedIndex={DRAFT_TYPE_OPTIONS.indexOf(state.draftType)}
            onSelect={(i) => onChange('draftType', DRAFT_TYPE_OPTIONS[i])}
          />
        </FieldGroup>

        <NumberStepper
          label="Time Per Pick"
          value={state.timePerPick}
          onValueChange={(v) => onChange('timePerPick', v)}
          min={TIME_PER_PICK_MIN}
          max={TIME_PER_PICK_MAX}
          step={TIME_PER_PICK_STEP}
          suffix="s"
        />

        {totalRounds > 1 && (
          <>
            <ToggleRow
              icon="flash-outline"
              label="Speed Up Later Rounds"
              description={
                accelEnabled
                  ? `Rounds after ${Math.min(state.accelerateAfterRound ?? 1, totalRounds - 1)} drop to ${acceleratedTime}s per pick — like a real draft tightening the clock late.`
                  : 'Tighten the pick clock for the back half of the draft.'
              }
              value={accelEnabled}
              onToggle={(on) =>
                onChange('accelerateAfterRound', on ? Math.min(5, totalRounds - 1) : null)
              }
              c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
            />

            {accelEnabled && (
              <>
                <NumberStepper
                  label="Speed Up After Round"
                  value={Math.min(state.accelerateAfterRound ?? 1, totalRounds - 1)}
                  onValueChange={(v) => onChange('accelerateAfterRound', v)}
                  min={1}
                  max={totalRounds - 1}
                  helperText={`Picks in rounds 1–${Math.min(state.accelerateAfterRound ?? 1, totalRounds - 1)} use ${state.timePerPick}s; later rounds use the faster clock below.`}
                />
                <NumberStepper
                  label="Faster Pick Time"
                  value={Math.min(acceleratedTime, state.timePerPick)}
                  onValueChange={(v) => onChange('acceleratedTimePerPick', v)}
                  min={TIME_PER_PICK_MIN}
                  max={state.timePerPick}
                  step={TIME_PER_PICK_STEP}
                  suffix="s"
                />
              </>
            )}
          </>
        )}

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
            description={
              state.draftPickTradingEnabled
                ? 'Trade startup draft picks before and during the draft. In-draft trades execute immediately on acceptance — no review period, no vetoes.'
                : 'Trade startup draft picks before and during the draft'
            }
            value={state.draftPickTradingEnabled}
            onToggle={(v) => onChange('draftPickTradingEnabled', v)}
            c={{ border: c.border, accent: c.accent, secondaryText: c.secondaryText }}
            last
          />
        )}
      </FormSection>
      )}

      {isDynasty && (
        <FormSection title="Rookie Draft">
          <NumberStepper
            label="Rounds"
            value={state.rookieDraftRounds}
            onValueChange={(v) => onChange('rookieDraftRounds', v)}
            min={1}
            max={maxRookieRounds}
            helperText={`Max ${maxRookieRounds} round${maxRookieRounds === 1 ? '' : 's'} for ${state.teams} teams — keeps total picks within the realistic rookie pool.`}
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
