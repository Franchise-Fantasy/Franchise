import { PlayoffBracket } from '@/components/playoff/PlayoffBracket';
import { ms, s } from "@/utils/scale";
import { SeedPickModal } from '@/components/playoff/SeedPickModal';
import { PageHeader } from '@/components/ui/PageHeader';
import { Colors } from '@/constants/Colors';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { useAppState } from '@/context/AppStateProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { usePlayoffBracket, usePendingSeedPick } from '@/hooks/usePlayoffBracket';
import { supabase } from '@/lib/supabase';
import { PlayoffBracketSlot } from '@/types/playoff';
import {
  BracketPairing,
  buildFixedRound1,
  buildStandardRound1,
  calcRounds,
  nextPowerOf2,
  seedTeams,
} from '@/utils/playoff';
import { queryKeys } from '@/constants/queryKeys';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Convert bracket pairings into PlayoffBracketSlot[] for the bracket component. */
function pairingsToSlots(
  pairings: BracketPairing[],
  leagueId: string,
  season: string,
  round: number,
): PlayoffBracketSlot[] {
  return pairings.map((p, i) => ({
    id: `projected-${round}-${i}`,
    league_id: leagueId,
    season,
    round,
    bracket_position: i + 1,
    matchup_id: null,
    team_a_id: p.teamA.teamId,
    team_a_seed: p.teamA.seed,
    team_b_id: p.teamB?.teamId ?? null,
    team_b_seed: p.teamB?.seed ?? null,
    winner_id: p.teamB === null ? p.teamA.teamId : null, // auto-advance byes
    is_bye: p.teamB === null,
    is_third_place: false,
  }));
}

/** Build a full projected bracket (all rounds) from round 1 pairings. */
function buildFullProjectedBracket(
  round1Pairings: BracketPairing[],
  leagueId: string,
  season: string,
  playoffTeams: number,
): PlayoffBracketSlot[] {
  return fillFutureRounds(
    pairingsToSlots(round1Pairings, leagueId, season, 1),
    playoffTeams,
    leagueId,
    season,
  );
}

/**
 * Given existing bracket slots (possibly only round 1), fill in all future
 * rounds so the full bracket tree is always visible. Known winners (e.g. bye
 * teams) are placed in their correct next-round slot; unknowns stay TBD.
 */
function fillFutureRounds(
  slots: PlayoffBracketSlot[],
  playoffTeams: number,
  leagueId: string,
  season: string,
): PlayoffBracketSlot[] {
  const totalRounds = calcRounds(playoffTeams);
  const bracketSize = nextPowerOf2(playoffTeams);

  // Index existing slots by round
  const byRound = new Map<number, PlayoffBracketSlot[]>();
  for (const s of slots) {
    if (!byRound.has(s.round)) byRound.set(s.round, []);
    byRound.get(s.round)!.push(s);
  }

  const allSlots = [...slots];

  for (let r = 2; r <= totalRounds; r++) {
    if (byRound.has(r)) continue; // round already populated from DB

    const prevSlots = byRound.get(r - 1);
    const matchupsInRound = bracketSize / Math.pow(2, r);
    const roundSlots: PlayoffBracketSlot[] = [];

    for (let pos = 1; pos <= matchupsInRound; pos++) {
      // Adjacent feeder positions from previous round
      const feederA = prevSlots?.find((s) => s.bracket_position === pos * 2 - 1);
      const feederB = prevSlots?.find((s) => s.bracket_position === pos * 2);

      const teamA = feederA?.winner_id
        ? {
            id: feederA.winner_id,
            seed:
              feederA.winner_id === feederA.team_a_id
                ? feederA.team_a_seed
                : feederA.team_b_seed,
          }
        : null;

      const teamB = feederB?.winner_id
        ? {
            id: feederB.winner_id,
            seed:
              feederB.winner_id === feederB.team_a_id
                ? feederB.team_a_seed
                : feederB.team_b_seed,
          }
        : null;

      roundSlots.push({
        id: `fill-${r}-${pos}`,
        league_id: leagueId,
        season,
        round: r,
        bracket_position: pos,
        matchup_id: null,
        team_a_id: teamA?.id ?? null,
        team_a_seed: teamA?.seed ?? null,
        team_b_id: teamB?.id ?? null,
        team_b_seed: teamB?.seed ?? null,
        winner_id: null,
        is_bye: false,
        is_third_place: false,
      });
    }

    // Add 3rd place placeholder on the finals round if previous round had 2+ non-bye matchups
    if (r === totalRounds && r > 1) {
      const prevNonBye = (byRound.get(r - 1) ?? []).filter(
        (s) => !s.is_bye && !s.is_third_place,
      );
      if (prevNonBye.length >= 2) {
        roundSlots.push({
          id: `fill-${r}-3rd`,
          league_id: leagueId,
          season,
          round: r,
          bracket_position: matchupsInRound + 1,
          matchup_id: null,
          team_a_id: null,
          team_a_seed: null,
          team_b_id: null,
          team_b_seed: null,
          winner_id: null,
          is_bye: false,
          is_third_place: true,
        });
      }
    }

    byRound.set(r, roundSlots);
    allSlots.push(...roundSlots);
  }

  return allSlots;
}

export default function PlayoffBracketScreen() {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId } = useAppState();

  const { data: league } = useLeague();
  const season = league?.season ?? CURRENT_NBA_SEASON;

  const { data: bracketSlots, isLoading: bracketLoading } = usePlayoffBracket(season);
  const { data: pendingPick } = usePendingSeedPick(season, true);

  const [seedPickVisible, setSeedPickVisible] = useState(false);

  // Fetch team names + standings for projected bracket
  const { data: teamsData } = useQuery({
    queryKey: queryKeys.bracketTeamData(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, wins, losses, ties, points_for')
        .eq('league_id', leagueId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });

  const teamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teamsData ?? []) map.set(t.id, t.name);
    return map;
  }, [teamsData]);

  const playoffTeams = league?.playoff_teams ?? 8;
  const format = league?.playoff_seeding_format ?? 'standard';

  const hasRealBracket = (bracketSlots?.length ?? 0) > 0;

  // Build projected bracket from current standings when no real bracket exists
  const projectedSlots = useMemo(() => {
    if (hasRealBracket || !teamsData || !leagueId || playoffTeams < 2) return null;

    const sorted = [...teamsData].sort((a, b) => {
      const gpa = (a.wins ?? 0) + (a.losses ?? 0) + (a.ties ?? 0);
      const gpb = (b.wins ?? 0) + (b.losses ?? 0) + (b.ties ?? 0);
      const pctA = gpa === 0 ? 0 : (a.wins ?? 0) / gpa;
      const pctB = gpb === 0 ? 0 : (b.wins ?? 0) / gpb;
      if (pctB !== pctA) return pctB - pctA;
      return parseFloat(String(b.points_for)) - parseFloat(String(a.points_for));
    });

    const seeds = seedTeams(
      sorted.map((t) => ({ id: t.id, wins: t.wins ?? 0, points_for: parseFloat(String(t.points_for)) })),
      Math.min(playoffTeams, sorted.length),
    );

    if (seeds.length < 2) return null;

    const pairings =
      format === 'fixed'
        ? buildFixedRound1(seeds)
        : buildStandardRound1(seeds);

    return buildFullProjectedBracket(pairings, leagueId, season, seeds.length);
  }, [hasRealBracket, teamsData, leagueId, playoffTeams, format, season]);

  // Fill in future rounds for real brackets so the full tree is always visible
  const filledSlots = useMemo(() => {
    if (!hasRealBracket || !bracketSlots || !leagueId) return null;
    return fillFutureRounds(bracketSlots, playoffTeams, leagueId, season);
  }, [hasRealBracket, bracketSlots, playoffTeams, leagueId, season]);

  const displaySlots = filledSlots ?? projectedSlots ?? [];
  const effectivePlayoffTeams = hasRealBracket
    ? playoffTeams
    : Math.min(playoffTeams, teamsData?.length ?? playoffTeams);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader title="Playoff Bracket" />

      {/* Projected banner */}
      {!hasRealBracket && displaySlots.length > 0 && (
        <View style={[styles.projectedBanner, { backgroundColor: c.warningMuted, borderBottomColor: c.warning }]}>
          <Text style={[styles.projectedText, { color: c.warning }]}>
            PROJECTED — Based on current standings
          </Text>
        </View>
      )}

      {/* Seed pick banner */}
      {pendingPick && (
        <TouchableOpacity
          style={[styles.pickBanner, { backgroundColor: c.accent }]}
          onPress={() => setSeedPickVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="It's your turn to pick an opponent"
          accessibilityHint="Tap to select your playoff opponent"
        >
          <Text style={[styles.pickBannerText, { color: c.accentText }]}>
            It's your turn to pick an opponent! Tap here.
          </Text>
        </TouchableOpacity>
      )}

      {/* Bracket */}
      {bracketLoading ? (
        <View style={styles.loader}><LogoSpinner /></View>
      ) : (
        <PlayoffBracket
          slots={displaySlots}
          teamMap={teamMap}
          playoffTeams={effectivePlayoffTeams}
        />
      )}

      {/* Seed pick modal */}
      {pendingPick && teamMap && (
        <SeedPickModal
          visible={seedPickVisible}
          onClose={() => setSeedPickVisible(false)}
          pick={pendingPick}
          teamMap={teamMap}
          season={season}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  projectedBanner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  projectedText: {
    fontSize: ms(12),
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pickBanner: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  pickBannerText: {
    fontSize: ms(14),
    fontWeight: '600',
  },
  loader: {
    marginTop: 40,
  },
});

export const options = {
  headerShown: false,
};
