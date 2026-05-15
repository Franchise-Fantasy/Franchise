import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { SeasonDropdown } from '@/components/playoff-archive/SeasonDropdown';
import { NhlArchiveTeamSheet } from '@/components/playoff-archive-nhl/NhlArchiveTeamSheet';
import { NhlBracketView } from '@/components/playoff-archive-nhl/NhlBracketView';
import { NhlSeasonAwards } from '@/components/playoff-archive-nhl/NhlSeasonAwards';
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

  const [segment, setSegment] = useState<Segment>('Playoffs');
  const [openFranchiseId, setOpenFranchiseId] = useState<string | null>(null);

  const { data: bracket, isLoading: bracketLoading } =
    useNhlArchiveBracket(selectedSeason);
  const { data: standings, isLoading: standingsLoading } =
    useNhlArchiveStandings(selectedSeason);

  // Auto-open the top-seeded West team's archive sheet on first load when
  // the cup hasn't been awarded yet — gives a fast path to the in-progress
  // season's contender without making the user tap into the bracket. Fires
  // once per screen mount; closing the sheet won't re-trigger it.
  const autoOpenedRef = useRef(false);
  useEffect(() => {
    if (autoOpenedRef.current) return;
    if (!bracket || !standings) return;
    if (bracket.year?.champion_franchise_id) return;
    const target = standings.standings.find(
      (s) => s.conference === 'West' && s.conference_seed === 1,
    );
    if (target) {
      autoOpenedRef.current = true;
      setOpenFranchiseId(target.franchise_id);
    }
  }, [bracket, standings]);

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
              sport="nhl"
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
                displayMode={
                  // 2014+ wildcard layout, EXCEPT 2020-21 which had divisional
                  // top-4 (Canadian-division bubble year) and 2019-20 which
                  // used 1-8 conf seeding for the bubble bracket.
                  bracket.year?.season === 2020
                    ? 'conf_eight'
                    : bracket.year?.season === 2021
                      ? 'divisional_top4'
                      : bracket.year?.format === 'divisional_2014_present'
                        ? 'modern_wildcard'
                        : bracket.year?.format === 'division_bracket_1980_1993'
                          ? 'divisional_top4'
                          : 'conf_eight'
                }
                onTeamTap={setOpenFranchiseId}
              />
            )}
            {segment === 'Playoffs' && (
              <NhlBracketView bracket={bracket} onTeamTap={setOpenFranchiseId} />
            )}
            {segment === 'Awards' && (
              <NhlSeasonAwards
                season={selectedSeason}
                onPlayerTap={(entry) => {
                  if (entry.franchise_id) setOpenFranchiseId(entry.franchise_id);
                }}
              />
            )}
          </>
        )}
      </View>

      <NhlArchiveTeamSheet
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
