import DateTimePicker from '@react-native-community/datetimepicker';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  Share,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ManualDraftOrderModal } from '@/components/commissioner/ManualDraftOrderModal';
import { AnalyticsPreviewCard } from '@/components/home/AnalyticsPreviewCard';
import { ChampionCard } from '@/components/home/ChampionCard';
import { DeclareKeepers } from '@/components/home/DeclareKeepers';
import { HomeAnnouncementBanner } from '@/components/home/HomeAnnouncementBanner';
import { HomeHero, type HomeHeroVariant, type PaymentBadge } from '@/components/home/HomeHero';
import { LeagueSwitcher } from '@/components/home/LeagueSwitcher';
import { OffseasonLotteryOrder } from '@/components/home/OffseasonLotteryOrder';
import { QuickNav } from '@/components/home/QuickNav';
import { StandingsSection } from '@/components/home/StandingsSection';
import { BusyOverlay } from '@/components/ui/BusyOverlay';
import { ErrorState } from '@/components/ui/ErrorState';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { type ModalAction } from '@/components/ui/InlineAction';
import { LeagueMetaChips } from '@/components/ui/LeagueMetaChips';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { ThemedView } from '@/components/ui/ThemedView';
import { WebActivityCard } from '@/components/web/home/WebActivityCard';
import { WebMatchupCard } from '@/components/web/home/WebMatchupCard';
import { WebStandingsCard } from '@/components/web/home/WebStandingsCard';
import { Colors, Fonts } from '@/constants/Colors';
import { type Sport } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useActionPicker, useConfirm } from '@/context/ConfirmProvider';
import { useTotalUnread } from '@/hooks/chat';
import { useBreakpoint } from '@/hooks/useBreakpoint';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useOffseasonActions } from '@/hooks/useOffseasonActions';
import { usePaymentLedger, useSelfReportPayment } from '@/hooks/usePaymentLedger';
import { usePaymentLink } from '@/hooks/usePaymentLink';
import { usePlayoffBracket } from '@/hooks/usePlayoffBracket';
import { markSplashReady } from '@/lib/splashReady';
import { supabase } from '@/lib/supabase';
import { formatDateTimeWithZone } from '@/utils/dates';
import { computeOffseasonState } from '@/utils/league/offseasonState';
import { calcRounds } from '@/utils/league/playoff';
import { minSeasonStartForDraft } from '@/utils/league/seasonStart';
import { logger } from '@/utils/logger';
import { isIrEligibleStatus } from '@/utils/roster/illegalIR';
import { ms, s } from '@/utils/scale';

type HomeDraft = {
  id: string;
  type: string;
  status: string | null;
  draft_date: string | null;
};

// Per-step hero action mapping. Returns null for non-commissioners or
// steps that have no actionable commissioner move right now.
function computeOffseasonHeroAction({
  offseasonStep,
  leagueType,
  isCommissioner,
  rookieDraft,
  seasonDraft,
  actions,
}: {
  offseasonStep: string;
  leagueType: string;
  isCommissioner: boolean;
  rookieDraft: { status: string | null } | null;
  seasonDraft: { status: string | null } | null;
  actions: ReturnType<typeof useOffseasonActions>;
}): { label: string; onPress: () => void } | null {
  const isDynasty = leagueType === 'dynasty';

  // Lottery reveal is open to the whole league — anyone can come watch.
  // Returned BEFORE the commish gate so non-commish members also see this CTA.
  if (isDynasty && offseasonStep === 'lottery_revealing') {
    return { label: 'Watch the Reveal', onPress: actions.goToLotteryRoom };
  }

  if (!isCommissioner) return null;

  if (isDynasty && offseasonStep === 'lottery_pending') {
    return { label: 'Enter Lottery', onPress: actions.goToLotteryRoom };
  }

  if (
    isDynasty &&
    (offseasonStep === 'lottery_complete' || offseasonStep === 'rookie_draft_pending') &&
    !rookieDraft
  ) {
    return { label: 'Create Draft', onPress: actions.handleCreateRookieDraft };
  }

  if (leagueType === 'keeper' && offseasonStep === 'keeper_pending') {
    return { label: 'Finalize', onPress: actions.handleFinalizeKeepers };
  }

  if (
    !isDynasty &&
    offseasonStep === 'ready_for_new_season' &&
    !seasonDraft
  ) {
    return { label: 'Create Draft', onPress: actions.handleCreateSeasonDraft };
  }

  const canStartNewSeason =
    (isDynasty &&
      (offseasonStep === 'ready_for_new_season' ||
        offseasonStep === 'rookie_draft_complete')) ||
    (!isDynasty &&
      offseasonStep === 'ready_for_new_season' &&
      seasonDraft?.status === 'complete');
  if (canStartNewSeason) {
    return { label: 'Start Season', onPress: actions.handleStartNewSeason };
  }

  return null;
}

export default function HomeScreen() {
  const { data: league, isLoading, isError, refetch } = useLeague();
  const { teamId } = useAppState();
  const session = useSession();
  const isCommissioner = session?.user?.id === league?.created_by;
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { isDesktop } = useBreakpoint();
  const queryClient = useQueryClient();

  const router = useRouter();
  const { data: unreadCount } = useTotalUnread();
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pickAction = useActionPicker();
  const confirm = useConfirm();
  const payWithConfirm = usePaymentLink();

  // Draft schedule modal state — same pattern DraftSection used
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  // Active (not-complete) draft — drives draft_pending hero variant.
  const { data: activeDraft, isLoading: activeDraftLoading } = useQuery<HomeDraft | null>({
    queryKey: league ? queryKeys.activeDraft(league.id) : ['no-league-draft'],
    queryFn: async () => {
      if (!league) return null;
      const { data, error } = await supabase
        .from('drafts')
        .select('id, type, status, draft_date')
        .eq('league_id', league.id)
        .neq('status', 'complete')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as HomeDraft | null;
    },
    enabled: !!league?.id,
  });

  // Manual draft order: when the league picked `manual` for initial draft
  // order, the commissioner must explicitly set the team-by-team order
  // before scheduling. Slots-assigned check uses round-1 picks because
  // a team's slot is unchanged across rounds.
  const isManualOrder = league?.initial_draft_order === 'manual';
  const isInitialDraft = activeDraft?.type === 'initial';
  const { data: slotsAssigned } = useQuery({
    queryKey: activeDraft?.id ? queryKeys.draftSlotsAssigned(activeDraft.id) : ['no-draft-slots'],
    queryFn: async () => {
      if (!activeDraft?.id) return false;
      const { count, error } = await supabase
        .from('draft_picks')
        .select('id', { count: 'exact', head: true })
        .eq('draft_id', activeDraft.id)
        .eq('round', 1)
        .not('current_team_id', 'is', null);
      if (error) throw error;
      return (count ?? 0) > 0;
    },
    enabled: !!activeDraft?.id && isManualOrder && isInitialDraft,
  });
  const [showOrderModal, setShowOrderModal] = useState(false);

  // Rookie + seasonal draft existence lookups — only needed during
  // offseason to pick the right hero action (create vs start).
  const leagueType = league?.league_type ?? 'dynasty';
  const isDynastyLeague = leagueType === 'dynasty';
  const { data: rookieDraft } = useQuery({
    queryKey: league
      ? queryKeys.rookieDraft(league.id, league.season as unknown as number)
      : ['no-rookie-draft'],
    queryFn: async () => {
      if (!league) return null;
      const { data } = await supabase
        .from('drafts')
        .select('id, status, draft_date')
        .eq('league_id', league.id)
        .eq('season', league.season)
        .eq('type', 'rookie')
        .maybeSingle();
      return data;
    },
    enabled: !!league?.id && isDynastyLeague && !!league?.offseason_step,
  });
  const { data: seasonDraft } = useQuery({
    queryKey: league
      ? queryKeys.seasonDraft(league.id, league.season as unknown as number)
      : ['no-season-draft'],
    queryFn: async () => {
      if (!league) return null;
      const { data } = await supabase
        .from('drafts')
        .select('id, status, draft_date')
        .eq('league_id', league.id)
        .eq('season', league.season)
        .eq('type', 'initial')
        .maybeSingle();
      return data;
    },
    enabled:
      !!league?.id &&
      !isDynastyLeague &&
      league?.offseason_step === 'ready_for_new_season',
  });

  // Offseason action handlers — drives the hero's contextual action pill
  // (Enter Lottery / Finalize / Create Draft / Start Season).
  const offseasonActions = useOffseasonActions({
    leagueId: league?.id ?? '',
    season: league?.season ?? '',
    isDynasty: isDynastyLeague,
  });

  // Dynasty roster-cap overage — returns both the aggregate count (how
  // many teams are over) and this user's specific overage (how much
  // *their* team is over, if at all). The hero decides which to surface:
  // a personal warning whenever the user's own roster is over, or an
  // aggregate warning to the commissioner on the final step.
  //
  // Players legitimately on IR (roster_slot='IR' AND injury status is
  // IR-eligible) are excluded from the count — a team can park actually-
  // hurt players on IR without triggering the cap warning. Players who
  // are illegally on IR (healthy) still count, so the cap can't be gamed
  // by stashing healthy bodies there.
  const { data: overage } = useQuery({
    queryKey: league ? ['rosterOverage', league.id] : ['no-overage'],
    queryFn: async () => {
      if (!league) return { overageCount: 0, myOverBy: 0 };
      const [{ data: teams }, { data: rows }] = await Promise.all([
        supabase.from('teams').select('id').eq('league_id', league.id),
        supabase
          .from('league_players')
          .select('team_id, roster_slot, players!inner(status)')
          .eq('league_id', league.id),
      ]);
      if (!teams || !rows) return { overageCount: 0, myOverBy: 0 };
      const counts = new Map<string, number>();
      for (const p of rows as {
        team_id: string;
        roster_slot: string | null;
        players: { status: string | null } | { status: string | null }[] | null;
      }[]) {
        const playerRow = Array.isArray(p.players) ? p.players[0] : p.players;
        const status = playerRow?.status ?? null;
        if (p.roster_slot === 'IR' && isIrEligibleStatus(status)) continue;
        counts.set(p.team_id, (counts.get(p.team_id) ?? 0) + 1);
      }
      const cap = league.roster_size ?? 13;
      let overageCount = 0;
      for (const t of teams) {
        if ((counts.get(t.id) ?? 0) > cap) overageCount++;
      }
      const myCount = teamId ? (counts.get(teamId) ?? 0) : 0;
      const myOverBy = Math.max(0, myCount - cap);
      return { overageCount, myOverBy };
    },
    enabled: !!league?.id && isDynastyLeague && !!league?.offseason_step,
  });
  const overageCount = overage?.overageCount ?? 0;
  const myOverBy = overage?.myOverBy ?? 0;

  // Payment ledger for this league/season — drives inline dues badge.
  const { data: paymentLedger } = usePaymentLedger(
    league?.id ?? null,
    league?.season ?? null,
  );
  const selfReport = useSelfReportPayment(league?.id ?? '', league?.season ?? '');

  const myTeam = useMemo(() => {
    if (!league || !teamId) return null;
    const teams = (league.league_teams as {
      id: string;
      name: string;
      tricode: string | null;
      wins: number | null;
      losses: number | null;
      ties: number | null;
    }[]) ?? [];
    return teams.find((t) => t.id === teamId) ?? null;
  }, [league, teamId]);

  const paymentBadge: PaymentBadge = useMemo(() => {
    if (!league || !teamId) return null;
    if (isCommissioner) return null;
    if (!league.buy_in_amount) return null;
    const myPayment = paymentLedger?.find((p) => p.team_id === teamId);
    const status = myPayment?.status ?? 'unpaid';
    if (status === 'confirmed') return null;
    if (status === 'self_reported') return { state: 'pending' };
    const hasPaymentMethods = !!(
      league.venmo_username ||
      league.cashapp_tag ||
      league.paypal_username
    );
    if (!hasPaymentMethods) return null;
    return { state: 'due', amount: league.buy_in_amount };
  }, [league, teamId, isCommissioner, paymentLedger]);

  const isOffseason = !!league?.offseason_step;
  const isImportedNotStarted =
    !!league?.imported_from && !league?.schedule_generated && !isOffseason;

  // Imported leagues can be created with "finish rosters later" placeholder
  // teams — those have zero league_players. Nudge the commissioner (only) to
  // finish importing before the season/rookie draft proceeds. Gated on
  // `imported_from` so a normal pre-draft league (all teams empty until the
  // draft fills them) never trips this. The count is already on the cached
  // league payload, so no extra query.
  const rostersPending = useMemo(() => {
    if (!isCommissioner || !league?.imported_from) return null;
    const teams =
      (league.league_teams as { league_players?: { count: number }[] }[] | null) ?? [];
    const count = teams.filter(
      (t) => (t.league_players?.[0]?.count ?? 0) === 0,
    ).length;
    if (count === 0) return null;
    return { count, onPress: () => router.push('/league-info' as never) };
  }, [isCommissioner, league, router]);

  // Claim progress for imported leagues in setup — powers the
  // invite_needed hero's "X/Y Claimed" eyebrow. Replaces the data
  // query that used to live in ImportedLeagueSection; we lifted it
  // up here so the hero can render the progress inline without
  // duplicating the fetch.
  const { data: claimStatus } = useQuery({
    queryKey: queryKeys.importedTeamStatus(league?.id ?? ''),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('teams')
        .select('user_id')
        .eq('league_id', league!.id);
      if (error) throw error;
      const total = (data ?? []).length;
      const claimed = (data ?? []).filter((t) => t.user_id !== null).length;
      return { total, claimed };
    },
    enabled: isImportedNotStarted && !!league?.id,
  });

  // "Season complete" == playoffs finished, but the commissioner hasn't
  // tapped Advance Season yet (which is what sets champion_team_id +
  // offseason_step in one shot via the edge function). The only signal
  // we have before advance runs is the championship bracket slot having
  // a winner_id, written by finalize-week when the final game settles.
  const { data: bracket, isLoading: bracketLoading } = usePlayoffBracket(
    league?.season ?? '',
  );

  // Signal the SplashGate to hide once the home's variant-deciding
  // queries have settled. Before this, the native splash held on just
  // auth + app-state readiness, which meant the hero would render with
  // undefined activeDraft/bracket for a beat and flash. Now the splash
  // stays put until we know which variant to paint.
  useEffect(() => {
    const leagueSettled = !isLoading; // useLeague has loaded (data or null)
    if (leagueSettled && !activeDraftLoading && !bracketLoading) {
      markSplashReady();
    }
  }, [isLoading, activeDraftLoading, bracketLoading]);
  // The decided championship winner from the bracket's final round. We key
  // off calcRounds (the true bracket depth) rather than the max round present
  // so an intermediate round completing mid-playoffs can't read as "season
  // complete", and we filter out bye + 3rd-place slots so we crown the actual
  // title winner regardless of slot ordering (mirrors advance-season, which is
  // what will later stamp leagues.champion_team_id).
  const championId = useMemo(() => {
    if (!bracket || bracket.length === 0) return null;
    const totalRounds = calcRounds(league?.playoff_teams ?? 8);
    const finalSlot = bracket.find(
      (s) => s.round === totalRounds && !s.is_bye && !s.is_third_place,
    );
    return finalSlot?.winner_id ?? null;
  }, [bracket, league?.playoff_teams]);
  const playoffsComplete = !!championId;
  const isSeasonComplete =
    !isOffseason && (playoffsComplete || !!league?.champion_team_id);

  // Resolve the champion team's display fields once for both the hero eyebrow
  // and the ChampionCard. Prefer the live bracket winner (available before
  // advance-season runs); fall back to champion_team_id for the brief window
  // where it's set but we're still painting season_complete.
  const champion = useMemo(() => {
    const id = championId ?? league?.champion_team_id ?? null;
    if (!id) return null;
    const teamsArr = (league?.league_teams ?? []) as {
      id: string;
      name: string;
      tricode: string | null;
      logo_key: string | null;
    }[];
    const team = teamsArr.find((t) => t.id === id);
    if (!team) return null;
    return { id, name: team.name, tricode: team.tricode, logoKey: team.logo_key };
  }, [championId, league?.champion_team_id, league?.league_teams]);

  const heroVariant: HomeHeroVariant | null = useMemo(() => {
    if (!league) return null;
    // Wait for the variant-deciding queries to settle before committing
    // to a hero. Otherwise the hero briefly flashes team_identity with
    // stale/empty state (e.g. showing a 0-0 record) before the bracket
    // or active-draft query resolves and flips us into season_complete
    // or draft_pending.
    if (activeDraftLoading || bracketLoading) return null;

    if (isSeasonComplete) {
      // Eyebrow shows the champion's tricode; the ChampionCard below the hero
      // carries the full name + logo. Both read from the shared `champion`.
      const championName = champion?.tricode ?? champion?.name ?? null;

      return {
        kind: 'season_complete',
        leagueName: league.name,
        season: league.season,
        championName,
        myTeam,
        action: isCommissioner
          ? { label: 'Advance Season', onPress: offseasonActions.advanceSeason }
          : null,
      };
    }

    // Draft takes over the hero whenever one exists — regular season
    // OR offseason. Previously we gated on `!isOffseason`, which meant
    // rookie-draft scheduling rendered in a standalone DraftSection card
    // below the offseason stepper. Consolidating here so the hero owns
    // every draft moment with the same Schedule/Reschedule/Enter pattern.
    if (!isImportedNotStarted && activeDraft) {
      const scheduledDate = activeDraft.draft_date
        ? new Date(activeDraft.draft_date)
        : null;
      const slotsOpen = league.teams - (league.current_teams ?? 0);
      const leagueFull = slotsOpen === 0;
      const isReadyToEnter =
        leagueFull &&
        (activeDraft.status === 'in_progress' ||
          (scheduledDate
            ? scheduledDate.getTime() - Date.now() <= 30 * 60 * 1000
            : false));
      const invite =
        isCommissioner && slotsOpen > 0 && !isOffseason
          ? { code: league.invite_code, slotsOpen }
          : null;
      return {
        kind: 'draft_pending',
        season: league.season,
        draftType: activeDraft.type,
        draftDate: activeDraft.draft_date ?? null,
        isReadyToEnter,
        isCommissioner,
        invite,
        payment: paymentBadge ?? undefined,
        manualOrder:
          isManualOrder && activeDraft.type === 'initial'
            ? { slotsAssigned: !!slotsAssigned }
            : null,
      };
    }

    if (isOffseason) {
      const { stepIndex, stepCount, stepLabel, nextStepLabel } =
        computeOffseasonState(
          league.league_type ?? 'dynasty',
          league.rookie_draft_order ?? 'reverse_record',
          league.offseason_step!,
        );
      const action = computeOffseasonHeroAction({
        offseasonStep: league.offseason_step!,
        leagueType: league.league_type ?? 'dynasty',
        isCommissioner,
        rookieDraft: rookieDraft ?? null,
        seasonDraft: seasonDraft ?? null,
        actions: offseasonActions,
      });
      // Warning scoping:
      //  1. Personal beats aggregate — if THIS user's team is over, show
      //     that directly so they know to make cuts. Always visible on
      //     every offseason step.
      //  2. Aggregate is commissioner-only, and only when Start Season
      //     is the live action (otherwise it's noise — the overage isn't
      //     blocking anything yet).
      let warning:
        | { scope: 'personal'; overBy: number; onPress?: () => void }
        | { scope: 'aggregate'; count: number; onPress?: () => void }
        | null = null;
      if (isDynastyLeague) {
        if (myOverBy > 0) {
          warning = {
            scope: 'personal',
            overBy: myOverBy,
            onPress: () => router.push('/(tabs)/roster' as never),
          };
        } else if (
          isCommissioner &&
          overageCount > 0 &&
          action?.label === 'Start Season'
        ) {
          warning = { scope: 'aggregate', count: overageCount };
        }
      }
      return {
        kind: 'offseason',
        season: league.season,
        stepIndex,
        stepCount,
        stepLabel,
        nextStepLabel,
        action,
        warning,
      };
    }

    // Imported leagues in setup: show invite_needed with a claim
    // progress readout ("X/Y Claimed"). "Slots remaining" for
    // imports is the count of unclaimed pre-created teams.
    if (
      isImportedNotStarted &&
      isCommissioner &&
      league.invite_code &&
      claimStatus &&
      claimStatus.claimed < claimStatus.total
    ) {
      return {
        kind: 'invite_needed',
        inviteCode: league.invite_code,
        season: league.season,
        slotsRemaining: claimStatus.total - claimStatus.claimed,
        claimProgress: claimStatus,
      };
    }

    const slotsRemaining = league.teams - (league.current_teams ?? 0);
    if (
      isCommissioner &&
      slotsRemaining > 0 &&
      !isOffseason &&
      !isImportedNotStarted &&
      !activeDraft
    ) {
      return {
        kind: 'invite_needed',
        inviteCode: league.invite_code,
        season: league.season,
        slotsRemaining,
      };
    }

    if (myTeam) {
      return {
        kind: 'team_identity',
        team: myTeam,
        leagueType: league.league_type ?? 'dynasty',
        season: league.season,
        payment: paymentBadge ?? undefined,
      };
    }

    return null;
  }, [
    league,
    myTeam,
    activeDraft,
    rookieDraft,
    seasonDraft,
    champion,
    offseasonActions,
    overageCount,
    myOverBy,
    isDynastyLeague,
    isSeasonComplete,
    isOffseason,
    isImportedNotStarted,
    claimStatus,
    isCommissioner,
    paymentBadge,
    isManualOrder,
    slotsAssigned,
    router,
    activeDraftLoading,
    bracketLoading,
  ]);

  const onHeroPress = () => {
    if (!heroVariant) return;
    switch (heroVariant.kind) {
      case 'season_complete':
        router.push('/playoff-bracket');
        break;
      case 'draft_pending':
        // Once the draft is live, the whole hero drops straight into the room.
        // The draft hub is a dynasty/future-picks surface that doesn't exist in
        // redraft leagues, so it's the wrong target mid-draft.
        if (activeDraft?.status === 'in_progress') {
          onEnterDraft();
        } else {
          router.push('/draft-hub' as never);
        }
        break;
      case 'invite_needed':
        router.push('/league-info' as never);
        break;
      case 'team_identity':
        router.push('/(tabs)/roster' as never);
        break;
      case 'offseason':
        // Not tappable — the contextual action pill on the eyebrow
        // handles the commissioner move; the card body itself is
        // informational.
        break;
    }
  };

  // ── Draft actions ──────────────────────────────────────────────────

  const onEnterDraft = () => {
    if (activeDraft?.id) {
      router.push(`/draft-room/${activeDraft.id}` as never);
    }
  };

  const onSchedulePress = () => {
    // Manual draft order leagues must have the order set before the
    // draft can be scheduled — otherwise the commissioner could lock in
    // a date with no team-to-slot mapping. Hero shows a separate "Set
    // Order" pill in this state; we belt-and-suspender it here too.
    if (isManualOrder && activeDraft?.type === 'initial' && !slotsAssigned) {
      Alert.alert('Set Draft Order', 'You need to set the draft order before scheduling the draft.');
      return;
    }
    setSelectedDate(activeDraft?.draft_date ? new Date(activeDraft.draft_date) : null);
    setShowDatePicker(true);
  };

  const handleDateChange = (event: { type: string }, date?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'set' && date) {
        setSelectedDate(date);
        confirmSchedule(date);
      }
      return;
    }
    if (event.type === 'set' && date) {
      setSelectedDate(date);
    }
  };

  const confirmSchedule = async (date: Date | null) => {
    const target = date ?? selectedDate;
    if (!target || !activeDraft || !league) return;
    const rounded = new Date(target);
    rounded.setSeconds(0, 0);
    const startTime = rounded.toISOString();

    // Fantasy scoring can't begin on or before the draft, can't begin
    // before the IRL season's opening night, and Week 1 must be ≥ 5 days.
    // See minSeasonStartForDraft for the full stack.
    const minSeasonStart = minSeasonStartForDraft({
      sport: league.sport,
      season: league.season,
      draftDate: rounded,
    });
    const currentStart = league.season_start_date as string | null;
    const bumpedSeasonStart =
      !currentStart || currentStart < minSeasonStart ? minSeasonStart : null;

    const { error } = await supabase
      .from('drafts')
      .update({ status: 'pending', draft_date: startTime })
      .eq('id', activeDraft.id);
    if (error) {
      Alert.alert('Error', 'Failed to schedule draft');
      return;
    }

    if (bumpedSeasonStart) {
      const { error: seasonErr } = await supabase
        .from('leagues')
        .update({ season_start_date: bumpedSeasonStart })
        .eq('id', league.id);
      if (seasonErr) {
        Alert.alert(
          'Heads up',
          'Draft scheduled, but the season start date couldn\'t be auto-adjusted. Set it manually in League Info → Season Settings.',
        );
      } else {
        Alert.alert(
          'Season start adjusted',
          `Season Day 1 moved to ${bumpedSeasonStart} so games played before the draft finishes don\'t count.`,
        );
        queryClient.invalidateQueries({ queryKey: queryKeys.league(league.id) });
      }
    }

    // Notify the rest of the league that a time is set — the home hero has no
    // live link to the drafts table, so without this members sit on a stale
    // hero until they reopen/refresh. The time is shown in the commissioner's
    // zone WITH a label so it reads unambiguously across timezones. Best-effort:
    // a push failure must never block scheduling (send-notification excludes the
    // caller and respects each member's notification prefs).
    try {
      await supabase.functions.invoke('send-notification', {
        body: {
          league_id: league.id,
          category: 'draft',
          title: 'Draft Scheduled',
          body: `The ${activeDraft.type} draft is set for ${formatDateTimeWithZone(rounded)}.`,
          data: { screen: 'home', draft_date: startTime },
        },
      });
    } catch (e) {
      logger.error('draft-scheduled push failed (non-fatal)', e);
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(league.id) });
    setShowDatePicker(false);
    setSelectedDate(null);
  };

  // Pull-to-refresh: re-fetch every query the home screen is currently
  // showing (league, active draft, bracket, offseason lookups, …) so the hero
  // re-derives from fresh data. The manual escape hatch for the lack of a
  // realtime link on the draft/league rows.
  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await queryClient.refetchQueries({ type: 'active' });
    } finally {
      setIsRefreshing(false);
    }
  }, [queryClient]);

  // ── Invite actions ─────────────────────────────────────────────────

  const onShareInvite = async () => {
    if (!league?.invite_code) return;
    const link = `franchisev2://join?code=${league.invite_code}`;
    try {
      await Share.share({
        message: `Join my league on Franchise! Use invite code: ${league.invite_code}\n\nOr tap to join: ${link}`,
      });
    } catch {
      // share sheet dismissed — no-op
    }
  };

  // ── Payment prompt (same UX as the old PaymentNudge) ───────────────

  const promptMarkPaid = () => {
    confirm({
      title: 'Mark as Paid?',
      message: 'The commissioner will be notified to confirm your payment.',
      action: {
        label: 'I Paid',
        onPress: () => teamId && selfReport.mutate({ teamId }),
      },
    });
  };

  const onPaymentPress = () => {
    if (!league || !teamId) return;
    const status =
      paymentLedger?.find((p) => p.team_id === teamId)?.status ?? 'unpaid';
    if (status === 'self_reported') return;
    const paymentActions: ModalAction[] = [
      {
        id: 'venmo',
        label: 'Pay via Venmo',
        icon: 'wallet-outline',
        hidden: !league.venmo_username,
        onPress: () =>
          payWithConfirm('venmo', league.venmo_username!, {
            amount: league.buy_in_amount!,
            note: `${league.name} buy-in`,
          }),
      },
      {
        id: 'paypal',
        label: 'Pay via PayPal',
        icon: 'card-outline',
        hidden: !league.paypal_username,
        onPress: () =>
          payWithConfirm('paypal', league.paypal_username!, {
            amount: league.buy_in_amount!,
          }),
      },
      {
        id: 'cashapp',
        label: 'Pay via Cash App',
        icon: 'cash-outline',
        hidden: !league.cashapp_tag,
        onPress: () => payWithConfirm('cashapp', league.cashapp_tag!),
      },
      {
        id: 'mark-paid',
        label: 'I Already Paid',
        icon: 'checkmark-done-outline',
        onPress: promptMarkPaid,
      },
    ];
    pickAction({
      title: league.buy_in_amount ? `$${league.buy_in_amount} Buy-In` : 'Buy-In',
      subtitle: 'CHOOSE A PAYMENT OPTION',
      actions: paymentActions,
    });
  };

  const handleChatPress = () => router.push('/chat');

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      {/* On desktop web the sidebar carries the league switcher + chat, so the
          floating mobile header is hidden — the content starts at the top. */}
      {!isDesktop && (
      <ThemedView style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity
          style={styles.leagueSwitcher}
          onPress={() => setSwitcherVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Switch league"
          accessibilityHint="Opens league switcher"
        >
          <IconSymbol name="chevron.down" size={20} color={c.icon} accessible={false} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.headerTitleHit}
          onPress={() => setSwitcherVisible(true)}
          accessibilityRole="button"
          accessibilityLabel="Switch league"
          accessibilityHint="Opens league switcher"
        >
          <ThemedText
            type="varsity"
            style={[styles.headerText, { color: c.secondaryText }]}
            numberOfLines={1}
          >
            {isLoading ? 'Loading' : league?.name ?? 'Franchise'}
          </ThemedText>
          {league && (
            <LeagueMetaChips
              sport={league.sport}
              leagueType={league.league_type}
              scoringType={league.scoring_type}
              size="small"
              style={styles.headerChips}
            />
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.chatButton}
          onPress={handleChatPress}
          accessibilityRole="button"
          accessibilityLabel={`Chat${(unreadCount ?? 0) > 0 ? `, ${unreadCount! > 99 ? '99+' : unreadCount} unread` : ''}`}
        >
          <IconSymbol name="bubble.right" size={20} color={c.icon} accessible={false} />
          {(unreadCount ?? 0) > 0 && (
            <View style={[styles.unreadBadge, { backgroundColor: c.danger }]} accessible={false}>
              <ThemedText style={[styles.unreadText, { color: c.statusText }]}>
                {unreadCount! > 99 ? '99+' : unreadCount}
              </ThemedText>
            </View>
          )}
        </TouchableOpacity>
      </ThemedView>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            tintColor={c.accent}
          />
        }
      >
        {isLoading ? (
          <View style={{ marginTop: 20 }}>
            <LogoSpinner />
          </View>
        ) : league ? (
          isDesktop ? (
            /* Desktop web dashboard: full-width hero on top, then a main
               content column + right Explore rail. Uses the SAME cards and
               props as the mobile stack directly below — keep the two in sync
               when either changes (native renders the mobile branch). */
            <>
              <HomeAnnouncementBanner
                sport={league.sport as Sport}
                leagueType={league.league_type}
                scoringType={league.scoring_type}
              />
              {activeDraft?.id && league?.id && isCommissioner && isManualOrder && (
                <ManualDraftOrderModal
                  visible={showOrderModal}
                  onClose={() => {
                    setShowOrderModal(false);
                    queryClient.invalidateQueries({ queryKey: queryKeys.draftSlotsAssigned(activeDraft.id) });
                  }}
                  leagueId={league.id}
                  draftId={activeDraft.id}
                />
              )}
              <BusyOverlay
                visible={offseasonActions.loading}
                title={offseasonActions.loadingLabel ?? 'Working…'}
              />
              {/* Two-column masonry. Left column leads with the live matchup
                  (regular season) or the contextual HomeHero (every other state),
                  then standings. Right rail stacks analytics + the activity feed.
                  Each column flows independently so neither leaves a mid-page gap.
                  Nav lives in the sidebar now, so there's no Explore grid here. */}
              <View style={styles.dashRow}>
                <View style={styles.dashMain}>
                  {heroVariant?.kind === 'team_identity' ? (
                    <WebMatchupCard />
                  ) : (
                    <>
                      {heroVariant && (
                        <HomeHero
                          variant={heroVariant}
                          onPress={heroVariant.kind === 'offseason' ? undefined : onHeroPress}
                          onPaymentPress={onPaymentPress}
                          onSchedulePress={onSchedulePress}
                          onEnterDraft={onEnterDraft}
                          onSetDraftOrder={() => setShowOrderModal(true)}
                          onShareInvite={onShareInvite}
                          rostersPending={rostersPending}
                        />
                      )}
                      {isSeasonComplete && champion && (
                        <ChampionCard
                          teamName={champion.name}
                          logoKey={champion.logoKey}
                          tricode={champion.tricode}
                          season={league.season}
                        />
                      )}
                    </>
                  )}
                  {isOffseason ? (
                    <OffseasonLotteryOrder
                      leagueId={league.id}
                      playoffTeams={league.playoff_teams ?? 0}
                      lotteryOdds={(league.lottery_odds as number[] | null) ?? null}
                      rookieDraftOrder={league.rookie_draft_order ?? 'reverse_record'}
                      offseasonStep={league.offseason_step!}
                      season={league.season}
                    />
                  ) : (
                    <WebStandingsCard
                      leagueId={league.id}
                      playoffTeams={league.playoff_teams}
                      scoringType={league.scoring_type}
                      tiebreakerOrder={league.tiebreaker_order}
                    />
                  )}
                </View>
                <View style={styles.dashRail}>
                  <AnalyticsPreviewCard leagueId={league.id} scoringType={league.scoring_type} />
                  {isOffseason && leagueType === 'keeper' &&
                    league.offseason_step === 'keeper_pending' && teamId && (
                      <DeclareKeepers
                        leagueId={league.id}
                        teamId={teamId}
                        season={league.season}
                        keeperCount={league.keeper_count ?? 5}
                        isCommissioner={isCommissioner}
                      />
                    )}
                  <WebActivityCard />
                </View>
              </View>
            </>
          ) : (
          <>
            {/* CMS-driven marketing/announcement banner — below the header
                tabs, above the team card. Themed per-sport, targeted, and
                dismissible; renders nothing when no banner is live. */}
            <HomeAnnouncementBanner
              sport={league.sport as Sport}
              leagueType={league.league_type}
              scoringType={league.scoring_type}
            />
            {heroVariant && (
              <HomeHero
                variant={heroVariant}
                onPress={
                  heroVariant.kind === 'offseason' ? undefined : onHeroPress
                }
                onPaymentPress={onPaymentPress}
                onSchedulePress={onSchedulePress}
                onEnterDraft={onEnterDraft}
                onSetDraftOrder={() => setShowOrderModal(true)}
                onShareInvite={onShareInvite}
                rostersPending={rostersPending}
              />
            )}
            {/* Manual draft order — commissioner-only modal. Rendered
                here so it lives at the page root and reliably captures
                taps from the hero's "Set Order" pill. */}
            {activeDraft?.id && league?.id && isCommissioner && isManualOrder && (
              <ManualDraftOrderModal
                visible={showOrderModal}
                onClose={() => {
                  setShowOrderModal(false);
                  queryClient.invalidateQueries({ queryKey: queryKeys.draftSlotsAssigned(activeDraft.id) });
                }}
                leagueId={league.id}
                draftId={activeDraft.id}
              />
            )}

            {/* Unmissable busy state for slow commissioner edge functions
                (advance-season, create rookie draft, finalize keepers, start
                season). Replaces the silent corner action pill that led to
                double-taps. */}
            <BusyOverlay
              visible={offseasonActions.loading}
              title={offseasonActions.loadingLabel ?? 'Working…'}
            />

            {/* Analytics sits right under the hero — both are about the
                user's roster, so keep the personal/zoomed-in content
                together before the wider explore + league sections. */}
            <AnalyticsPreviewCard leagueId={league.id} scoringType={league.scoring_type} />

            {/* Offseason sub-features now that the full OffseasonDashboard
                is gone. The hero timeline + action pill handle the stepper
                and primary CTA; these two components cover cases the pill
                can't (picking keepers, scheduling an already-created draft). */}
            {isOffseason && leagueType === 'keeper' &&
              league.offseason_step === 'keeper_pending' && teamId && (
                <DeclareKeepers
                  leagueId={league.id}
                  teamId={teamId}
                  season={league.season}
                  keeperCount={league.keeper_count ?? 5}
                  isCommissioner={isCommissioner}
                />
              )}
            <QuickNav leagueType={league.league_type ?? 'dynasty'} />

            {/* Season's over but the commissioner hasn't advanced yet —
                crown the champion prominently above standings, since the
                hero only carries a small tricode and the offseason UI (with
                its own champion surfaces) hasn't taken over the body yet. */}
            {isSeasonComplete && champion && (
              <ChampionCard
                teamName={champion.name}
                logoKey={champion.logoKey}
                tricode={champion.tricode}
                season={league.season}
              />
            )}

            {isOffseason ? (
              <OffseasonLotteryOrder
                leagueId={league.id}
                playoffTeams={league.playoff_teams ?? 0}
                lotteryOdds={(league.lottery_odds as number[] | null) ?? null}
                rookieDraftOrder={league.rookie_draft_order ?? 'reverse_record'}
                offseasonStep={league.offseason_step!}
                season={league.season}
              />
            ) : (
              <StandingsSection
                leagueId={league.id}
                playoffTeams={league.playoff_teams}
                scoringType={league.scoring_type}
                tiebreakerOrder={league.tiebreaker_order}
                divisionCount={league.division_count}
                division1Name={league.division_1_name}
                division2Name={league.division_2_name}
              />
            )}
          </>
          )
        ) : isError ? (
          <ErrorState message="Failed to load league data" onRetry={() => refetch()} />
        ) : null}
      </ScrollView>
      <LeagueSwitcher visible={switcherVisible} onClose={() => setSwitcherVisible(false)} />

      {/* Draft schedule modal — iOS shows a spinner + confirm button;
          Android uses the native dialog that fires on date change. */}
      {showDatePicker && Platform.OS === 'ios' && (
        <Modal
          animationType="fade"
          transparent
          visible={showDatePicker}
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={styles.modalOverlay}>
            <ThemedView style={[styles.modalContent, { backgroundColor: c.card }]}>
              <ThemedText type="sectionLabel" style={styles.modalTitle}>
                {activeDraft?.draft_date ? 'Reschedule Draft' : 'Schedule Draft'}
              </ThemedText>
              <DateTimePicker
                value={selectedDate ?? new Date()}
                mode="datetime"
                display="spinner"
                onChange={handleDateChange}
                minimumDate={new Date()}
              />
              <View style={styles.modalButtons}>
                <TouchableOpacity
                  style={[styles.modalButton, { backgroundColor: c.cardAlt, borderColor: c.border }]}
                  onPress={() => {
                    setShowDatePicker(false);
                    setSelectedDate(null);
                  }}
                >
                  <ThemedText type="varsitySmall" style={{ color: c.text }}>
                    Cancel
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    {
                      backgroundColor: selectedDate ? c.gold : c.buttonDisabled,
                    },
                  ]}
                  onPress={() => confirmSchedule(null)}
                  disabled={!selectedDate}
                >
                  <ThemedText type="varsitySmall" style={{ color: Colors.light.text }}>
                    Confirm
                  </ThemedText>
                </TouchableOpacity>
              </View>
            </ThemedView>
          </View>
        </Modal>
      )}
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={selectedDate ?? new Date()}
          mode="datetime"
          onChange={handleDateChange}
          minimumDate={new Date()}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Desktop web dashboard: [wide main column | capped rail], each flowing
  // independently. Only used on the isDesktop branch; native never references it.
  dashRow: {
    flexDirection: 'row',
    gap: 24,
    alignItems: 'flex-start',
  },
  dashMain: {
    flex: 1.4,
    minWidth: 0,
  },
  dashRail: {
    flex: 1,
    minWidth: 0,
    maxWidth: 420,
  },
  header: {
    flexDirection: 'row',
    padding: s(8),
    borderBottomWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    minHeight: s(50),
    justifyContent: 'space-between',
  },
  headerTitleHit: {
    flex: 1,
    marginHorizontal: s(40),
    alignItems: 'center',
  },
  headerText: {
    textAlign: 'center',
    fontFamily: Fonts.varsityBold,
    fontSize: ms(12),
    letterSpacing: 1.2,
  },
  headerChips: {
    justifyContent: 'center',
    marginTop: s(5),
  },
  leagueSwitcher: {
    padding: s(8),
    marginLeft: s(4),
    width: s(36),
    alignItems: 'center',
  },
  chatButton: {
    padding: s(8),
    marginRight: s(4),
    width: s(36),
    alignItems: 'center',
  },
  unreadBadge: {
    position: 'absolute',
    top: s(2),
    right: 0,
    minWidth: s(16),
    height: s(16),
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: s(4),
  },
  unreadText: {
    fontSize: ms(10),
    fontWeight: '700',
    lineHeight: ms(16),
    includeFontPadding: false,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: s(20),
    paddingTop: s(16),
    paddingBottom: s(40),
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: s(24),
  },
  modalContent: {
    width: '100%',
    maxWidth: s(360),
    borderRadius: 14,
    paddingHorizontal: s(20),
    paddingTop: s(20),
    paddingBottom: s(16),
  },
  modalTitle: {
    textAlign: 'center',
    marginBottom: s(8),
  },
  modalButtons: {
    flexDirection: 'row',
    gap: s(10),
    marginTop: s(12),
  },
  modalButton: {
    flex: 1,
    paddingVertical: s(12),
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'transparent',
  },
});
