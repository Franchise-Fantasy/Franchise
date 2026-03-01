import { ThemedText } from '@/components/ThemedText';
import { PageHeader } from '@/components/ui/PageHeader';
import { EditBasicsModal } from '@/components/commissioner/EditBasicsModal';
import { EditRosterModal } from '@/components/commissioner/EditRosterModal';
import { EditScoringModal } from '@/components/commissioner/EditScoringModal';
import { EditDraftSettingsModal } from '@/components/commissioner/EditDraftSettingsModal';
import { EditTradeSettingsModal } from '@/components/commissioner/EditTradeSettingsModal';
import { EditWaiverSettingsModal } from '@/components/commissioner/EditWaiverSettingsModal';
import { EditSeasonSettingsModal } from '@/components/commissioner/EditSeasonSettingsModal';
import { ReverseTradeModal } from '@/components/commissioner/ReverseTradeModal';
import { ForceAddDropModal } from '@/components/commissioner/ForceAddDropModal';
import { ForceRosterMoveModal } from '@/components/commissioner/ForceRosterMoveModal';
import { ManagePickConditionsModal } from '@/components/commissioner/ManagePickConditionsModal';
import { PaymentLedgerModal } from '@/components/commissioner/PaymentLedgerModal';
import { SendAnnouncementModal } from '@/components/commissioner/SendAnnouncementModal';
import { TeamAssigner } from '@/components/import/TeamAssigner';
import { SeasonHistory } from '@/components/home/SeasonHistory';
import { useAnnouncements } from '@/hooks/useAnnouncements';
import { Colors } from '@/constants/Colors';
import { SEEDING_DISPLAY, WAIVER_DAY_LABELS } from '@/constants/LeagueDefaults';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueRosterConfig } from '@/hooks/useLeagueRosterConfig';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { usePlayoffBracket } from '@/hooks/usePlayoffBracket';
import { calcRounds } from '@/utils/playoff';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// ── Lifecycle helpers ──────────────────────────────────────────────

type Lifecycle = 'pre_draft' | 'mid_draft' | 'post_draft' | 'mid_season';

function getLifecycle(draftStatus: string | undefined, scheduleGenerated: boolean): Lifecycle {
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
  if (group === 'draft') return lifecycle === 'pre_draft';
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
  const { leagueId, teamId } = useAppState();

  const { data: league, isLoading: leagueLoading } = useLeague();
  const { data: rosterConfig } = useLeagueRosterConfig(leagueId ?? '');
  const { data: scoring } = useLeagueScoring(leagueId ?? '');

  const { data: draft } = useQuery({
    queryKey: ['leagueDraft', leagueId],
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
  const lifecycle = getLifecycle(draft?.status, league?.schedule_generated ?? false);
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
  const [advancingseason, setAdvancingSeason] = useState(false);

  const handleAdvanceSeason = () => {
    Alert.alert(
      'Advance to Offseason',
      'This will:\n\n- Archive this season\'s stats\n- Reset W/L records\n- Cancel pending trades, waivers, & queued moves\n- Begin the offseason process\n\nThis cannot be undone. Continue?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Advance',
          style: 'destructive',
          onPress: async () => {
            setAdvancingSeason(true);
            try {
              const { error } = await supabase.functions.invoke('advance-season', {
                body: { league_id: league!.id },
              });
              if (error) throw error;
              queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
              Alert.alert('Season Advanced', 'The offseason has begun!');
            } catch (err: any) {
              Alert.alert('Error', err.message ?? 'Failed to advance season');
            } finally {
              setAdvancingSeason(false);
            }
          },
        },
      ],
    );
  };


  // ── Render ─────────────────────────────────────────────────────

  if (leagueLoading || !league) {
    return (
      <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
        <ActivityIndicator style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  const commissionerTeam = league.league_teams?.find((t: any) => t.is_commissioner);
  const teamCount = league.league_teams?.length ?? league.teams ?? 0;

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: c.cardAlt }]}>
      <PageHeader title="League Info" />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── Commissioner Dashboard ── */}
        {isCommissioner && (
          <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border, borderLeftWidth: 3, borderLeftColor: '#FF9500' }]}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">Commissioner Dashboard</ThemedText>
            <TouchableOpacity
              style={[styles.commAction, { borderBottomColor: c.border }]}
              onPress={() => setShowSendAnnouncement(true)}
              accessibilityRole="button"
              accessibilityLabel="Send Announcement"
            >
              <Ionicons name="megaphone" size={18} color="#FF9500" accessible={false} />
              <ThemedText style={[styles.commActionText, { color: '#FF9500' }]}>Send Announcement</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.commAction, { borderBottomColor: c.border }]}
              onPress={() => setShowPaymentLedger(true)}
              accessibilityRole="button"
              accessibilityLabel="Payment Ledger"
            >
              <Ionicons name="cash" size={18} color="#34C759" accessible={false} />
              <ThemedText style={[styles.commActionText, { color: '#34C759' }]}>Payment Ledger</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
            </TouchableOpacity>
            <View style={[styles.commDivider, { borderBottomColor: c.border }]} />
            {lifecycle === 'mid_season' && !league?.offseason_step && (
              <TouchableOpacity
                style={[styles.commAction, { borderBottomColor: c.border }, (advancingseason || !playoffsComplete) && { opacity: 0.5 }]}
                onPress={handleAdvanceSeason}
                disabled={advancingseason || !playoffsComplete}
                accessibilityRole="button"
                accessibilityLabel={playoffsComplete ? 'Advance to Offseason' : 'Advance to Offseason, disabled until playoffs complete'}
                accessibilityState={{ disabled: advancingseason || !playoffsComplete }}
              >
                <Ionicons name="calendar" size={18} color="#FF9500" accessible={false} />
                <View style={{ flex: 1 }}>
                  <ThemedText style={[styles.commActionText, { color: '#FF9500' }]}>Advance to Offseason</ThemedText>
                  {!playoffsComplete && (
                    <ThemedText style={{ fontSize: 11, color: c.secondaryText, marginTop: 2 }}>
                      Playoffs must finish first
                    </ThemedText>
                  )}
                </View>
                {advancingseason ? (
                  <ActivityIndicator size="small" color="#FF9500" />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.commAction, { borderBottomColor: c.border }]}
              onPress={() => setShowReverseTrade(true)}
              accessibilityRole="button"
              accessibilityLabel="Reverse Trade"
            >
              <Ionicons name="arrow-undo" size={18} color={c.text} accessible={false} />
              <ThemedText style={styles.commActionText}>Reverse Trade</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.commAction, { borderBottomColor: c.border }]}
              onPress={() => setShowForceAddDrop(true)}
              accessibilityRole="button"
              accessibilityLabel="Force Add or Drop"
            >
              <Ionicons name="person-add" size={18} color={c.text} accessible={false} />
              <ThemedText style={styles.commActionText}>Force Add/Drop</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.commAction, { borderBottomColor: c.border, borderBottomWidth: league?.pick_conditions_enabled ? StyleSheet.hairlineWidth : 0 }]}
              onPress={() => setShowForceMove(true)}
              accessibilityRole="button"
              accessibilityLabel="Force Roster Move"
            >
              <Ionicons name="swap-vertical" size={18} color={c.text} accessible={false} />
              <ThemedText style={styles.commActionText}>Force Roster Move</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
            </TouchableOpacity>
            {league?.pick_conditions_enabled && (
              <TouchableOpacity
                style={[styles.commAction, { borderBottomWidth: 0 }]}
                onPress={() => setShowPickConditions(true)}
                accessibilityRole="button"
                accessibilityLabel="Manage Pick Conditions"
              >
                <Ionicons name="shield-checkmark" size={18} color={c.text} accessible={false} />
                <ThemedText style={styles.commActionText}>Manage Pick Conditions</ThemedText>
                <Ionicons name="chevron-forward" size={16} color={c.secondaryText} accessible={false} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── Team Assignment (imported leagues) ── */}
        {isCommissioner && league?.imported_from && leagueId && (
          <TeamAssigner leagueId={leagueId} />
        )}

        {/* ── League Basics ── */}
        <SectionCard title="League Basics" c={c} editable={sectionEditable('basics', lifecycle, isCommissioner)} onEdit={() => setShowBasicsModal(true)}>
          <Row label="Name" value={league.name} c={c} />
          <Row label="Visibility" value={league.private ? 'Private' : 'Public'} c={c} />
          {league.private && league.invite_code && (
            <Row label="Invite Code" value={league.invite_code} c={c} />
          )}
          <Row label="Buy-In" value={league.buy_in_amount ? `$${league.buy_in_amount}` : 'Free'} c={c} />
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
        <SectionCard title="Scoring" c={c} editable={sectionEditable('scoring', lifecycle, isCommissioner)} onEdit={() => setShowScoringModal(true)}>
          <ThemedText style={[styles.summaryText, { color: c.secondaryText }]}>
            {scoring
              ? scoring.map((s) => `${s.stat_name}: ${s.point_value > 0 ? '+' : ''}${s.point_value}`).join('  |  ')
              : 'Loading...'}
          </ThemedText>
        </SectionCard>

        {/* ── Draft Settings ── */}
        <SectionCard title="Draft Settings" c={c} editable={sectionEditable('draft', lifecycle, isCommissioner)} onEdit={() => setShowDraftModal(true)}>
          <Row label="Type" value={draft ? DRAFT_TYPE_DISPLAY(draft.draft_type ?? 'snake') : '-'} c={c} />
          <Row label="Time Per Pick" value={draft ? `${draft.time_limit ?? 90}s` : '-'} c={c} />
          <Row label="Status" value={draft ? (draft.status.charAt(0).toUpperCase() + draft.status.slice(1).replace('_', ' ')) : '-'} c={c} />
          <Row label="Future Draft Years" value={String(league.max_future_seasons ?? '-')} c={c} />
          <Row label="Rookie Draft Rounds" value={String(league.rookie_draft_rounds ?? '-')} c={c} />
          <Row label="Rookie Draft Order" value={ORDER_DISPLAY[league.rookie_draft_order] ?? '-'} c={c} />
          {league.rookie_draft_order === 'lottery' && (
            <Row label="Lottery Draws" value={String(league.lottery_draws ?? '-')} c={c} />
          )}
          <Row label="Initial Draft, Pick Trading" value={league.draft_pick_trading_enabled ? 'Enabled' : 'Disabled'} c={c} last />
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
          <Row label="Pick Protections & Swaps" value={league.pick_conditions_enabled ? 'Enabled' : 'Disabled'} c={c} />
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
              <Row label="FAAB Budget" value={`$${league.faab_budget ?? 100}`} c={c} last />
            </>
          )}
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
          <Row label="Schedule" value={league.schedule_generated ? 'Generated' : 'Not yet generated'} c={c} last />
        </SectionCard>

        {/* ── Members ── */}
        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">Members</ThemedText>
          {(league.league_teams ?? []).map((team: any, idx: number) => {
            const isMine = team.id === teamId;
            return (
              <View
                key={team.id}
                style={[styles.memberRow, idx === (league.league_teams?.length ?? 0) - 1 && { borderBottomWidth: 0 }, { borderBottomColor: c.border }]}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                  <ThemedText>{team.name}</ThemedText>
                  <TouchableOpacity
                    accessibilityRole="button"
                    accessibilityLabel={`Tricode: ${team.tricode ?? 'not set'}${isMine ? ', tap to edit' : ''}`}
                    onPress={() => {
                      if (!isMine) return;
                      Alert.prompt(
                        'Edit Tricode',
                        '2-4 characters (letters/numbers)',
                        async (value) => {
                          const code = (value ?? '').trim().toUpperCase();
                          if (!code || code.length < 2 || code.length > 4 || !/^[A-Z0-9]+$/.test(code)) {
                            Alert.alert('Invalid tricode', 'Must be 2-4 letters/numbers.');
                            return;
                          }
                          const { error } = await supabase.from('teams').update({ tricode: code }).eq('id', team.id);
                          if (error) { Alert.alert('Error', error.message); return; }
                          queryClient.invalidateQueries({ queryKey: ['league'] });
                        },
                        'plain-text',
                        team.tricode ?? '',
                      );
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
                {team.is_commissioner && (
                  <View style={[styles.commBadge, { backgroundColor: c.activeCard, borderColor: c.activeBorder }]}>
                    <ThemedText style={[styles.commBadgeText, { color: c.activeText }]}>Commish</ThemedText>
                  </View>
                )}
              </View>
            );
          })}
        </View>

        {/* ── Announcements ── */}
        {(announcements ?? []).length > 0 && (
          <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">Announcements</ThemedText>
              {isCommissioner && (
                <TouchableOpacity onPress={() => setShowSendAnnouncement(true)} style={{ paddingHorizontal: 12, paddingVertical: 4 }} accessibilityRole="button" accessibilityLabel="Add announcement">
                  <Ionicons name="add-circle" size={22} color={c.accent} accessible={false} />
                </TouchableOpacity>
              )}
            </View>
            {(announcements ?? []).map((a, idx) => (
              <View
                key={a.id}
                style={[
                  styles.announcementRow,
                  idx < (announcements?.length ?? 1) - 1 && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border },
                ]}
              >
                <ThemedText style={[styles.announcementDate, { color: c.secondaryText }]}>
                  {new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </ThemedText>
                <ThemedText style={styles.announcementText}>{a.content}</ThemedText>
              </View>
            ))}
          </View>
        )}

        {/* ── Season History ── */}
        <SeasonHistory leagueId={league.id} />

      </ScrollView>

      {/* ── Settings Modals ── */}
      {leagueId && (
        <>
          <EditBasicsModal
            visible={showBasicsModal}
            onClose={() => setShowBasicsModal(false)}
            league={league}
            leagueId={leagueId}
          />
          <EditRosterModal
            visible={showRosterModal}
            onClose={() => setShowRosterModal(false)}
            leagueId={leagueId}
            rosterConfig={rosterConfig}
          />
          <EditScoringModal
            visible={showScoringModal}
            onClose={() => setShowScoringModal(false)}
            leagueId={leagueId}
            scoring={scoring}
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
          <PaymentLedgerModal
            visible={showPaymentLedger}
            leagueId={leagueId}
            season={league?.season ?? ''}
            buyInAmount={league?.buy_in_amount ?? null}
            teams={(league?.league_teams ?? []).map((t: any) => ({ id: t.id, name: t.name }))}
            onClose={() => setShowPaymentLedger(false)}
          />
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
        </>
      )}
    </SafeAreaView>
  );
}

// ── Sub-components ─────────────────────────────────────────────────

function Row({ label, value, c, last }: { label: string; value: string; c: any; last?: boolean }) {
  return (
    <View style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border }]}>
      <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>{label}</ThemedText>
      <ThemedText style={styles.rowValue}>{value}</ThemedText>
    </View>
  );
}

function SectionCard({
  title, c, editable, onEdit, children,
}: {
  title: string;
  c: any;
  editable?: boolean;
  onEdit?: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.sectionHeader}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle} accessibilityRole="header">{title}</ThemedText>
        {editable && onEdit && (
          <TouchableOpacity onPress={onEdit} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Edit ${title}`}>
            <Ionicons name="pencil" size={16} color={c.accent} accessible={false} />
          </TouchableOpacity>
        )}
      </View>
      {children}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { width: 70, paddingHorizontal: 8 },
  backText: { fontSize: 16, fontWeight: '500' },
  titleText: { fontSize: 16, textAlign: 'center' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  // Section card
  section: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 14,
    marginBottom: 12,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: { fontSize: 15 },

  // Rows
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  rowLabel: { fontSize: 14 },
  rowValue: { fontSize: 14, fontWeight: '500' },
  summaryText: { fontSize: 14, lineHeight: 22 },

  // Members
  memberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  commBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
  },
  commBadgeText: { fontSize: 11, fontWeight: '600' },
  tricodeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tricodeText: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },

  // Commissioner actions
  commAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  commActionText: { flex: 1, fontSize: 14 },
  commDivider: { borderBottomWidth: StyleSheet.hairlineWidth, marginVertical: 4 },
  announcementRow: { paddingVertical: 10, paddingHorizontal: 12 },
  announcementDate: { fontSize: 12, marginBottom: 2 },
  announcementText: { fontSize: 14 },

});
