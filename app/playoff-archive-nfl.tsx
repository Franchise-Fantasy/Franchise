import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SeasonDropdown } from '@/components/playoff-archive/SeasonDropdown';
import { NflArchiveTeamSheet } from '@/components/playoff-archive-nfl/NflArchiveTeamSheet';
import { NflBracketView } from '@/components/playoff-archive-nfl/NflBracketView';
import { NflSeasonAwards } from '@/components/playoff-archive-nfl/NflSeasonAwards';
import { NflStandingsView } from '@/components/playoff-archive-nfl/NflStandingsView';
import { BrandSegmented } from '@/components/ui/BrandSegmented';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { useSession } from '@/context/AuthProvider';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import type { ArchiveSeasonRow } from '@/hooks/useArchivePlayoffs';
import {
  useNflArchiveBracket,
  useNflArchiveSeasons,
  useNflArchiveStandings,
} from '@/hooks/useNflArchivePlayoffs';
import { isNflArchiveFlagOn } from '@/utils/featureFlags';
import { s } from '@/utils/scale';

const SEGMENTS = ['Standings', 'Playoffs', 'Awards'] as const;
type Segment = (typeof SEGMENTS)[number];

// v0 ships only the Standings tab populated. Playoffs and Awards land once
// curated season data (bracket + game_box + awards) is in (the schema and
// hooks are already wired).
export default function PlayoffArchiveNflScreen() {
  const c = useArchiveColors();
  const session = useSession();
  const router = useRouter();
  const flagOn = isNflArchiveFlagOn(session?.user);

  useEffect(() => {
    if (session && !flagOn) router.replace('/(tabs)');
  }, [session, flagOn, router]);

  const { data: seasons, isLoading: seasonsLoading } = useNflArchiveSeasons();
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  useEffect(() => {
    if (seasons && seasons.length > 0 && selectedSeason == null) {
      setSelectedSeason(seasons[0].season);
    }
  }, [seasons, selectedSeason]);

  const [segment, setSegment] = useState<Segment>('Playoffs');
  const [openFranchiseId, setOpenFranchiseId] = useState<string | null>(null);

  const { data: bracket, isLoading: bracketLoading } =
    useNflArchiveBracket(selectedSeason);
  const { data: standings, isLoading: standingsLoading } =
    useNflArchiveStandings(selectedSeason);

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
        title="NFL ARCHIVE"
        titleNode={
          seasons && seasons.length > 0 ? (
            // SeasonDropdown's row shape matches NflArchiveSeasonRow exactly
            // (both RPCs return the same envelope), so this cast is safe.
            <SeasonDropdown
              seasons={seasons as unknown as ArchiveSeasonRow[]}
              selected={selectedSeason}
              onSelect={setSelectedSeason}
              sport="nfl"
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
                No seasons imported yet. Run scripts/import-nfl-playoff-archive.mjs.
              </ThemedText>
            ) : (
              <LogoSpinner />
            )}
          </View>
        ) : (
          <>
            {segment === 'Standings' && (
              <NflStandingsView
                standings={standings.standings}
                format={bracket.year?.format ?? null}
                onTeamTap={setOpenFranchiseId}
              />
            )}
            {segment === 'Playoffs' && (
              <NflBracketView bracket={bracket} onTeamTap={setOpenFranchiseId} />
            )}
            {segment === 'Awards' && (
              <NflSeasonAwards
                season={selectedSeason}
                onPlayerTap={(entry) => {
                  if (entry.franchise_id) setOpenFranchiseId(entry.franchise_id);
                }}
              />
            )}
          </>
        )}
      </View>

      <NflArchiveTeamSheet
        season={selectedSeason}
        franchiseId={openFranchiseId}
        onClose={() => setOpenFranchiseId(null)}
      />
    </SafeAreaView>
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
});
