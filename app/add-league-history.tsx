import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { HistorySeasonData } from '@/components/import/screenshot/state';
import { StepHistory } from '@/components/import/screenshot/StepHistory';
import { BrandButton } from '@/components/ui/BrandButton';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { CURRENT_NBA_SEASON, type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useSession } from '@/context/AuthProvider';
import { useToast } from '@/context/ToastProvider';
import { useColors } from '@/hooks/useColors';
import { useExtractHistory, type HistoryExtractionResult, type ImageData } from '@/hooks/useImportScreenshot';
import { supabase } from '@/lib/supabase';
import { logger } from '@/utils/logger';
import { s } from '@/utils/scale';

/**
 * Commissioner-only re-entry flow to add past-season standings to a league that
 * already exists — the "finish history later" companion to the import wizards.
 * Reuses the wizard's StepHistory (screenshot OCR + manual entry) and persists
 * via the `import-league-history` edge function. Reached from league-info.
 */
export default function AddLeagueHistoryScreen() {
  const { leagueId } = useLocalSearchParams<{ leagueId: string }>();
  const c = useColors();
  const router = useRouter();
  const session = useSession();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const scrollRef = useRef<ScrollView>(null);
  const extractHistory = useExtractHistory();

  const [seasons, setSeasons] = useState<HistorySeasonData[]>([{ images: [], extracted: null }]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const { data: league, isLoading } = useQuery({
    queryKey: ['add-history-league', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leagues')
        .select('id, season, sport, created_by, name')
        .eq('id', leagueId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
  });

  const { data: teamNames } = useQuery({
    queryKey: ['add-history-teams', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('name')
        .eq('league_id', leagueId!)
        .order('name');
      if (error) throw error;
      return (data ?? []).map((t) => t.name);
    },
    enabled: !!leagueId,
  });

  const isCommissioner = !!(session?.user?.id && league?.created_by === session.user.id);

  // ─── StepHistory callbacks (local-state backed) ──────────────────────
  const setSeasonCount = useCallback((count: number) => {
    setSeasons((prev) =>
      Array.from({ length: count }, (_, i) => prev[i] ?? { images: [], extracted: null }),
    );
    setCurrentIndex((i) => Math.min(i, Math.max(0, count - 1)));
  }, []);

  const setImages = useCallback((seasonIndex: number, images: ImageData[]) => {
    setSeasons((prev) => prev.map((s, i) => (i === seasonIndex ? { ...s, images, extracted: null } : s)));
  }, []);

  const setExtracted = useCallback((seasonIndex: number, data: HistoryExtractionResult) => {
    setSeasons((prev) => prev.map((s, i) => (i === seasonIndex ? { ...s, extracted: data } : s)));
  }, []);

  const handleExtract = useCallback(
    async (seasonIndex: number) => {
      const season = seasons[seasonIndex];
      if (!season?.images.length) return;
      try {
        const result = await extractHistory.mutateAsync({ images: season.images });
        setExtracted(seasonIndex, result);
      } catch (err: any) {
        Alert.alert('Extraction failed', err.message ?? 'Could not read the standings.');
      }
    },
    [seasons, extractHistory, setExtracted],
  );

  const scrollToTop = useCallback(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), []);

  // ─── Submit ──────────────────────────────────────────────────────────
  const extractedSeasons = seasons.filter((s) => s.extracted?.teams?.length);

  const handleSubmit = useCallback(async () => {
    if (!leagueId || extractedSeasons.length === 0) return;
    setSubmitting(true);
    try {
      const history = extractedSeasons.map((s) => ({
        season: s.extracted!.season ?? 'unknown',
        teams: s.extracted!.teams.map((t, i) => ({
          team_name: t.team_name,
          wins: t.wins ?? 0,
          losses: t.losses ?? 0,
          ties: t.ties ?? 0,
          points_for: t.points_for ?? 0,
          points_against: t.points_against ?? 0,
          standing: t.standing ?? i + 1,
        })),
      }));

      const res = await supabase.functions.invoke('import-league-history', {
        body: { league_id: leagueId, history },
      });
      if (res.error) {
        let msg = 'Could not save history';
        try {
          const body = typeof res.error.message === 'string' ? JSON.parse(res.error.message) : null;
          if (body?.error) msg = body.error;
        } catch {
          if (res.data?.error) msg = res.data.error;
        }
        throw new Error(msg);
      }

      const unmatched: string[] = res.data?.unmatched_teams ?? [];
      queryClient.invalidateQueries({ queryKey: queryKeys.seasonStandings(leagueId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.leagueChampions(leagueId) });

      if (unmatched.length > 0) {
        Alert.alert(
          'History added',
          `Saved ${res.data?.inserted ?? 0} team-seasons. These names didn't match a team and were skipped: ${unmatched.join(', ')}.`,
          [{ text: 'OK', onPress: () => router.back() }],
        );
      } else {
        showToast('success', 'Season history added');
        router.back();
      }
    } catch (err: any) {
      logger.error('Add league history failed', err);
      Alert.alert('Error', err.message ?? 'Could not save history.');
    } finally {
      setSubmitting(false);
    }
  }, [leagueId, extractedSeasons, queryClient, router, showToast]);

  if (isLoading) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <PageHeader title="Add History" />
        <View style={styles.loading}><LogoSpinner /></View>
      </SafeAreaView>
    );
  }

  if (!isCommissioner) {
    return (
      <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
        <PageHeader title="Add History" />
        <View style={styles.loading}>
          <ThemedText style={{ color: c.secondaryText }}>Only the commissioner can add league history.</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title="Add History" />
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <ThemedText style={[styles.intro, { color: c.secondaryText }]}>
          Add past-season standings to {league?.name ?? 'your league'}. Upload a screenshot or type them
          in — they'll show up in Standings History. Re-adding a season updates it.
        </ThemedText>

        <StepHistory
          historySeasons={seasons}
          currentHistoryIndex={currentIndex}
          onSetSeasonCount={setSeasonCount}
          onSetImages={setImages}
          onSetExtracted={setExtracted}
          onSelectSeason={setCurrentIndex}
          onExtractHistory={handleExtract}
          extractHistoryMutation={extractHistory as any}
          scrollToTop={scrollToTop}
          teamNames={teamNames ?? []}
          season={league?.season ?? CURRENT_NBA_SEASON}
          sport={(league?.sport as Sport) ?? 'nba'}
        />

        <BrandButton
          label={extractedSeasons.length > 0 ? `Save ${extractedSeasons.length} Season${extractedSeasons.length === 1 ? '' : 's'}` : 'Save History'}
          variant="primary"
          size="large"
          fullWidth
          onPress={handleSubmit}
          loading={submitting}
          disabled={extractedSeasons.length === 0}
          accessibilityLabel="Save season history"
          style={styles.submit}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: s(16),
    paddingBottom: s(48),
    gap: s(12),
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: s(32),
  },
  intro: {
    fontSize: 13,
    lineHeight: 18,
  },
  submit: {
    marginTop: s(8),
  },
});
