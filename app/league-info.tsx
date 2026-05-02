import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { UpgradeModal } from '@/components/account/UpgradeModal';
import { LeagueNotificationModal } from '@/components/banners/LeagueNotificationModal';
import { AssignDivisionsModal } from '@/components/commissioner/AssignDivisionsModal';
import { EditBasicsModal } from '@/components/commissioner/EditBasicsModal';
import { EditDraftSettingsModal } from '@/components/commissioner/EditDraftSettingsModal';
import { EditRosterModal } from '@/components/commissioner/EditRosterModal';
import { EditScoringModal } from '@/components/commissioner/EditScoringModal';
import { EditSeasonSettingsModal } from '@/components/commissioner/EditSeasonSettingsModal';
import { EditTradeSettingsModal } from '@/components/commissioner/EditTradeSettingsModal';
import { EditWaiverSettingsModal } from '@/components/commissioner/EditWaiverSettingsModal';
import { ForceAddDropModal } from '@/components/commissioner/ForceAddDropModal';
import { ForceRosterMoveModal } from '@/components/commissioner/ForceRosterMoveModal';
import { ManagePickConditionsModal } from '@/components/commissioner/ManagePickConditionsModal';
import { PaymentLedgerModal } from '@/components/commissioner/PaymentLedgerModal';
import { ReverseTradeModal } from '@/components/commissioner/ReverseTradeModal';
import { SendAnnouncementModal } from '@/components/commissioner/SendAnnouncementModal';
import { TransferOwnershipModal } from '@/components/commissioner/TransferOwnershipModal';
import { SeasonHistory } from '@/components/home/SeasonHistory';
import { TeamAssigner } from '@/components/import/TeamAssigner';
import { TeamLogo } from '@/components/team/TeamLogo';
import { Badge } from '@/components/ui/Badge';
import { ListRow } from '@/components/ui/ListRow';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { PageHeader } from '@/components/ui/PageHeader';
import { Section } from '@/components/ui/Section';
import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { LEAGUE_TYPE_DISPLAY, PLAYER_LOCK_DISPLAY, SEEDING_DISPLAY, TIEBREAKER_DISPLAY, WAIVER_DAY_LABELS } from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { TIER_LABELS } from '@/constants/Subscriptions';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useTextPrompt } from '@/context/ConfirmProvider';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueRosterConfig } from '@/hooks/useLeagueRosterConfig';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { useOffseasonActions } from '@/hooks/useOffseasonActions';
import { usePlayoffBracket } from '@/hooks/usePlayoffBracket';
import { useSubscription } from '@/hooks/useSubscription';
import { supabase } from '@/lib/supabase';
import { openPaymentConfirmed } from '@/utils/league/paymentLinks';
import { calcRounds } from '@/utils/league/playoff';
import { ms, s } from '@/utils/scale';

// ── Lifecycle helpers ──────────────────────────────────────────────

type Lifecycle = 'pre_draft' | 'mid_draft' | 'post_draft' | 'mid_season' | 'offseason';

function getLifecycle(draftStatus: string | undefined, scheduleGenerated: boolean, offseasonStep: string | null): Lifecycle {
  if (offseasonStep) return 'offseason';
  if (!draftStatus || draftStatus === 'unscheduled' || draftStatus === 'pending' || draftStatus === 'scheduled')
    return 'pre_draft';
  if (draftStatus === 'in_progress') return 'mid_draft';
  if (!scheduleGenerated) return 'post_draft';
  return 'mid_season';
}

type SettingGroup = 'basics' | 'roster' | 'scoring' | 'draft' | 'trade' | 'waivers' | 'season';

function sectionEditable(group: SettingGroup, lifecycle: Lifecycle, isCommissioner: boolean): boolean {
  if (!isCommissioner || lifecycle === 'mid_draft') return false;
  if (group === 'basics' || group === 'trade' || group === 'waivers') return true;
  if (group === 'roster' || group === 'scoring') return lifecycle !== 'mid_season';
  if (group === 'draft') return lifecycle === 'pre_draft' || lifecycle === 'offseason';
  if (group === 'season') return lifecycle !== 'mid_season';
  return false;
}

// ── Display helpers ────────────────────────────────────────────────

const VETO_DISPLAY: Record<string, string> = { commissioner: 'Commissioner', league_vote: 'League Vote', none: 'None' };
const ORDER_DISPLAY: Record<string, string> = { reverse_record: 'Reverse Record', lottery: 'Lottery' };
const WAIVER_DISPLAY: Record<string, string> = { standard: 'Standard', faab: 'FAAB', none: 'None' };
const DRAFT_TYPE_DISPLAY = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);


// ── Main component ─────────────────────────────────────────────────

export default function LeagueInfoScreen() {
  const session = useSession();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const promptInput = useTextPrompt();
  const { leagueId, teamId } = useAppState();

  const { data: league, isLoading: leagueLoading } = useLeague();
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId ?? '');
  const { data: scoring } = useLeagueScoring(leagueId ?? '');

  const { data: draft } = useQuery({
    queryKey: queryKeys.leagueDraft(leagueId!),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('id, draft_type, time_limit, status, season, type')
        .eq('league_id', leagueId!)
        .eq('type', 'initial')
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });

  const isCommissioner = !!(session?.user?.id && league?.created_by === session.user.id);
  const lifecycle = getLifecycle(draft?.status ?? undefined, league?.schedule_generated ?? false, league?.offseason_step ?? null);
  const { data: announcements } = useAnnouncements(leagueId ?? null);
  const { data: bracket } = usePlayoffBracket(league?.season ?? '');

  const playoffsComplete = (() => {
    if (!bracket || bracket.length === 0) return false;
    const totalRounds = calcRounds(league?.playoff_teams ?? 8);
    const finalSlot = bracket.find(s => s.round === totalRounds);
    return !!finalSlot?.winner_id;
  })();

  // Settings modals
  const [showBasicsModal, setShowBasicsModal] = useState(false);
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [showScoringModal, setShowScoringModal] = useState(false);
  const [showDraftModal, setShowDraftModal] = useState(false);
  const [showTradeModal, setShowTradeModal] = useState(false);
  const [showWaiverModal, setShowWaiverModal] = useState(false);
  const [showSeasonModal, setShowSeasonModal] = useState(false);

  // Commissioner action modals
  const [showReverseTrade, setShowReverseTrade] = useState(false);
  const [showForceAddDrop, setShowForceAddDrop] = useState(false);
  const [showForceMove, setShowForceMove] = useState(false);
  const [showPickConditions, setShowPickConditions] = useState(false);
  const [showPaymentLedger, setShowPaymentLedger] = useState(false);
  const [showSendAnnouncement, setShowSendAnnouncement] = useState(false);
  const [showLeagueNotifs, setShowLeagueNotifs] = useState(false);
  const [showDivisionsModal, setShowDivisionsModal] = useState(false);
  const [showTransferOwnership, setShowTransferOwnership] = useState(false);
  const [showLeagueUpgrade, setShowLeagueUpgrade] = useState(false);
  const { leagueTier } = useSubscription();

  // Shared offseason/advance handlers — same hook the home hero uses.
  const {
    advanceSeason: handleAdvanceSeason,
    loading: advancingseason,
  } = useOffseasonActions({
    leagueId: leagueId ?? '',
    season: league?.season ?? '',
    isDynasty: (league?.league_type ?? 'dynasty') === 'dynasty',
  });


  // ── Render ─────────────────────────────────────────────────────

  if (leagueLoading || !league) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
        <View style={{ marginTop: 60 }}><LogoSpinner /></View>
      </SafeAreaView>
    );
  }

  const commissionerTeam = league.league_teams?.find((t: any) => t.is_commissioner);
  const teamCount = league.league_teams?.length ?? league.teams ?? 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.background }]}>
      <PageHeader title="League Info" />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Commissioner Dashboard ── */}
        {isCommissioner && (
          <Section title="Commissioner" cardStyle={styles.sectionCardInner}>
            {/* League Management */}
              <ThemedText type="varsitySmall" style={[styles.commGroupLabel, { color: c.secondaryText }]}>
                League Management
              </ThemedText>
              <CommAction
                icon="megaphone"
                label="Send Announcement"
                c={c}
                onPress={() => setShowSendAnnouncement(true)}
              />
              <CommAction
                icon="cash"
                label="Payment Ledger"
                c={c}
                onPress={() => setShowPaymentLedger(true)}
              />
              <CommAction
                icon="people"
                label="Transfer Team Ownership"
                c={c}
                onPress={() => setShowTransferOwnership(true)}
              />
              <CommAction
                icon="diamond"
                label={leagueTier ? 'Manage League Plan' : 'Upgrade League'}
                subLabel={leagueTier ? `Currently ${TIER_LABELS[leagueTier]}` : undefined}
                accent
                c={c}
                onPress={() => setShowLeagueUpgrade(true)}
                last
              />

              {/* Season */}
              {lifecycle === 'mid_season' && !league?.offseason_step && (
                <>
                  <ThemedText type="varsitySmall" style={[styles.commGroupLabel, { color: c.secondaryText }]}>
                    Season
                  </ThemedText>
                  <CommAction
                    icon="calendar"
                    label="Advance to Offseason"
                    subLabel={!playoffsComplete ? 'Playoffs must finish first' : undefined}
                    c={c}
                    onPress={handleAdvanceSeason}
                    disabled={advancingseason || !playoffsComplete}
                    loading={advancingseason}
                    last
                  />
                </>
              )}

              {/* Roster & Trade Corrections */}
              <ThemedText type="varsitySmall" style={[styles.commGroupLabel, { color: c.secondaryText }]}>
                Roster & Trade Corrections
              </ThemedText>
              <CommAction
                icon="arrow-undo"
                label="Reverse Trade"
                c={c}
                onPress={() => setShowReverseTrade(true)}
              />
              <CommAction
                icon="person-add"
                label="Force Add/Drop"
                c={c}
                onPress={() => setShowForceAddDrop(true)}
              />
              <CommAction
                icon="swap-vertical"
                label="Force Roster Move"
                c={c}
                onPress={() => setShowForceMove(true)}
                last={!((league?.league_type ?? 'dynasty') === 'dynasty' && league?.pick_conditions_enabled)}
              />
              {(league?.league_type ?? 'dynasty') === 'dynasty' && league?.pick_conditions_enabled && (
                <CommAction
                  icon="shield-checkmark"
                  label="Manage Pick Conditions"
                  c={c}
                  onPress={() => setShowPickConditions(true)}
                  last
                />
              )}
          </Section>
        )}

        {/* ── Team Assignment (imported leagues) ── */}
        {isCommissioner && league?.imported_from && leagueId && (
          <TeamAssigner leagueId={leagueId} />
        )}

        {/* ── League Basics ── */}
        <SectionCard title="League Basics" c={c} editable={sectionEditable('basics', lifecycle, isCommissioner)} onEdit={() => setShowBasicsModal(true)}>
          <Row label="Name" value={league.name} c={c} />
          <Row label="League Type" value={LEAGUE_TYPE_DISPLAY[league.league_type] ?? 'Dynasty'} c={c} />
          {league.league_type === 'keeper' && (
            <Row label="Keepers Per Team" value={String(league.keeper_count ?? '-')} c={c} />
          )}
          <Row label="Visibility" value={league.private ? 'Private' : 'Public'} c={c} />
          {league.private && league.invite_code && (
            <Row label="Invite Code" value={league.invite_code} c={c} />
          )}
          <Row label="Buy-In" value={league.buy_in_amount ? `$${league.buy_in_amount}` : 'Free'} c={c} />
          {league.venmo_username && (
            isCommissioner ? (
              <TouchableOpacity onPress={() => openPaymentConfirmed('venmo', league.venmo_username!, { amount: league.buy_in_amount ?? undefined, note: `${league.name} buy-in` })} accessibilityRole="button" accessibilityLabel="Test Venmo link">
                <Row label="Venmo" value={`@${league.venmo_username}  ↗`} c={c} />
              </TouchableOpacity>
            ) : (
              <Row label="Venmo" value={`@${league.venmo_username}`} c={c} />
            )
          )}
          {league.cashapp_tag && (
            isCommissioner ? (
              <TouchableOpacity onPress={() => openPaymentConfirmed('cashapp', league.cashapp_tag!)} accessibilityRole="button" accessibilityLabel="Test Cash App link">
                <Row label="Cash App" value={`$${league.cashapp_tag}  ↗`} c={c} />
              </TouchableOpacity>
            ) : (
              <Row label="Cash App" value={`$${league.cashapp_tag}`} c={c} />
            )
          )}
          {league.paypal_username && (
            isCommissioner ? (
              <TouchableOpacity onPress={() => openPaymentConfirmed('paypal', league.paypal_username!, { amount: league.buy_in_amount ?? undefined })} accessibilityRole="button" accessibilityLabel="Test PayPal link">
                <Row label="PayPal" value={`${league.paypal_username}  ↗`} c={c} />
              </TouchableOpacity>
            ) : (
              <Row label="PayPal" value={league.paypal_username} c={c} />
            )
          )}
          {!!league.buy_in_amount && !league.venmo_username && !league.cashapp_tag && !league.paypal_username && isCommissioner && (
            <Row label="Payment Methods" value="Not set — tap Edit to add" c={c} />
          )}
          <Row label="Teams" value={`${teamCount}`} c={c} />
          <Row label="Season" value={league.season} c={c} />
          {commissionerTeam && <Row label="Commissioner" value={commissionerTeam.name} c={c} last />}
        </SectionCard>

        {/* ── Roster Configuration ── */}
        <SectionCard title={`Roster (${league.roster_size ?? '?'} slots)`} c={c} editable={sectionEditable('roster', lifecycle, isCommissioner)} onEdit={() => setShowRosterModal(true)}>
          <ThemedText style={[styles.summaryText, { color: c.secondaryText }]}>
            {rosterConfig
              ? rosterConfig.map((r) => `${r.position}: ${r.slot_count}`).join('  |  ')
              : 'Loading...'}
          </ThemedText>
        </SectionCard>

        {/* ── Scoring ── */}
        <SectionCard title={league?.scoring_type === 'h2h_categories' ? 'Categories' : 'Scoring'} c={c} editable={sectionEditable('scoring', lifecycle, isCommissioner)} onEdit={() => setShowScoringModal(true)}>
          <ThemedText style={[styles.summaryText, { color: c.secondaryText }]}>
            {scoring
              ? league?.scoring_type === 'h2h_categories'
                ? scoring.map((s) => `${s.stat_name}${s.inverse ? ' ▼' : ''}`).join('  |  ')
                : scoring.map((s) => `${s.stat_name}: ${s.point_value > 0 ? '+' : ''}${s.point_value}`).join('  |  ')
              : 'Loading...'}
          </ThemedText>
        </SectionCard>

        {/* ── Draft Settings ── */}
        <SectionCard title="Draft Settings" c={c} editable={sectionEditable('draft', lifecycle, isCommissioner)} onEdit={() => setShowDraftModal(true)}>
          <Row label="Type" value={draft ? DRAFT_TYPE_DISPLAY(draft.draft_type ?? 'snake') : '-'} c={c} />
          <Row label="Time Per Pick" value={draft ? `${draft.time_limit ?? 90}s` : '-'} c={c} />
          <Row label="Status" value={draft?.status ? (draft.status.charAt(0).toUpperCase() + draft.status.slice(1).replace('_', ' ')) : '-'} c={c} />
          {(league.league_type ?? 'dynasty') === 'dynasty' && (
            <>
              <Row label="Future Draft Years" value={String(league.max_future_seasons ?? '-')} c={c} />
              <Row label="Rookie Draft Rounds" value={String(league.rookie_draft_rounds ?? '-')} c={c} />
              <Row label="Rookie Draft Order" value={ORDER_DISPLAY[league.rookie_draft_order] ?? '-'} c={c} />
              {league.rookie_draft_order === 'lottery' && (
                <Row label="Lottery Draws" value={String(league.lottery_draws ?? '-')} c={c} />
              )}
              <Row label="Initial Draft, Pick Trading" value={league.draft_pick_trading_enabled ? 'Enabled' : 'Disabled'} c={c} />
            </>
          )}
        </SectionCard>

        {/* ── Trade Settings ── */}
        <SectionCard title="Trade Settings" c={c} editable={sectionEditable('trade', lifecycle, isCommissioner)} onEdit={() => setShowTradeModal(true)}>
          <Row label="Veto Type" value={VETO_DISPLAY[league.trade_veto_type] ?? '-'} c={c} />
          {league.trade_veto_type !== 'none' && (
            <Row label="Review Period" value={`${league.trade_review_period_hours ?? 0} hrs`} c={c} />
          )}
          {league.trade_veto_type === 'league_vote' && (
            <Row label="Votes to Veto" value={String(league.trade_votes_to_veto ?? '-')} c={c} />
          )}
          {(league.league_type ?? 'dynasty') === 'dynasty' && (
            <Row label="Pick Protections & Swaps" value={league.pick_conditions_enabled ? 'Enabled' : 'Disabled'} c={c} />
          )}
          <Row label="Trade Deadline" value={league.trade_deadline ? `After Week ${(() => {
            if (!league.season_start_date) return '?';
            const deadline = new Date(league.trade_deadline + 'T00:00:00');
            const start = new Date(league.season_start_date + 'T00:00:00');
            const startDay = start.getDay();
            const daysToFirstSunday = startDay === 0 ? 0 : 7 - startDay;
            const week1End = new Date(start);
            week1End.setDate(start.getDate() + daysToFirstSunday);
            const diffDays = Math.round((deadline.getTime() - week1End.getTime()) / (1000 * 60 * 60 * 24));
            return Math.max(1, Math.round(diffDays / 7) + 1);
          })()}` : 'None'} c={c} last />
        </SectionCard>

        {/* ── Waiver Settings ── */}
        <SectionCard title="Waiver Settings" c={c} editable={sectionEditable('waivers', lifecycle, isCommissioner)} onEdit={() => setShowWaiverModal(true)}>
          <Row label="Waiver Type" value={WAIVER_DISPLAY[league.waiver_type] ?? '-'} c={c} />
          {league.waiver_type !== 'none' && (
            <Row label="Waiver Period" value={`${league.waiver_period_days ?? 0} days`} c={c} />
          )}
          {league.waiver_type === 'faab' && (
            <>
              <Row label="Process Day" value={WAIVER_DAY_LABELS[league.waiver_day_of_week ?? 3]} c={c} />
              <Row label="FAAB Budget" value={`$${league.faab_budget ?? 100}`} c={c} />
            </>
          )}
          <Row label="Weekly Add Limit" value={league.weekly_acquisition_limit != null ? String(league.weekly_acquisition_limit) : 'Unlimited'} c={c} />
          <Row label="Player Lock" value={PLAYER_LOCK_DISPLAY[league.player_lock_type] ?? 'Daily'} c={c} last />
        </SectionCard>

        {/* ── Season Settings ── */}
        <SectionCard title="Season" c={c} editable={sectionEditable('season', lifecycle, isCommissioner)} onEdit={() => setShowSeasonModal(true)}>
          <Row label="Start Date" value={league.season_start_date ? new Date(league.season_start_date + 'T00:00:00').toLocaleDateString() : '-'} c={c} />
          <Row label="Regular Season" value={`${league.regular_season_weeks ?? '-'} weeks`} c={c} />
          <Row label="Playoffs" value={`${league.playoff_weeks ?? '-'} weeks`} c={c} />
          <Row label="Playoff Teams" value={String(league.playoff_teams ?? '-')} c={c} />
          <Row label="Seeding Format" value={SEEDING_DISPLAY[league.playoff_seeding_format] ?? 'Standard'} c={c} />
          {league.playoff_seeding_format === 'standard' && (
            <Row label="Reseed Each Round" value={league.reseed_each_round ? 'Yes' : 'No'} c={c} />
          )}
          <Row
            label="Tiebreaker"
            value={
              (league.tiebreaker_order ?? ['head_to_head', 'points_for'])
                .map((k: string) => TIEBREAKER_DISPLAY[k] ?? k)
                .join(', then ')
            }
            c={c}
          />
          <Row
            label="Divisions"
            value={league.division_count === 2 ? `${league.division_1_name} & ${league.division_2_name}` : 'None'}
            c={c}
          />
          <Row label="Schedule" value={league.schedule_generated ? 'Generated' : 'Not yet generated'} c={c} last />
        </SectionCard>

        {/* ── Assign Divisions (commissioner, pre-season, 2 divisions) ── */}
        {isCommissioner && league.division_count === 2 && lifecycle !== 'mid_season' && (
          <TouchableOpacity
            style={[styles.navRow, { backgroundColor: c.card, borderColor: c.border }]}
            onPress={() => setShowDivisionsModal(true)}
            accessibilityRole="button"
            accessibilityLabel="Assign teams to divisions"
          >
            <Ionicons name="git-branch-outline" size={18} color={c.heritageGold} accessible={false} />
            <ThemedText style={[styles.navRowText, { color: c.text }]}>Assign Divisions</ThemedText>
            <Ionicons name="chevron-forward" size={14} color={c.secondaryText} accessible={false} />
          </TouchableOpacity>
        )}

        {/* ── Members ── */}
        <Section title="Members" cardStyle={styles.membersCard}>
          {(league.league_teams ?? []).map((team: any, idx: number) => {
            const isMine = team.id === teamId;
            const total = league.league_teams?.length ?? 0;
            return (
              <ListRow
                key={team.id}
                index={idx}
                total={total}
                style={styles.memberRow}
              >
                <View style={styles.memberLeft}>
                  <TeamLogo logoKey={team.logo_key} teamName={team.name} tricode={team.tricode} size="medium" />
                  <TouchableOpacity
                    disabled={!isMine}
                    activeOpacity={isMine ? 0.6 : 1}
                    accessibilityRole="button"
                    accessibilityLabel={`Team name: ${team.name}${isMine ? ', tap to edit' : ''}`}
                    onPress={() => {
                      if (!isMine) return;
                      promptInput({
                        title: 'Edit Team Name',
                        message: 'Enter your new team name',
                        defaultValue: team.name ?? '',
                        maxLength: 30,
                        action: {
                          label: 'Save',
                          onSubmit: async (value) => {
                            const name = value.trim();
                            if (!name) return;
                            if (name.length > 30) { Alert.alert('Too long', 'Team name must be 30 characters or fewer.'); return; }
                            const { error } = await supabase.from('teams').update({ name }).eq('id', team.id);
                            if (error) { Alert.alert('Error', error.message); return; }
                            queryClient.invalidateQueries({ queryKey: ['league'] });
                          },
                        },
                      });
                    }}
                  >
                    <View style={styles.memberNameRow}>
                      <ThemedText>{team.name}</ThemedText>
                      {isMine && <Ionicons name="pencil" size={10} color={c.secondaryText} />}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Tricode: ${team.tricode ?? 'not set'}${isMine ? ', tap to edit' : ''}`}
                    onPress={() => {
                      if (!isMine) return;
                      promptInput({
                        title: 'Edit Tricode',
                        message: '2-3 characters (letters/numbers)',
                        defaultValue: team.tricode ?? '',
                        maxLength: 3,
                        autoCapitalize: 'characters',
                        action: {
                          label: 'Save',
                          onSubmit: async (value) => {
                            const code = value.trim().toUpperCase();
                            if (!code || code.length < 2 || code.length > 3 || !/^[A-Z0-9]+$/.test(code)) {
                              Alert.alert('Invalid tricode', 'Must be 2-3 letters/numbers.');
                              return;
                            }
                            const { error } = await supabase.from('teams').update({ tricode: code }).eq('id', team.id);
                            if (error) { Alert.alert('Error', error.message); return; }
                            queryClient.invalidateQueries({ queryKey: ['league'] });
                          },
                        },
                      });
                    }}
                    disabled={!isMine}
                    activeOpacity={isMine ? 0.6 : 1}
                  >
                    <View style={[styles.tricodeBadge, { backgroundColor: c.cardAlt }]}>
                      <ThemedText style={[styles.tricodeText, { color: c.secondaryText }]}>
                        {team.tricode ?? '—'}
                      </ThemedText>
                      {isMine && <Ionicons name="pencil" size={10} color={c.secondaryText} />}
                    </View>
                  </TouchableOpacity>
                </View>
                {team.is_commissioner && <Badge label="Commish" variant="turf" />}
              </ListRow>
            );
          })}
        </Section>

        {/* ── League Notification Preferences ── */}
        <TouchableOpacity
          style={[styles.navRow, { backgroundColor: c.card, borderColor: c.border }]}
          onPress={() => setShowLeagueNotifs(true)}
          accessibilityRole="button"
          accessibilityLabel="League notification preferences"
        >
          <Ionicons name="notifications-outline" size={18} color={c.heritageGold} accessible={false} />
          <ThemedText style={[styles.navRowText, { color: c.text }]}>Notification Preferences</ThemedText>
          <Ionicons name="chevron-forward" size={14} color={c.secondaryText} accessible={false} />
        </TouchableOpacity>

        {/* ── Announcements ── */}
        {(announcements ?? []).length > 0 && (
          <Section
            title="Announcements"
            action={
              isCommissioner
                ? {
                    icon: 'add-circle',
                    onPress: () => setShowSendAnnouncement(true),
                    accessibilityLabel: 'Add announcement',
                  }
                : undefined
            }
            cardStyle={styles.sectionCardInner}
          >
            {(announcements ?? []).map((a, idx) => (
              <ListRow
                key={a.id}
                index={idx}
                total={announcements?.length ?? 1}
                style={styles.announcementRow}
              >
                <View style={styles.announcementContent}>
                  <ThemedText type="mono" style={[styles.announcementDate, { color: c.secondaryText }]}>
                    {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </ThemedText>
                  <ThemedText style={[styles.announcementText, { color: c.text }]}>{a.content}</ThemedText>
                </View>
              </ListRow>
            ))}
          </Section>
        )}

        {/* ── Season History ── */}
        <SeasonHistory leagueId={league.id} />

      </ScrollView>

      {/* ── League Notification Preferences Modal ── */}
      {leagueId && session?.user?.id && (
        <LeagueNotificationModal
          visible={showLeagueNotifs}
          onClose={() => setShowLeagueNotifs(false)}
          userId={session.user.id}
          leagueId={leagueId}
          leagueName={league?.name ?? 'League'}
        />
      )}

      {/* ── Settings Modals ── */}
      {leagueId && (
        <>
          <EditBasicsModal
            visible={showBasicsModal}
            onClose={() => setShowBasicsModal(false)}
            league={league}
            leagueId={leagueId}
            canChangeSize={isCommissioner && lifecycle === 'pre_draft'}
            currentTeamCount={teamCount}
          />
          <EditRosterModal
            visible={showRosterModal}
            onClose={() => setShowRosterModal(false)}
            leagueId={leagueId}
            rosterConfig={rosterConfig}
            positionLimits={league?.position_limits as Record<string, number> | null}
          />
          <EditScoringModal
            visible={showScoringModal}
            onClose={() => setShowScoringModal(false)}
            leagueId={leagueId}
            scoring={scoring}
            scoringType={league?.scoring_type}
          />
          <EditDraftSettingsModal
            visible={showDraftModal}
            onClose={() => setShowDraftModal(false)}
            league={league}
            leagueId={leagueId}
            draft={draft ?? null}
            teamCount={teamCount}
          />
          <EditTradeSettingsModal
            visible={showTradeModal}
            onClose={() => setShowTradeModal(false)}
            league={league}
            leagueId={leagueId}
            teamCount={teamCount}
          />
          <EditWaiverSettingsModal
            visible={showWaiverModal}
            onClose={() => setShowWaiverModal(false)}
            league={league}
            leagueId={leagueId}
          />
          <EditSeasonSettingsModal
            visible={showSeasonModal}
            onClose={() => setShowSeasonModal(false)}
            league={league}
            leagueId={leagueId}
            teamCount={teamCount}
          />
        </>
      )}

      {/* ── Commissioner Modals ── */}
      {isCommissioner && leagueId && (
        <>
          <SendAnnouncementModal
            visible={showSendAnnouncement}
            leagueId={leagueId}
            teamId={teamId ?? ''}
            onClose={() => setShowSendAnnouncement(false)}
          />
          {/* PaymentLedgerModal moved outside commissioner block */}
          <ReverseTradeModal
            visible={showReverseTrade}
            leagueId={leagueId}
            onClose={() => setShowReverseTrade(false)}
          />
          <ForceAddDropModal
            visible={showForceAddDrop}
            leagueId={leagueId}
            teams={(league?.league_teams ?? []).map((t: any) => ({ id: t.id, name: t.name }))}
            onClose={() => setShowForceAddDrop(false)}
          />
          <ForceRosterMoveModal
            visible={showForceMove}
            leagueId={leagueId}
            teams={(league?.league_teams ?? []).map((t: any) => ({ id: t.id, name: t.name }))}
            onClose={() => setShowForceMove(false)}
          />
          <ManagePickConditionsModal
            visible={showPickConditions}
            leagueId={leagueId}
            teams={(league?.league_teams ?? []).map((t: any) => ({ id: t.id, name: t.name }))}
            onClose={() => setShowPickConditions(false)}
          />
          <TransferOwnershipModal
            visible={showTransferOwnership}
            onClose={() => setShowTransferOwnership(false)}
            leagueId={leagueId}
            teams={(league?.league_teams ?? []).map((t: any) => ({ id: t.id, name: t.name, user_id: t.user_id }))}
          />
          {league?.division_count === 2 && (
            <AssignDivisionsModal
              visible={showDivisionsModal}
              onClose={() => setShowDivisionsModal(false)}
              leagueId={leagueId}
              division1Name={league.division_1_name ?? 'Division 1'}
              division2Name={league.division_2_name ?? 'Division 2'}
              teams={(league?.league_teams ?? []).map((t: any) => ({
                id: t.id,
                name: t.name,
                tricode: t.tricode,
                logo_key: t.logo_key,
                division: t.division ?? null,
              }))}
            />
          )}
        </>
      )}

      {/* Payment Ledger — commissioner only */}
      {isCommissioner && leagueId && (
        <PaymentLedgerModal
          visible={showPaymentLedger}
          leagueId={leagueId}
          leagueName={league?.name ?? ''}
          season={league?.season ?? ''}
          buyInAmount={league?.buy_in_amount ?? null}
          venmoUsername={league?.venmo_username ?? null}
          cashappTag={league?.cashapp_tag ?? null}
          paypalUsername={league?.paypal_username ?? null}
          teams={(league?.league_teams ?? []).map((t: any) => ({ id: t.id, name: t.name }))}
          myTeamId={teamId ?? undefined}
          isCommissioner={isCommissioner}
          onClose={() => setShowPaymentLedger(false)}
        />
      )}

      <UpgradeModal
        visible={showLeagueUpgrade}
        onClose={() => setShowLeagueUpgrade(false)}
        leagueMode
      />
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function Row({ label, value, c, last }: { label: string; value: string; c: any; last?: boolean }) {
  return (
    <View
      style={[
        styles.row,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
      ]}
    >
      <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]} numberOfLines={2}>
        {label}
      </ThemedText>
      <ThemedText style={[styles.rowValue, { color: c.text }]} numberOfLines={2}>
        {value}
      </ThemedText>
    </View>
  );
}

function CommAction({
  icon,
  label,
  subLabel,
  c,
  onPress,
  disabled,
  loading,
  last,
  accent,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  subLabel?: string;
  c: any;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  last?: boolean;
  accent?: boolean;
}) {
  const iconColor = accent ? c.heritageGold : c.text;
  const labelColor = accent ? c.heritageGold : c.text;
  return (
    <TouchableOpacity
      style={[
        styles.commAction,
        !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
        disabled && { opacity: 0.5 },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Ionicons name={icon} size={16} color={iconColor} accessible={false} />
      <View style={{ flex: 1 }}>
        <ThemedText style={[styles.commActionText, { color: labelColor }]}>{label}</ThemedText>
        {subLabel && (
          <ThemedText style={{ fontSize: ms(11), color: c.secondaryText, marginTop: s(2) }}>
            {subLabel}
          </ThemedText>
        )}
      </View>
      {loading ? (
        <LogoSpinner size={16} delay={0} />
      ) : (
        <Ionicons name="chevron-forward" size={14} color={c.secondaryText} accessible={false} />
      )}
    </TouchableOpacity>
  );
}

function SectionCard({
  title, editable, onEdit, children,
}: {
  title: string;
  // `c` was previously forwarded to inline styles; the Section primitive
  // owns its own theme access now, so the prop is optional here for
  // backwards compat with existing call sites that still pass it.
  c?: any;
  editable?: boolean;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <Section
      title={title}
      action={
        editable && onEdit
          ? { icon: 'pencil', onPress: onEdit, accessibilityLabel: `Edit ${title}` }
          : undefined
      }
      cardStyle={styles.sectionCardInner}
    >
      {children}
    </Section>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: s(20), paddingTop: s(12), paddingBottom: s(40) },

  // Tighter vertical rhythm than the Section primitive default — this
  // screen stacks many short sections, so the denser s(6) padding reads
  // more like a settings list than a content card.
  sectionCardInner: {
    paddingTop: s(6),
    paddingBottom: s(6),
  },
  // Members section drops the card's horizontal padding so ListRow's
  // own 14-unit padding handles content insets and the (future) active
  // row bg would span the card's full width. Keeps rhythm consistent
  // with the standings tables.
  membersCard: {
    paddingHorizontal: 0,
    paddingTop: s(4),
    paddingBottom: s(4),
  },

  // Inline one-tap nav row (shares card look but no header above)
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingHorizontal: s(14),
    paddingVertical: s(14),
    borderWidth: 1,
    borderRadius: 14,
    marginBottom: s(14),
  },
  navRowText: {
    flex: 1,
    fontSize: ms(14),
  },

  // Rows inside a sectionCard
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: s(11),
    gap: s(12),
  },
  rowLabel: {
    fontSize: ms(14),
    flexShrink: 1,
  },
  rowValue: {
    fontSize: ms(14),
    fontWeight: '500',
    textAlign: 'right',
    flexShrink: 1,
  },
  summaryText: {
    fontSize: ms(13),
    lineHeight: ms(20),
    paddingVertical: s(10),
  },

  // Members — ListRow supplies the divider + pressability. We just
  // override to keep the commish Badge pushed to the right edge.
  memberRow: {
    justifyContent: 'space-between',
  },
  memberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  memberNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tricodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(3),
    paddingHorizontal: s(7),
    paddingVertical: s(3),
    borderRadius: 4,
  },
  tricodeText: {
    fontSize: ms(11),
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Commissioner actions
  commAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(13),
    gap: s(12),
  },
  commActionText: {
    flex: 1,
    fontSize: ms(14),
  },
  commGroupLabel: {
    fontSize: ms(10),
    marginTop: s(12),
    marginBottom: s(2),
  },

  // Announcements — content stacks vertically (date above body text).
  // ListRow defaults to row layout, so we restyle the outer row to be
  // stretched & less horizontally indented (content is already inside
  // a card with its own 14-unit padding).
  announcementRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    paddingHorizontal: s(2),
  },
  announcementContent: {
    // Plain wrapper so date + body stack the same way they did
    // pre-refactor.
  },
  announcementDate: {
    fontSize: ms(11),
    marginBottom: s(3),
  },
  announcementText: {
    fontSize: ms(14),
    lineHeight: ms(20),
  },
});
