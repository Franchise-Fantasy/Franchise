import type { UseMutationResult } from '@tanstack/react-query';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { ScreenshotCapture } from '@/components/import/ScreenshotCapture';
import { TeamRosterReview } from '@/components/import/TeamRosterReview';
import { BrandButton } from '@/components/ui/BrandButton';
import { FormSection } from '@/components/ui/FormSection';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { ms, s } from '@/utils/scale';

import type { Action, TeamRosterData } from './state';

interface StepRostersProps {
  teams: TeamRosterData[];
  currentTeamIndex: number;
  dispatch: React.Dispatch<Action>;
  onExtractRoster: () => void;
  onResolvePlayer: (index: number, playerId: string, name: string, position: string) => void;
  onSkipPlayer: (index: number) => void;
  extractRosterMutation: UseMutationResult<unknown, unknown, unknown, unknown>;
  scrollToTop: () => void;
}

export function StepRosters({
  teams,
  currentTeamIndex,
  dispatch,
  onExtractRoster,
  onResolvePlayer,
  onSkipPlayer,
  extractRosterMutation,
  scrollToTop,
}: StepRostersProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];

  const currentTeam = teams[currentTeamIndex];
  if (!currentTeam) return null;

  const unresolvedCount = currentTeam.unmatched.filter(
    (p) => !currentTeam.resolvedMappings.has(p.index) && !currentTeam.skippedPlayers.has(p.index),
  ).length;

  // Players the user manually matched via search/"Add Player". They leave
  // the Unmatched list once resolved, so surface them in the team summary
  // alongside the auto-matched players instead of letting them disappear.
  // Corrections of an auto-match (keyed by a matched player's index) are
  // excluded here — they render in-place on the matched row, not as a
  // separate resolved row.
  const matchedIndices = new Set(currentTeam.matched.map((m) => m.index));
  const resolvedPlayers = Array.from(currentTeam.resolvedMappings.entries())
    .filter(([index]) => !matchedIndices.has(index))
    .map(([index, r]) => {
      const original = currentTeam.unmatched.find((u) => u.index === index);
      return {
        index,
        extracted_name: original?.extracted_name ?? r.name,
        matched_name: r.name,
        position: r.position,
        roster_slot: original?.roster_slot ?? null,
      };
    });

  return (
    <View style={styles.container}>
      <FormSection title={`Team ${currentTeamIndex + 1} of ${teams.length}`}>
        {/* Team progress pips — tappable to jump between teams */}
        <View style={styles.pipRow}>
          {teams.map((t, i) => (
            <TouchableOpacity
              key={i}
              onPress={() => dispatch({ type: 'SET_CURRENT_TEAM', index: i })}
              style={[
                styles.pip,
                {
                  backgroundColor: t.extracted
                    ? c.success
                    : i === currentTeamIndex
                      ? Brand.vintageGold
                      : 'transparent',
                  borderColor: t.extracted
                    ? c.success
                    : i === currentTeamIndex
                      ? Brand.vintageGold
                      : c.border,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`Team ${i + 1}${t.extracted ? ', completed' : ''}`}
            />
          ))}
        </View>

        {/* Read-only: team names are set up front on the Teams step so the
            traded-pick / lottery / history references that key on them stay
            stable. Go back to the Teams step to rename. */}
        <View style={styles.teamNameRow}>
          <ThemedText
            type="varsitySmall"
            style={[styles.teamNameLabel, { color: c.secondaryText }]}
            accessibilityRole="header"
          >
            Team Name
          </ThemedText>
          <ThemedText
            type="defaultSemiBold"
            style={[styles.teamNameValue, { color: c.text }]}
            numberOfLines={1}
            accessibilityLabel={`Team name: ${currentTeam.team_name}. Rename on the Teams step.`}
          >
            {currentTeam.team_name}
          </ThemedText>
        </View>

        <ScreenshotCapture
          images={currentTeam.images}
          onImagesChange={(imgs) =>
            dispatch({ type: 'SET_TEAM_IMAGES', teamIndex: currentTeamIndex, images: imgs })
          }
          maxImages={5}
          label="Roster Screenshots"
        />

        {currentTeam.images.length > 0 && !currentTeam.extracted && (
          <BrandButton
            label="Extract Roster"
            variant="primary"
            size="default"
            fullWidth
            onPress={onExtractRoster}
            loading={extractRosterMutation.isPending}
            accessibilityLabel="Extract roster from screenshots"
          />
        )}
      </FormSection>

      {currentTeam.extracted && (
        <TeamRosterReview
          teamName={currentTeam.team_name}
          matched={currentTeam.matched}
          unmatched={currentTeam.unmatched.filter(
            (p) => !currentTeam.resolvedMappings.has(p.index) && !currentTeam.skippedPlayers.has(p.index),
          )}
          resolved={resolvedPlayers}
          resolvedCount={resolvedPlayers.length}
          skippedCount={currentTeam.skippedPlayers.size}
          overrides={currentTeam.resolvedMappings}
          onResolve={onResolvePlayer}
          onSkip={onSkipPlayer}
        />
      )}

      {currentTeam.extracted && (
        <View style={styles.recaptureWrap}>
          <BrandButton
            label="Re-capture Screenshots"
            variant="ghost"
            size="small"
            onPress={() =>
              dispatch({ type: 'SET_TEAM_IMAGES', teamIndex: currentTeamIndex, images: [] })
            }
            accessibilityLabel="Re-capture this team's roster"
          />
        </View>
      )}

      {/* Per-team navigation. Next Team requires current team to be
          extracted + all unmatched either resolved or skipped. */}
      <View style={styles.teamNavRow}>
        {currentTeamIndex > 0 ? (
          <BrandButton
            label="Prev Team"
            variant="secondary"
            size="small"
            icon="chevron-back"
            onPress={() => {
              dispatch({ type: 'SET_CURRENT_TEAM', index: currentTeamIndex - 1 });
              scrollToTop();
            }}
            accessibilityLabel="Previous team"
          />
        ) : (
          <View />
        )}
        {currentTeamIndex < teams.length - 1 &&
        currentTeam.extracted &&
        unresolvedCount === 0 ? (
          <BrandButton
            label="Next Team"
            variant="primary"
            size="small"
            onPress={() => {
              dispatch({ type: 'SET_CURRENT_TEAM', index: currentTeamIndex + 1 });
              scrollToTop();
            }}
            accessibilityLabel="Next team"
          />
        ) : (
          <View />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Team progress dots — same visual as the StepIndicator pip
  // language but tappable to jump.
  pipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(5),
    alignSelf: 'center',
    paddingVertical: s(2),
  },
  pip: {
    width: s(8),
    height: s(8),
    borderRadius: s(4),
    borderWidth: 1,
  },
  teamNameRow: {
    gap: s(3),
  },
  teamNameLabel: {
    fontSize: ms(10),
    letterSpacing: 0.9,
  },
  teamNameValue: {
    fontSize: ms(16),
  },
  recaptureWrap: {
    alignItems: 'center',
  },
  teamNavRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: s(4),
  },
});
