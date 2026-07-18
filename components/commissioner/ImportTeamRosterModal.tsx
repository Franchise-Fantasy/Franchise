import { useCallback, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { buildRosterPlayers } from '@/components/import/screenshot/buildRosterPlayers';
import { ScreenshotCapture } from '@/components/import/ScreenshotCapture';
import { TeamRosterReview } from '@/components/import/TeamRosterReview';
import type { ResolvedRosterPlayer } from '@/components/import/TeamRosterReview';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import type { Sport } from '@/constants/LeagueDefaults';
import { useToast } from '@/context/ToastProvider';
import type { ImageData, ScreenshotPlayerMatch, ScreenshotUnmatched } from '@/hooks/useImportScreenshot';
import { useExtractRoster, useImportTeamRoster } from '@/hooks/useImportScreenshot';
import { s } from '@/utils/scale';

interface ImportTeamRosterModalProps {
  visible: boolean;
  onClose: () => void;
  leagueId: string;
  teamId: string;
  teamName: string;
  /** Sport of the league — scopes player matching/search to it. */
  sport: Sport;
  /** Called after a successful import so the caller can refetch team/league data. */
  onImported: () => void;
}

type Override = { player_id: string; name: string; position: string };

export function ImportTeamRosterModal({
  visible,
  onClose,
  leagueId,
  teamId,
  teamName,
  sport,
  onImported,
}: ImportTeamRosterModalProps) {
  const { showToast } = useToast();
  const extractRosterMutation = useExtractRoster();
  const importMutation = useImportTeamRoster();

  const [images, setImages] = useState<ImageData[]>([]);
  const [extracted, setExtracted] = useState(false);
  const [matched, setMatched] = useState<ScreenshotPlayerMatch[]>([]);
  const [unmatched, setUnmatched] = useState<ScreenshotUnmatched[]>([]);
  const [resolvedMappings, setResolvedMappings] = useState<Map<number, Override>>(new Map());
  const [skippedPlayers, setSkippedPlayers] = useState<Set<number>>(new Set());

  const resetState = useCallback(() => {
    setImages([]);
    setExtracted(false);
    setMatched([]);
    setUnmatched([]);
    setResolvedMappings(new Map());
    setSkippedPlayers(new Set());
  }, []);

  const handleClose = useCallback(() => {
    resetState();
    onClose();
  }, [resetState, onClose]);

  const handleExtract = useCallback(() => {
    extractRosterMutation.mutate(
      { images, team_name: teamName, sport },
      {
        onSuccess: (result) => {
          setMatched(result.matched);
          setUnmatched(result.unmatched);
          setExtracted(true);
        },
        onError: (err) => Alert.alert('Extraction failed', err.message ?? 'Could not extract roster from screenshots.'),
      },
    );
  }, [extractRosterMutation, images, teamName, sport]);

  const handleResolve = useCallback((index: number, playerId: string, name: string, position: string) => {
    setResolvedMappings((prev) => {
      const next = new Map(prev);
      next.set(index, { player_id: playerId, name, position });
      return next;
    });
  }, []);

  const handleSkip = useCallback((index: number) => {
    setSkippedPlayers((prev) => new Set(prev).add(index));
  }, []);

  const unresolvedCount = unmatched.filter(
    (p) => !resolvedMappings.has(p.index) && !skippedPlayers.has(p.index),
  ).length;

  const matchedIndices = new Set(matched.map((m) => m.index));
  const resolvedPlayers: ResolvedRosterPlayer[] = Array.from(resolvedMappings.entries())
    .filter(([index]) => !matchedIndices.has(index))
    .map(([index, r]) => {
      const original = unmatched.find((u) => u.index === index);
      return {
        index,
        extracted_name: original?.extracted_name ?? r.name,
        matched_name: r.name,
        position: r.position,
        roster_slot: original?.roster_slot ?? null,
      };
    });

  const handleImport = useCallback(() => {
    const players = buildRosterPlayers(matched, unmatched, resolvedMappings);

    if (players.length === 0) {
      Alert.alert('No players', 'At least one player must be matched to import this roster.');
      return;
    }

    importMutation.mutate(
      { league_id: leagueId, team_id: teamId, players },
      {
        onSuccess: (result) => {
          showToast('success', result.message);
          onImported();
          handleClose();
        },
        onError: (err) => Alert.alert('Import failed', err.message ?? 'Could not import roster.'),
      },
    );
  }, [matched, resolvedMappings, unmatched, importMutation, leagueId, teamId, showToast, onImported, handleClose]);

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={`Import Roster — ${teamName}`}
      keyboardAvoiding
      footer={
        extracted ? (
          <BrandButton
            label="Import Roster"
            variant="primary"
            size="large"
            fullWidth
            onPress={handleImport}
            loading={importMutation.isPending}
            disabled={unresolvedCount > 0}
            accessibilityLabel={`Import roster for ${teamName}`}
          />
        ) : undefined
      }
    >
      <View style={styles.container}>
        <ScreenshotCapture
          images={images}
          onImagesChange={setImages}
          maxImages={5}
          label="Roster Screenshots"
        />

        {images.length > 0 && !extracted && (
          <BrandButton
            label="Extract Roster"
            variant="primary"
            size="default"
            fullWidth
            onPress={handleExtract}
            loading={extractRosterMutation.isPending}
            accessibilityLabel="Extract roster from screenshots"
          />
        )}

        {extracted && (
          <TeamRosterReview
            teamName={teamName}
            matched={matched}
            unmatched={unmatched.filter(
              (p) => !resolvedMappings.has(p.index) && !skippedPlayers.has(p.index),
            )}
            resolved={resolvedPlayers}
            resolvedCount={resolvedPlayers.length}
            skippedCount={skippedPlayers.size}
            overrides={resolvedMappings}
            sport={sport}
            onResolve={handleResolve}
            onSkip={handleSkip}
          />
        )}

        {extracted && (
          <View style={styles.recaptureWrap}>
            <BrandButton
              label="Re-capture Screenshots"
              variant="ghost"
              size="small"
              onPress={resetState}
              accessibilityLabel="Re-capture this team's roster"
            />
          </View>
        )}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: s(16),
  },
  recaptureWrap: {
    alignItems: 'center',
  },
});
