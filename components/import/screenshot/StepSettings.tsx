import { Ionicons } from '@expo/vector-icons';
import type { UseMutationResult } from '@tanstack/react-query';
import { StyleSheet, View } from 'react-native';

import { StepRoster } from '@/components/create-league/StepRoster';
import { StepScoring } from '@/components/create-league/StepScoring';
import { ScreenshotCapture } from '@/components/import/ScreenshotCapture';
import { ScreenshotSettingsReview } from '@/components/import/ScreenshotSettingsReview';
import { BrandButton } from '@/components/ui/BrandButton';
import { ListRow } from '@/components/ui/ListRow';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors } from '@/constants/Colors';
import { type LeagueWizardState } from '@/constants/LeagueDefaults';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import type { Action, ScreenshotImportState } from './state';

interface StepSettingsProps {
  state: ScreenshotImportState;
  dispatch: React.Dispatch<Action>;
  onChange: (field: keyof LeagueWizardState, value: any) => void;
  onExtractSettings: () => void;
  extractSettingsMutation: UseMutationResult<unknown, unknown, unknown, unknown>;
}

export function StepSettings({
  state,
  dispatch,
  onChange,
  onExtractSettings,
  extractSettingsMutation,
}: StepSettingsProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  if (state.settingsMode === 'choose') {
    return (
      <View style={styles.container}>
        <Section title="Settings" cardStyle={styles.modeCard}>
          <ModeRow
            icon="camera-outline"
            title="Screenshot Settings"
            description="Take a screenshot of your league's scoring or roster settings page. We'll extract what we can."
            onPress={() => dispatch({ type: 'SET_SETTINGS_MODE', mode: 'screenshot' })}
            index={0}
            total={2}
          />
          <ModeRow
            icon="settings-outline"
            title="Configure Manually"
            description="Set up roster positions and scoring values yourself."
            onPress={() => dispatch({ type: 'SET_SETTINGS_MODE', mode: 'manual' })}
            index={1}
            total={2}
          />
        </Section>
      </View>
    );
  }

  if (state.settingsMode === 'screenshot') {
    return (
      <View style={styles.container}>
        <Section title="Screenshot Extraction">
          <ThemedText style={[styles.desc, { color: c.secondaryText }]}>
            Upload a screenshot of your league settings (scoring, roster positions, etc.).
            We'll pull out what we can.
          </ThemedText>

          <ScreenshotCapture
            images={state.settingsImages}
            onImagesChange={(imgs) => dispatch({ type: 'SET_SETTINGS_IMAGES', images: imgs })}
            maxImages={3}
            label="Settings Screenshots"
          />

          {state.settingsImages.length > 0 && !state.settingsExtracted && (
            <BrandButton
              label="Extract Settings"
              variant="primary"
              size="default"
              fullWidth
              onPress={onExtractSettings}
              loading={extractSettingsMutation.isPending}
              accessibilityLabel="Extract settings from screenshots"
            />
          )}
        </Section>

        {state.settingsExtracted && (
          <ScreenshotSettingsReview
            extracted={state.settingsExtracted}
            onAcceptScoring={(scoring) => dispatch({ type: 'APPLY_EXTRACTED_SCORING', scoring })}
            onAcceptRosterPositions={(positions) =>
              dispatch({ type: 'APPLY_EXTRACTED_ROSTER_POSITIONS', positions })
            }
            onAcceptLeagueName={(name) => onChange('name', name)}
            onAcceptTeamCount={(count) => dispatch({ type: 'SET_TEAM_COUNT', count })}
          />
        )}

        <View style={styles.switchWrap}>
          <BrandButton
            label="Edit Manually Instead"
            variant="ghost"
            size="small"
            onPress={() => dispatch({ type: 'SET_SETTINGS_MODE', mode: 'manual' })}
            accessibilityLabel="Switch to manual configuration"
          />
        </View>
      </View>
    );
  }

  // Manual mode — reuses StepRoster + StepScoring from create-league.
  return (
    <View style={styles.container}>
      <StepRoster
        state={state.wizardState}
        onSlotChange={(i, count) => dispatch({ type: 'SET_ROSTER_SLOT', index: i, count })}
        onChange={onChange}
        onResetRoster={() => dispatch({ type: 'RESET_ROSTER' })}
      />
      <StepScoring
        state={state.wizardState}
        onScoringChange={(i, val) => dispatch({ type: 'SET_SCORING', index: i, value: val })}
        onResetScoring={() => dispatch({ type: 'RESET_SCORING' })}
        // scoringType + categories flow through the generic
        // SET_WIZARD_FIELD action — the screenshot reducer doesn't
        // have the dedicated SET_SCORING_TYPE / SET_CATEGORY_ENABLED
        // paths create-league uses.
        onScoringTypeChange={(type) => onChange('scoringType', type)}
        onCategoryToggle={(i, enabled) => {
          const cats = [...state.wizardState.categories];
          cats[i] = { ...cats[i], is_enabled: enabled };
          onChange('categories', cats);
        }}
        onResetCategories={() => dispatch({ type: 'RESET_CATEGORIES' })}
      />

      {state.settingsExtracted && (
        <View style={styles.switchWrap}>
          <BrandButton
            label="View Extracted Settings"
            variant="ghost"
            size="small"
            onPress={() => dispatch({ type: 'SET_SETTINGS_MODE', mode: 'screenshot' })}
            accessibilityLabel="Switch to screenshot extraction"
          />
        </View>
      )}
    </View>
  );
}

// ─── Mode row (choose screen) ───────────────────────────────────────

function ModeRow({
  icon,
  title,
  description,
  onPress,
  index,
  total,
}: {
  icon: keyof typeof import('@expo/vector-icons/build/Ionicons').default.glyphMap;
  title: string;
  description: string;
  onPress: () => void;
  index: number;
  total: number;
}) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  return (
    <ListRow
      index={index}
      total={total}
      onPress={onPress}
      accessibilityLabel={title}
      accessibilityHint="Tap to continue"
      style={styles.modeRow}
    >
      <View style={[styles.modeIcon, { backgroundColor: Brand.vintageGold + '22' }]}>
        <Ionicons name={icon} size={ms(22)} color={Brand.vintageGold} accessible={false} />
      </View>
      <View style={styles.modeBody}>
        <ThemedText type="sectionLabel" style={[styles.modeTitle, { color: c.text }]}>
          {title}
        </ThemedText>
        <ThemedText style={[styles.modeDesc, { color: c.secondaryText }]}>
          {description}
        </ThemedText>
      </View>
      <Ionicons name="chevron-forward" size={ms(16)} color={c.secondaryText} accessible={false} />
    </ListRow>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  desc: {
    fontSize: ms(12),
    lineHeight: ms(17),
  },

  // ─── Mode chooser ─────────────────────────────────────────
  modeCard: {
    paddingHorizontal: 0,
  },
  modeRow: {
    paddingVertical: s(14),
    gap: s(12),
    alignItems: 'center',
  },
  modeIcon: {
    width: s(44),
    height: s(44),
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBody: {
    flex: 1,
    gap: s(2),
  },
  modeTitle: {
    fontSize: ms(15),
  },
  modeDesc: {
    fontSize: ms(12),
    lineHeight: ms(17),
  },

  switchWrap: {
    alignItems: 'center',
  },
});
