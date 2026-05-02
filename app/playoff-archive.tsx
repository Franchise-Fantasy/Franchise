import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ArchiveTeamSheet } from '@/components/playoff-archive/ArchiveTeamSheet';
import { OverviewView } from '@/components/playoff-archive/OverviewView';
import { SeasonAwards } from '@/components/playoff-archive/SeasonAwards';
import { SeasonDropdown } from '@/components/playoff-archive/SeasonDropdown';
import { StandingsView } from '@/components/playoff-archive/StandingsView';
import { BrandSegmented } from '@/components/ui/BrandSegmented';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { useSession } from '@/context/AuthProvider';
import { useArchiveColors } from '@/hooks/useArchiveColors';
import {
  useArchiveBracket,
  useArchiveSeasons,
  useArchiveStandings,
} from '@/hooks/useArchivePlayoffs';
import { isArchiveFlagOn } from '@/utils/featureFlags';
import { s } from '@/utils/scale';

// Order is left → right in the segmented control. "Playoffs" is the
// centerpiece and the default landing tab.
const SEGMENTS = ['Standings', 'Playoffs', 'Awards'] as const;
type Segment = (typeof SEGMENTS)[number];

export default function PlayoffArchiveScreen() {
  const c = useArchiveColors();
  const session = useSession();
  const router = useRouter();
  const flagOn = isArchiveFlagOn(session?.user);

  // Defensive guard: if a non-flagged user lands here via deep link, bounce
  // them back rather than letting them poke at the placeholder UI.
  useEffect(() => {
    if (session && !flagOn) router.replace('/(tabs)');
  }, [session, flagOn, router]);

  const { data: seasons, isLoading: seasonsLoading } = useArchiveSeasons();
  const [selectedSeason, setSelectedSeason] = useState<number | null>(null);

  // Auto-select the most recent season once the list loads.
  useEffect(() => {
    if (seasons && seasons.length > 0 && selectedSeason == null) {
      setSelectedSeason(seasons[0].season);
    }
  }, [seasons, selectedSeason]);

  const [segment, setSegment] = useState<Segment>('Playoffs');
  const [openFranchiseId, setOpenFranchiseId] = useState<string | null>(null);

  const { data: bracket, isLoading: bracketLoading } =
    useArchiveBracket(selectedSeason);
  const { data: standings, isLoading: standingsLoading } =
    useArchiveStandings(selectedSeason);

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
        title="NBA ARCHIVE"
        titleNode={
          seasons && seasons.length > 0 ? (
            <SeasonDropdown
              seasons={seasons}
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
                No seasons imported yet.
              </ThemedText>
            ) : (
              <LogoSpinner />
            )}
          </View>
        ) : (
          <>
            {segment === 'Playoffs' && (
              <OverviewView
                bracket={bracket}
                onTeamTap={setOpenFranchiseId}
              />
            )}
            {segment === 'Standings' && (
              <StandingsView
                standings={standings.standings}
                hasPlayIn={!!bracket.year?.has_play_in}
                playoffSeedCutoff={
                  // 1977-1983 used a 12-team format (top 6 per conf made
                  // playoffs outright, 1/2 seeds got byes). 1984+ moved to
                  // a 16-team format (top 8). 2020+ added the play-in but
                  // the outright cutoff stayed at 6.
                  (selectedSeason ?? 9999) <= 1983 || !!bracket.year?.has_play_in ? 6 : 8
                }
                onTeamTap={setOpenFranchiseId}
              />
            )}
            {segment === 'Awards' && (
              <SeasonAwards
                season={selectedSeason}
                onPlayerTap={(entry) => {
                  if (entry.franchise_id) setOpenFranchiseId(entry.franchise_id);
                }}
              />
            )}
          </>
        )}
      </View>

      <ArchiveTeamSheet
        season={selectedSeason}
        franchiseId={openFranchiseId}
        hasPlayIn={!!bracket?.year?.has_play_in}
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
