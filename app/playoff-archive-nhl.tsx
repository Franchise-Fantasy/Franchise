import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SeasonDropdown } from '@/components/playoff-archive/SeasonDropdown';
import { NhlStandingsView } from '@/components/playoff-archive-nhl/NhlStandingsView';
import { BrandSegmented } from '@/components/ui/BrandSegmented';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { useSession } from '@/context/AuthProvider';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type { ArchiveSeasonRow } from '@/hooks/useArchivePlayoffs';
import {
  useNhlArchiveBracket,
  useNhlArchiveSeasons,
  useNhlArchiveStandings,
} from '@/hooks/useNhlArchivePlayoffs';
import { isNhlArchiveFlagOn } from '@/utils/featureFlags';
import { s } from '@/utils/scale';

const SEGMENTS = ['Standings', 'Playoffs', 'Awards'] as const;
type Segment = (typeof SEGMENTS)[number];

// v0 ships only the Standings tab populated. Playoffs and Awards land once
// hand-curated 2024–25 data is in (the schema and hooks are already wired).
export default function PlayoffArchiveNhlScreen() {
  const c = useArchiveColors();
  const session = useSession();
  const router = useRouter();
  const flagOn = isNhlArchiveFlagOn(session?.user);

  useEffect(() => {
    if (session && !flagOn) router.replace('/(tabs)');
  }, [session, flagOn, router]);

  const { data: seasons, isLoading: seasonsLoading } = useNhlArchiveSeasons();
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  useEffect(() => {
    if (seasons && seasons.length > 0 && selectedSeason == null) {
      setSelectedSeason(seasons[0].season);
    }
  }, [seasons, selectedSeason]);

  const [segment, setSegment] = useState<Segment>('Standings');

  const { data: bracket, isLoading: bracketLoading } =
    useNhlArchiveBracket(selectedSeason);
  const { data: standings, isLoading: standingsLoading } =
    useNhlArchiveStandings(selectedSeason);

  if (!flagOn) return null;

  const isLoading =
    seasonsLoading ||
    (!!selectedSeason && (bracketLoading || standingsLoading));

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: c.background }]}
      edges={['top']}
    >
      <PageHeader
        title="NHL ARCHIVE"
        titleNode={
          seasons && seasons.length > 0 ? (
            // SeasonDropdown's row shape matches NhlArchiveSeasonRow exactly
            // (both RPCs return the same envelope), so this cast is safe.
            <SeasonDropdown
              seasons={seasons as unknown as ArchiveSeasonRow[]}
              selected={selectedSeason}
              onSelect={setSelectedSeason}
            />
          ) : undefined
        }
      />

      <View style={styles.body}>
        <BrandSegmented
          options={SEGMENTS}
          selected={segment}
          onSelect={setSegment}
        />

        {isLoading || !bracket || !standings ? (
          <View style={styles.center}>
            {seasons && seasons.length === 0 ? (
              <ThemedText style={{ color: c.secondaryText }}>
                No seasons imported yet. Run scripts/import-nhl-playoff-archive.mjs.
              </ThemedText>
            ) : (
              <LogoSpinner />
            )}
          </View>
        ) : (
          <>
            {segment === 'Standings' && (
              <NhlStandingsView
                standings={standings.standings}
                playoffSeedCutoff={8}
                onTeamTap={() => {
                  // Team-detail sheet is a phase-2 add-on. For now the row
                  // tap is a no-op; the touch target is already wired so it
                  // lights up later without screen-level changes.
                }}
              />
            )}
            {segment === 'Playoffs' && <PlaceholderTab label="Playoff bracket" c={c} />}
            {segment === 'Awards' && <PlaceholderTab label="Awards" c={c} />}
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function PlaceholderTab({
  label,
  c,
}: {
  label: string;
  c: ReturnType<typeof useArchiveColors>;
}) {
  return (
    <ScrollView contentContainerStyle={styles.placeholderScroll}>
      <View style={[styles.placeholderCard, { backgroundColor: c.card, borderColor: c.border }]}>
        <ThemedText style={[styles.placeholderTitle, { color: c.text }]}>
          {label} — coming soon
        </ThemedText>
        <ThemedText style={[styles.placeholderBody, { color: c.secondaryText }]}>
          The schema and RPCs are already in place. This tab activates once
          per-season {label.toLowerCase()} data has been hand-curated into the
          import script.
        </ThemedText>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: s(12),
    paddingTop: s(4),
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: s(40),
  },
  placeholderScroll: {
    paddingVertical: s(20),
  },
  placeholderCard: {
    borderWidth: 1,
    borderRadius: 10,
    padding: s(16),
    gap: s(8),
  },
  placeholderTitle: {
    fontSize: 16,
    fontWeight: '700',
  },
  placeholderBody: {
    fontSize: 13,
    lineHeight: 18,
  },
});
