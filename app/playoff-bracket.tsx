import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PlayoffBracket } from '@/components/playoff/PlayoffBracket';
import { SeedPickModal } from '@/components/playoff/SeedPickModal';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand, Fonts } from '@/constants/Colors';
import { CURRENT_NBA_SEASON } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { usePendingSeedPick, usePlayoffBracket } from '@/hooks/usePlayoffBracket';
import { supabase } from '@/lib/supabase';
import { PlayoffBracketSlot } from '@/types/playoff';
import {
  BracketPairing,
  buildFixedRound1,
  buildStandardRound1,
  calcRounds,
  nextPowerOf2,
  seedTeams,
} from '@/utils/league/playoff';
import { ms, s } from '@/utils/scale';

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

  const byRound = new Map<number, PlayoffBracketSlot[]>();
  for (const slot of slots) {
    if (!byRound.has(slot.round)) byRound.set(slot.round, []);
    byRound.get(slot.round)!.push(slot);
  }

  const allSlots = [...slots];

  for (let r = 2; r <= totalRounds; r++) {
    if (byRound.has(r)) continue;

    const prevSlots = byRound.get(r - 1);
    const matchupsInRound = bracketSize / Math.pow(2, r);
    const roundSlots: PlayoffBracketSlot[] = [];

    for (let pos = 1; pos <= matchupsInRound; pos++) {
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

    if (r === totalRounds && r > 1) {
      const prevNonBye = (byRound.get(r - 1) ?? []).filter(
        (slot) => !slot.is_bye && !slot.is_third_place,
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
  const c = useColors();
  const { leagueId } = useAppState();

  const { data: league } = useLeague();
  const season = league?.season ?? CURRENT_NBA_SEASON;

  const { data: bracketSlots, isLoading: bracketLoading } = usePlayoffBracket(season);
  const { data: pendingPick } = usePendingSeedPick(season, true);

  const [seedPickVisible, setSeedPickVisible] = useState(false);

  const { data: teamsData } = useQuery({
    queryKey: queryKeys.bracketTeamData(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, name, logo_key, wins, losses, ties, points_for')
        .eq('league_id', leagueId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });

  const teamMap = useMemo(() => {
    const map = new Map<string, { name: string; logoKey: string | null }>();
    for (const t of teamsData ?? []) {
      map.set(t.id, { name: t.name, logoKey: t.logo_key ?? null });
    }
    return map;
  }, [teamsData]);

  const playoffTeams = league?.playoff_teams ?? 8;
  const format = league?.playoff_seeding_format ?? 'standard';

  const hasRealBracket = (bracketSlots?.length ?? 0) > 0;

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
      sorted.map((t) => ({
        id: t.id,
        wins: t.wins ?? 0,
        points_for: parseFloat(String(t.points_for)),
      })),
      Math.min(playoffTeams, sorted.length),
    );

    if (seeds.length < 2) return null;

    const pairings =
      format === 'fixed' ? buildFixedRound1(seeds) : buildStandardRound1(seeds);

    return buildFullProjectedBracket(pairings, leagueId, season, seeds.length);
  }, [hasRealBracket, teamsData, leagueId, playoffTeams, format, season]);

  const filledSlots = useMemo(() => {
    if (!hasRealBracket || !bracketSlots || !leagueId) return null;
    return fillFutureRounds(bracketSlots, playoffTeams, leagueId, season);
  }, [hasRealBracket, bracketSlots, playoffTeams, leagueId, season]);

  const displaySlots = filledSlots ?? projectedSlots ?? [];
  const effectivePlayoffTeams = hasRealBracket
    ? playoffTeams
    : Math.min(playoffTeams, teamsData?.length ?? playoffTeams);

  const isOffseason = !!league?.offseason_step;

  if (isOffseason) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <PageHeader title="Playoff Bracket" />
        <View
          style={styles.empty}
          accessible
          accessibilityRole="text"
          accessibilityLabel="It's the offseason. The bracket will return when next season's playoffs begin."
        >
          <View style={[styles.emptyRule, { backgroundColor: c.gold }]} />
          <Ionicons
            name="sunny-outline"
            size={ms(40)}
            color={c.secondaryText}
            accessible={false}
          />
          <ThemedText
            type="display"
            style={[styles.emptyTitle, { color: c.text }]}
          >
            Offseason.
          </ThemedText>
          <ThemedText
            type="varsitySmall"
            style={[styles.emptySub, { color: c.secondaryText }]}
          >
            BRACKET RETURNS NEXT POSTSEASON
          </ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="Playoff Bracket" />

      {/* Projected banner — gold rule + varsity caps. Reads as a preview
          header rather than a warning. */}
      {!hasRealBracket && displaySlots.length > 0 && (
        <View
          style={[
            styles.projectedBanner,
            { backgroundColor: c.cardAlt, borderBottomColor: c.border },
          ]}
        >
          <View style={[styles.projectedRule, { backgroundColor: c.gold }]} />
          <ThemedText
            type="varsitySmall"
            style={[styles.projectedText, { color: c.text }]}
          >
            PROJECTED · BASED ON CURRENT STANDINGS
          </ThemedText>
          <View style={[styles.projectedRule, { backgroundColor: c.gold }]} />
        </View>
      )}

      {/* Seed pick CTA banner — turfGreen broadcast surface, ecru text */}
      {pendingPick && (
        <TouchableOpacity
          style={[styles.pickBanner, { backgroundColor: Brand.turfGreen }]}
          onPress={() => setSeedPickVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="It's your turn to pick an opponent"
          accessibilityHint="Tap to select your playoff opponent"
        >
          <View style={styles.pickBannerInner}>
            <View style={styles.pickBannerText}>
              <ThemedText
                type="varsitySmall"
                style={[styles.pickBannerEyebrow, { color: c.gold }]}
              >
                YOUR PICK
              </ThemedText>
              <ThemedText
                type="display"
                style={[styles.pickBannerTitle, { color: Brand.ecru }]}
              >
                Choose your opponent.
              </ThemedText>
            </View>
            <Ionicons name="chevron-forward" size={ms(22)} color={c.gold} />
          </View>
        </TouchableOpacity>
      )}

      {bracketLoading ? (
        <View style={styles.loader}>
          <LogoSpinner />
        </View>
      ) : (
        <PlayoffBracket
          slots={displaySlots}
          teamMap={teamMap}
          playoffTeams={effectivePlayoffTeams}
        />
      )}

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
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(16),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  projectedRule: {
    flex: 1,
    height: 2,
  },
  projectedText: {
    fontSize: ms(11),
    letterSpacing: 1.4,
  },
  pickBanner: {
    paddingHorizontal: s(16),
    paddingVertical: s(14),
  },
  pickBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(12),
  },
  pickBannerText: {
    flex: 1,
  },
  pickBannerEyebrow: {
    fontSize: ms(11),
    letterSpacing: 1.4,
    marginBottom: s(2),
  },
  pickBannerTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(20),
    lineHeight: ms(24),
    letterSpacing: -0.2,
  },
  loader: {
    marginTop: s(40),
    alignItems: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(32),
    gap: s(10),
  },
  emptyRule: {
    height: 2,
    width: s(48),
    marginBottom: s(8),
  },
  emptyTitle: {
    fontFamily: Fonts.display,
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  emptySub: {
    fontSize: ms(11),
    letterSpacing: 1.3,
    textAlign: 'center',
  },
});

export const options = {
  headerShown: false,
};
