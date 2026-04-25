import { AllTimeRecords } from '@/components/league-history/AllTimeRecords';
import { BracketHistory } from '@/components/league-history/BracketHistory';
import { DraftBoard } from '@/components/league-history/DraftBoard';
import { HeadToHeadMatrix } from '@/components/league-history/HeadToHeadMatrix';
import { StandingsHistory } from '@/components/league-history/StandingsHistory';
import { TradeHistory } from '@/components/league-history/TradeHistory';
import { TrophyCase } from '@/components/league-history/TrophyCase';
import { BrandSegmented } from '@/components/ui/BrandSegmented';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { Colors } from '@/constants/Colors';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useBracketHistory, useDraftHistory, useHeadToHead, useSeasonStandings } from '@/hooks/useLeagueHistory';
import { useTradeProposals } from '@/hooks/useTrades';
import { s } from '@/utils/scale';
import { useState } from 'react';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Segmented switcher lenses for the league history page. "Standings"
// trims from "Standings History", "H2H" is the universal shorthand for
// Head-to-Head, "Playoffs" is the postseason archive (round-by-round
// matchup cards, not a tree-shaped bracket).
const SEGMENTS = ['Standings', 'Playoffs', 'H2H', 'Drafts', 'Trades'] as const;
type Segment = typeof SEGMENTS[number];

export default function LeagueHistory() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId } = useAppState();

  // Prefetch so switching segments feels instant.
  useSeasonStandings(leagueId);
  useBracketHistory(leagueId);
  useHeadToHead(leagueId);
  useDraftHistory(leagueId);
  useTradeProposals(leagueId);

  const [segment, setSegment] = useState<Segment>('Standings');

  if (!leagueId) return null;

  const segmentTitle: Record<Segment, string> = {
    Standings: 'Standings History',
    Playoffs: 'Playoff History',
    H2H: 'Head-to-Head Records',
    Drafts: 'Draft History',
    Trades: 'Trade History',
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top']}>
      <PageHeader title="League History" />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* TrophyCase and AllTimeRecords are self-contained — they bring
            their own gold-rule labels and cards. */}
        <TrophyCase leagueId={leagueId} />
        <AllTimeRecords leagueId={leagueId} />

        <BrandSegmented
          options={SEGMENTS}
          selected={segment}
          onSelect={setSegment}
        />

        <Section title={segmentTitle[segment]} cardStyle={styles.segmentCard}>
          {segment === 'Standings' && <StandingsHistory leagueId={leagueId} />}
          {segment === 'Playoffs' && <BracketHistory leagueId={leagueId} />}
          {segment === 'H2H' && <HeadToHeadMatrix leagueId={leagueId} />}
          {segment === 'Drafts' && <DraftBoard leagueId={leagueId} />}
          {segment === 'Trades' && <TradeHistory leagueId={leagueId} />}
        </Section>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: {
    padding: s(16),
    paddingBottom: s(40),
  },
  // Segment card needs more generous vertical padding than the Section
  // default since children are full subcomponents (draft board, H2H
  // matrix) that want room to breathe.
  segmentCard: {
    paddingTop: s(14),
    paddingBottom: s(14),
    overflow: 'hidden',
  },
});
