import { PlayoffBracket } from '@/components/playoff/PlayoffBracket';
import { SeedPickModal } from '@/components/playoff/SeedPickModal';
import { ThemedText } from '@/components/ThemedText';
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
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
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
      });
    }

    byRound.set(r, roundSlots);
    allSlots.push(...roundSlots);
  }

  return allSlots;
}

export default function PlayoffBracketScreen() {
  const router = useRouter();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { leagueId } = useAppState();

  const { data: league } = useLeague();
  const season = league?.season ?? CURRENT_NBA_SEASON;

  const { data: bracketSlots, isLoading: bracketLoading } = usePlayoffBracket(season);
  const { data: pendingPick } = usePendingSeedPick(season);

  const [seedPickVisible, setSeedPickVisible] = useState(false);

  // Fetch team names + standings for projected bracket
  const { data: teamsData } = useQuery({
    queryKey: ['bracketTeamData', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, wins, losses, points_for')
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
      if (b.wins !== a.wins) return b.wins - a.wins;
      return parseFloat(String(b.points_for)) - parseFloat(String(a.points_for));
    });

    const seeds = seedTeams(
      sorted.map((t) => ({ id: t.id, wins: t.wins, points_for: parseFloat(String(t.points_for)) })),
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
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={[styles.backText, { color: c.accent }]}>{'‹ Back'}</Text>
        </TouchableOpacity>
        <ThemedText type="defaultSemiBold" style={styles.headerTitle} accessibilityRole="header">
          Playoff Bracket
        </ThemedText>
        <View style={styles.backBtn} />
      </View>

      {/* Projected banner */}
      {!hasRealBracket && displaySlots.length > 0 && (
        <View style={[styles.projectedBanner, { backgroundColor: '#f59e0b22', borderBottomColor: '#f59e0b' }]}>
          <Text style={[styles.projectedText, { color: '#b45309' }]}>
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
        <ActivityIndicator style={styles.loader} />
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    height: 50,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 60,
    paddingVertical: 8,
  },
  backText: {
    fontSize: 17,
    fontWeight: '400',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 17,
  },
  projectedBanner: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'center',
    borderBottomWidth: 1,
  },
  projectedText: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  pickBanner: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  pickBannerText: {
    fontSize: 14,
    fontWeight: '600',
  },
  loader: {
    marginTop: 40,
  },
});

export const options = {
  headerShown: false,
};
