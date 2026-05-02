import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { PickCardEntry } from '@/components/lottery/PickCard';
import type { PickListHandle } from '@/components/lottery/PickList';
import { PickList } from '@/components/lottery/PickList';
import { BrandButton } from '@/components/ui/BrandButton';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { ThemedText } from '@/components/ui/ThemedText';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useColors } from '@/hooks/useColors';
import { useLeague } from '@/hooks/useLeague';
import { supabase } from '@/lib/supabase';
import { generateDefaultOdds } from '@/utils/league/lottery';
import { ms, s } from '@/utils/scale';

interface LotteryEntry {
  team_id: string;
  team_name: string;
  original_standing: number;
  lottery_position: number;
  was_drawn: boolean;
}

interface TeamMeta {
  id: string;
  tricode: string | null;
  logo_key: string | null;
}

export default function LotteryRoomScreen() {
  const c = useColors();
  const { leagueId } = useAppState();
  const { data: league } = useLeague();
  const session = useSession();
  const queryClient = useQueryClient();
  const isCommissioner = session?.user?.id === league?.created_by;

  const [lotteryResults, setLotteryResults] = useState<LotteryEntry[] | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [ceremonyStarted, setCeremonyStarted] = useState(false);
  const [spinningPosition, setSpinningPosition] = useState<number | null>(null);
  const broadcastChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const pickListRef = useRef<PickListHandle>(null);
  // True if the lottery was run in this mount of the screen. Prevents the
  // post-completion auto-snap (revisit-style) from clobbering the just-ran
  // ceremony, which should still play through the spin reveals.
  const didRunInSessionRef = useRef(false);

  // Mirror lotteryResults to a ref so the broadcast handler (closed over the
  // initial render's state) can resolve a displayIndex → lottery_position
  // when an event arrives later.
  const lotteryResultsRef = useRef<LotteryEntry[] | null>(null);
  useEffect(() => {
    lotteryResultsRef.current = lotteryResults;
  }, [lotteryResults]);

  // Fetch existing lottery results (in case lottery already ran)
  const { data: existingResults } = useQuery({
    queryKey: queryKeys.lotteryResults(leagueId!, league?.season),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('lottery_results')
        .select('results')
        .eq('league_id', leagueId!)
        .eq('season', league!.season)
        .maybeSingle();
      if (error) throw error;
      // maybeSingle() returns null when no row exists; coerce to null so
      // React Query doesn't reject `undefined` from `data?.results`.
      return (data?.results as LotteryEntry[] | null) ?? null;
    },
    enabled: !!leagueId && !!league?.season,
  });

  // Team metadata (logos / tricodes) for the spin reel and locked cards.
  const { data: teams } = useQuery({
    queryKey: queryKeys.leagueTeams(leagueId!),
    queryFn: async (): Promise<TeamMeta[]> => {
      const { data, error } = await supabase
        .from('teams')
        .select('id, tricode, logo_key')
        .eq('league_id', leagueId!);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!leagueId,
  });

  const teamsById = useMemo(() => {
    const map = new Map<string, TeamMeta>();
    (teams ?? []).forEach((t) => map.set(t.id, t));
    return map;
  }, [teams]);

  // Most-recent archived season records — drives the "W-L" line on each
  // revealed card. Mirrors the OffseasonLotteryOrder home-screen pattern:
  // pull all team_seasons, take the latest season's rows.
  const { data: latestSeasonRecords } = useQuery({
    queryKey: ['lotteryRoomTeamSeasons', leagueId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('team_seasons')
        .select('team_id, wins, losses, season')
        .eq('league_id', leagueId!)
        .order('season', { ascending: false });
      if (error) throw error;
      if (!data || data.length === 0) return [];
      const latest = data[0].season;
      return data.filter((r) => r.season === latest);
    },
    enabled: !!leagueId,
  });

  const recordsByTeamId = useMemo(() => {
    const map = new Map<string, { wins: number; losses: number }>();
    (latestSeasonRecords ?? []).forEach((r) => {
      map.set(r.team_id, { wins: r.wins ?? 0, losses: r.losses ?? 0 });
    });
    return map;
  }, [latestSeasonRecords]);

  // Lottery odds, indexed so `oddsArray[original_standing - 1]` is the
  // pre-lottery percentage chance for that team. Custom odds from
  // `league.lottery_odds` override the linear default.
  const oddsArray = useMemo<number[]>(() => {
    if (!lotteryResults) return [];
    const customOdds = (league as { lottery_odds?: number[] | null } | null | undefined)
      ?.lottery_odds;
    return customOdds ?? generateDefaultOdds(lotteryResults.length);
  }, [lotteryResults, league]);

  // Enrich the wire-format LotteryEntry rows with team metadata for the UI.
  const enrichedResults = useMemo<PickCardEntry[] | null>(() => {
    if (!lotteryResults) return null;
    return lotteryResults.map((r) => {
      const team = teamsById.get(r.team_id);
      const record = recordsByTeamId.get(r.team_id);
      const oddsValue = oddsArray[r.original_standing - 1];
      return {
        team_id: r.team_id,
        team_name: r.team_name,
        original_standing: r.original_standing,
        lottery_position: r.lottery_position,
        was_drawn: r.was_drawn,
        tricode: team?.tricode ?? null,
        logo_key: team?.logo_key ?? null,
        wins: record?.wins ?? null,
        losses: record?.losses ?? null,
        odds_pct: oddsValue != null ? `${oddsValue}%` : null,
      };
    });
  }, [lotteryResults, teamsById, recordsByTeamId, oddsArray]);

  const totalSlots = lotteryResults?.length ?? 0;

  // Hydrate local lotteryResults from the persisted DB row when revisiting
  // the screen (component remounted, local state empty).
  useEffect(() => {
    if (existingResults && !lotteryResults) {
      setLotteryResults(existingResults);
    }
  }, [existingResults, lotteryResults]);

  // Defensive: if the server says there's no lottery row but we still hold
  // stale local state (e.g. an admin reset wiped the DB while this screen
  // was open), clear it so the user sees Phase 1 instead of a "Done" button
  // that would 500 against `create-rookie-draft`. Gated on
  // `didRunInSessionRef` so the brief window between handleRunLottery and
  // the next existingResults refetch doesn't trigger a wipe.
  useEffect(() => {
    if (
      !didRunInSessionRef.current &&
      existingResults === null &&
      lotteryResults !== null
    ) {
      setLotteryResults(null);
      setCeremonyStarted(false);
      setRevealedCount(0);
      setSpinningPosition(null);
    }
  }, [existingResults, lotteryResults]);

  // Two-phase auto-snap, depending on offseason_step. Gated on
  // `didRunInSessionRef` so we don't clobber the just-ran ceremony, which
  // should still play through the spin reveals.
  //
  // - `lottery_revealing` (ceremony in progress): late joiner enters via the
  //   "Watch the Reveal" home CTA. Skip Phase 2 (no "Begin Reveal" button —
  //   they didn't start the ceremony) and go straight to Phase 3. Cards stay
  //   sealed until the next reveal_pick broadcast force-advances them.
  // - `lottery_complete` (ceremony already finalized): snap to fully revealed.
  //   No replay; the result is public.
  //
  // Split into its own effect (separate from the lotteryResults hydrator) so
  // a slow league refetch doesn't get blocked by an early lotteryResults
  // arrival — they can land in any order.
  useEffect(() => {
    if (
      didRunInSessionRef.current ||
      !lotteryResults ||
      league?.lottery_status !== 'complete' ||
      ceremonyStarted
    ) {
      return;
    }
    setCeremonyStarted(true);
    if (league?.offseason_step === 'lottery_complete') {
      setRevealedCount(lotteryResults.length);
    }
  }, [lotteryResults, league?.lottery_status, league?.offseason_step, ceremonyStarted]);

  const positionForDisplayIndex = useCallback((idx: number): number | null => {
    const r = lotteryResultsRef.current;
    if (!r) return null;
    const sorted = [...r].sort((a, b) => b.lottery_position - a.lottery_position);
    return sorted[idx]?.lottery_position ?? null;
  }, []);

  const receiveReveal = useCallback(
    (idx: number, lp?: number) => {
      const targetPosition = lp ?? positionForDisplayIndex(idx);
      if (targetPosition === null) return;
      // Force-advance: if reveals piled up while a slow client was mid-spin,
      // snap revealedCount forward and start the new spin. Skipped slots
      // appear instantly locked.
      setRevealedCount((prev) => Math.max(prev, idx));
      setSpinningPosition(targetPosition);
    },
    [positionForDisplayIndex],
  );

  // Realtime BROADCAST channel for synchronizing reveal across clients.
  // ⚠️ DO NOT add a `-${Date.now()}` suffix here. Broadcast channels require a
  // shared deterministic name — every client must match so sends reach
  // subscribers. The Hermes-crash rule in CLAUDE.md applies ONLY to
  // `postgres_changes` channels, not broadcast channels. Channel is stored in
  // a ref so commissioner sends reuse it instead of creating orphans.
  useEffect(() => {
    if (!leagueId) return;

    const channel = supabase
      .channel(`lottery:${leagueId}`)
      .on('broadcast', { event: 'lottery_results' }, (payload) => {
        setLotteryResults(payload.payload.results);
      })
      .on('broadcast', { event: 'ceremony_start' }, () => {
        setCeremonyStarted(true);
      })
      .on('broadcast', { event: 'reveal_pick' }, (payload) => {
        const idx = payload.payload.index as number;
        const lp = payload.payload.lottery_position as number | undefined;
        receiveReveal(idx, lp);
      })
      .subscribe();

    broadcastChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      broadcastChannelRef.current = null;
    };
  }, [leagueId, receiveReveal]);

  const handleRunLottery = async () => {
    setIsRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke('start-lottery', {
        body: { league_id: leagueId },
      });
      if (error) throw error;
      const results = data.results as LotteryEntry[];
      didRunInSessionRef.current = true;
      setLotteryResults(results);

      // Sync the React Query caches so navigating away + back doesn't show
      // the "Run Lottery" prompt again. Two caches must update:
      //  • lotteryResults — was `null` from the pre-run fetch; seed the new row.
      //  • league — `useLeague` has a 1-minute staleTime, which keeps the home
      //    hero on "Enter Lottery" until it expires. Invalidate so the hero
      //    refetches and advances to the next offseason step.
      if (leagueId && league?.season != null) {
        queryClient.setQueryData(
          queryKeys.lotteryResults(leagueId, league.season),
          results,
        );
      }
      if (leagueId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
      }

      // Broadcast results to all clients via the shared channel
      await broadcastChannelRef.current?.send({
        type: 'broadcast',
        event: 'lottery_results',
        payload: { results },
      });
    } catch (err: any) {
      // Pull the real reason out of the FunctionsHttpError body when present,
      // so a server-side validation failure (e.g. invalid offseason state)
      // surfaces in the alert instead of the generic non-2xx message.
      let detail = err?.message ?? 'Failed to run lottery';
      try {
        const body = await (err as { context?: Response }).context?.json?.();
        if (body?.error) detail = body.error;
      } catch {
        // Body wasn't JSON or context unavailable.
      }
      Alert.alert('Error', detail);
    } finally {
      setIsRunning(false);
    }
  };

  const handleStartCeremony = async () => {
    setCeremonyStarted(true);
    await broadcastChannelRef.current?.send({
      type: 'broadcast',
      event: 'ceremony_start',
      payload: {},
    });
  };

  const handleRevealNext = async () => {
    if (spinningPosition !== null) return; // mid-spin, ignore re-taps
    const nextRevealIndex = revealedCount;
    if (nextRevealIndex >= totalSlots) return;

    const targetPosition = positionForDisplayIndex(nextRevealIndex);
    if (targetPosition === null) return;

    setSpinningPosition(targetPosition);
    await broadcastChannelRef.current?.send({
      type: 'broadcast',
      event: 'reveal_pick',
      payload: { index: nextRevealIndex, lottery_position: targetPosition },
    });
  };

  const handleSpinComplete = useCallback(() => {
    const completedPosition = spinningPosition;
    setSpinningPosition(null);
    setRevealedCount((prev) => prev + 1);
    if (completedPosition === 1) {
      pickListRef.current?.fireConfetti();
    }
  }, [spinningPosition]);

  const handleDone = async () => {
    // Commissioner closing the ceremony also creates the rookie draft in the
    // same click. The user lands on the home hero with the new draft already
    // queued (status=unscheduled), where they can pick a date. Skipping the
    // intermediate "Create Draft" CTA — the ceremony naturally implies the
    // draft is the next step.
    if (isCommissioner && leagueId) {
      const { error } = await supabase.functions.invoke('create-rookie-draft', {
        body: { league_id: leagueId },
      });
      if (error) {
        // Supabase wraps non-2xx responses in a generic FunctionsHttpError;
        // the real message lives in the JSON body. Try to extract it so the
        // alert shows *why* it failed instead of "edge function returned non-2xx".
        let detail = error.message ?? String(error);
        try {
          const body = await (error as { context?: Response }).context?.json?.();
          if (body?.error) detail = body.error;
        } catch {
          // Body wasn't JSON or context unavailable — fall back to error.message.
        }
        Alert.alert('Error', `Failed to create draft: ${detail}`);
        return;
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
      queryClient.invalidateQueries({ queryKey: ['rookieDraft', leagueId] });
      queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
    } else if (leagueId) {
      // Non-commish — just navigate back; commish click is what advances state.
      queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
    }
    router.back();
  };

  const allRevealed =
    revealedCount >= totalSlots && totalSlots > 0 && spinningPosition === null;

  // Phase 1 + 2 share a brand-pass hero pattern: gold-rule eyebrow,
  // Alfa Slab title with deck period, body subtitle, BrandButton CTA.
  const renderHero = ({
    eyebrow,
    title,
    subtitle,
    cta,
  }: {
    eyebrow: string;
    title: string;
    subtitle: string;
    cta?: React.ReactNode;
  }) => (
    <View style={styles.heroContainer}>
      <View style={styles.heroEyebrowRow}>
        <View style={[styles.heroRule, { backgroundColor: c.gold }]} />
        <ThemedText
          type="varsitySmall"
          style={[styles.heroEyebrow, { color: c.gold }]}
        >
          {eyebrow}
        </ThemedText>
        <View style={[styles.heroRule, { backgroundColor: c.gold }]} />
      </View>
      <ThemedText
        type="display"
        style={[styles.heroTitle, { color: c.text }]}
        accessibilityRole="header"
      >
        {title}
      </ThemedText>
      <ThemedText style={[styles.heroSubtitle, { color: c.secondaryText }]}>
        {subtitle}
      </ThemedText>
      {cta ? <View style={styles.heroCta}>{cta}</View> : null}
    </View>
  );

  const finalPickEntry = useMemo(
    () => lotteryResults?.find((r) => r.lottery_position === 1) ?? null,
    [lotteryResults],
  );

  // Lottery rules footer — "Top N picks drawn at random; rest by standings."
  // Computed from `league.lottery_draws` (with backend's `Math.min(drawCount, poolSize)`
  // clamping, so degenerate league configs render sensibly).
  const rulesText = useMemo(() => {
    if (totalSlots === 0) return null;
    const draws = Math.min(league?.lottery_draws ?? 4, totalSlots);
    if (draws === 0) return 'No lottery — picks follow inverse standings.';
    if (draws >= totalSlots) {
      return `All ${totalSlots} picks drawn by weighted lottery.`;
    }
    if (draws === 1) {
      return 'Pick #1 is drawn by weighted lottery. Picks #2 and beyond follow inverse standings.';
    }
    return `Top ${draws} picks are drawn by weighted lottery. Picks #${draws + 1}–${totalSlots} follow inverse standings.`;
  }, [league?.lottery_draws, totalSlots]);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]} edges={['top', 'bottom']}>
      <PageHeader title="Draft Lottery" />

      <View style={styles.body}>
        {!lotteryResults ? (
          // Phase 1: Commissioner runs the lottery
          renderHero({
            eyebrow: 'Draft Night',
            title: 'The lottery awaits.',
            subtitle: isCommissioner
              ? 'When everyone is ready, run the lottery to determine the rookie draft order.'
              : 'Waiting for the commissioner to start the lottery.',
            cta: isCommissioner ? (
              isRunning ? (
                <View style={styles.spinnerWrap}>
                  <LogoSpinner size={22} delay={0} />
                </View>
              ) : (
                <BrandButton
                  label="Run Lottery"
                  onPress={handleRunLottery}
                  variant="primary"
                  fullWidth
                  accessibilityLabel="Run lottery"
                />
              )
            ) : null,
          })
        ) : !ceremonyStarted ? (
          // Phase 2: Results computed, commissioner starts the reveal ceremony
          renderHero({
            eyebrow: 'Ready',
            title: 'The picks are in.',
            subtitle: isCommissioner
              ? 'Start the reveal ceremony when everyone is watching.'
              : 'The lottery has been drawn. Waiting for the reveal to begin.',
            cta: isCommissioner ? (
              <BrandButton
                label="Begin Reveal"
                onPress={handleStartCeremony}
                variant="primary"
                fullWidth
                accessibilityLabel="Begin reveal"
              />
            ) : null,
          })
        ) : (
          // Phase 3: Reveal ceremony — sealed cards spin and lock per pick.
          <View style={styles.revealContainer}>
            <View style={styles.revealEyebrowRow}>
              <View style={[styles.heroRule, { backgroundColor: c.gold }]} />
              <ThemedText
                type="varsitySmall"
                style={[styles.heroEyebrow, { color: c.gold }]}
              >
                Reveal Ceremony · {revealedCount} of {totalSlots}
              </ThemedText>
            </View>

            {enrichedResults && (
              <PickList
                ref={pickListRef}
                results={enrichedResults}
                revealedCount={revealedCount}
                spinningPosition={spinningPosition}
                onSpinComplete={handleSpinComplete}
              />
            )}

            <View style={[styles.bottomBar, { borderTopColor: c.border }]}>
              {allRevealed ? (
                <>
                  <View style={styles.heroEyebrowRow}>
                    <View style={[styles.heroRule, { backgroundColor: c.gold }]} />
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.heroEyebrow, { color: c.gold }]}
                    >
                      Final
                    </ThemedText>
                    <View style={[styles.heroRule, { backgroundColor: c.gold }]} />
                  </View>
                  <ThemedText
                    type="display"
                    style={[styles.finalTitle, { color: c.text }]}
                    accessibilityRole="header"
                    numberOfLines={2}
                  >
                    {finalPickEntry?.team_name} gets the No. 1 pick.
                  </ThemedText>
                  <View style={styles.heroCta}>
                    <BrandButton
                      label="Done"
                      onPress={handleDone}
                      variant="primary"
                      fullWidth
                      accessibilityLabel="Done"
                    />
                  </View>
                </>
              ) : (
                <>
                  {rulesText ? (
                    <ThemedText
                      style={[styles.rules, { color: c.secondaryText }]}
                    >
                      {rulesText}
                    </ThemedText>
                  ) : null}
                  {isCommissioner ? (
                    <BrandButton
                      label={`Reveal Pick #${totalSlots - revealedCount}`}
                      onPress={handleRevealNext}
                      variant="primary"
                      fullWidth
                      disabled={spinningPosition !== null}
                      accessibilityLabel={`Reveal pick number ${totalSlots - revealedCount}`}
                    />
                  ) : (
                    <ThemedText
                      type="varsitySmall"
                      style={[styles.waiting, { color: c.secondaryText }]}
                    >
                      Waiting for next reveal…
                    </ThemedText>
                  )}
                </>
              )}
            </View>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },

  // Hero (phases 1 + 2) — gold-rule eyebrow framing, Alfa Slab title with
  // deck period, body subtitle, optional CTA. Mirrors the brand voice
  // used on prospect detail and the draft-complete banner.
  // The paddingBottom compensates for the PageHeader's top-of-screen
  // weight: without it, `flex:1` + `justifyContent:'center'` lands the
  // content at the body's geometric center, which sits visibly below
  // the screen's true center because the header eats top space.
  heroContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: s(32),
    paddingBottom: s(80),
  },
  heroEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginBottom: s(10),
  },
  heroRule: { height: 2, width: s(18) },
  heroEyebrow: { fontSize: ms(10), letterSpacing: 1.4 },
  heroTitle: {
    fontSize: ms(28),
    lineHeight: ms(32),
    letterSpacing: -0.4,
    textAlign: 'center',
  },
  heroSubtitle: {
    fontSize: ms(14),
    lineHeight: ms(20),
    textAlign: 'center',
    marginTop: s(10),
    marginBottom: s(20),
    maxWidth: s(320),
  },
  heroCta: {
    width: '100%',
    maxWidth: s(280),
    marginTop: s(4),
  },
  spinnerWrap: {
    paddingVertical: s(16),
  },

  // Reveal phase — list of cards with bottom CTA bar
  revealContainer: { flex: 1 },
  revealEyebrowRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(16),
    paddingTop: s(14),
    paddingBottom: s(8),
  },

  bottomBar: {
    paddingHorizontal: s(16),
    paddingTop: s(12),
    paddingBottom: s(16),
    borderTopWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    gap: s(8),
  },
  finalTitle: {
    fontSize: ms(22),
    lineHeight: ms(26),
    letterSpacing: -0.3,
    textAlign: 'center',
  },
  waiting: {
    fontSize: ms(11),
    letterSpacing: 1.2,
    paddingVertical: s(14),
  },
  rules: {
    fontSize: ms(11),
    lineHeight: ms(15),
    textAlign: 'center',
    maxWidth: s(320),
  },
});
