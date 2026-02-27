import { ThemedText } from '@/components/ThemedText';
import { ReverseTradeModal } from '@/components/commissioner/ReverseTradeModal';
import { ForceAddDropModal } from '@/components/commissioner/ForceAddDropModal';
import { ForceRosterMoveModal } from '@/components/commissioner/ForceRosterMoveModal';
import { SeasonHistory } from '@/components/home/SeasonHistory';
import { NumberStepper } from '@/components/ui/NumberStepper';
import { SegmentedControl } from '@/components/ui/SegmentedControl';
import { Colors } from '@/constants/Colors';
import { LotteryOddsEditor } from '@/components/create-league/LotteryOddsEditor';
import {
  DEFAULT_ROSTER_SLOTS,
  DEFAULT_SCORING,
  DRAFT_TYPE_OPTIONS,
  ROOKIE_DRAFT_ORDER_OPTIONS,
  TIME_PER_PICK_OPTIONS,
  TRADE_VETO_OPTIONS,
  PLAYOFF_SEEDING_OPTIONS,
  SEEDING_DISPLAY,
  SEEDING_TO_DB,
  WAIVER_DAY_LABELS,
  WAIVER_TYPE_OPTIONS,
} from '@/constants/LeagueDefaults';
import { calcLotteryPoolSize, generateDefaultOdds, getPlayoffTeamOptions } from '@/utils/lottery';
import { useAppState } from '@/context/AppStateProvider';
import { useSession } from '@/context/AuthProvider';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useLeague } from '@/hooks/useLeague';
import { useLeagueRosterConfig } from '@/hooks/useLeagueRosterConfig';
import { useLeagueScoring } from '@/hooks/useLeagueScoring';
import { supabase } from '@/lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
const VETO_TO_DB: Record<string, string> = { Commissioner: 'commissioner', 'League Vote': 'league_vote', None: 'none' };
const ORDER_DISPLAY: Record<string, string> = { reverse_record: 'Reverse Record', lottery: 'Lottery' };
const ORDER_TO_DB: Record<string, string> = { 'Reverse Record': 'reverse_record', Lottery: 'lottery' };
const WAIVER_DISPLAY: Record<string, string> = { standard: 'Standard', faab: 'FAAB', none: 'None' };
const WAIVER_TO_DB: Record<string, string> = { Standard: 'standard', FAAB: 'faab', None: 'none' };
const DRAFT_TYPE_DISPLAY = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);

function positionLabel(pos: string): string {
  return DEFAULT_ROSTER_SLOTS.find((s) => s.position === pos)?.label ?? pos;
}
function statLabel(stat: string): string {
  return DEFAULT_SCORING.find((s) => s.stat_name === stat)?.label ?? stat;
}

// ── Main component ─────────────────────────────────────────────────

export default function LeagueInfoScreen() {
  const router = useRouter();
  const session = useSession();
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const queryClient = useQueryClient();
  const { leagueId } = useAppState();

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

  // ── Edit state ─────────────────────────────────────────────────

  const [editingSection, setEditingSection] = useState<SettingGroup | null>(null);
  const [saving, setSaving] = useState(false);

  // Basics edit state
  const [editName, setEditName] = useState('');
  const [editPrivate, setEditPrivate] = useState(false);

  // Trade edit state
  const [editVetoType, setEditVetoType] = useState('Commissioner');
  const [editReviewHours, setEditReviewHours] = useState(24);
  const [editVotesToVeto, setEditVotesToVeto] = useState(4);

  // Waiver edit state
  const [editWaiverType, setEditWaiverType] = useState('Standard');
  const [editWaiverPeriod, setEditWaiverPeriod] = useState(2);
  const [editFaabBudget, setEditFaabBudget] = useState(100);
  const [editWaiverDay, setEditWaiverDay] = useState(3);

  // Draft edit state
  const [editDraftType, setEditDraftType] = useState('Snake');
  const [editTimePick, setEditTimePick] = useState(90);
  const [editMaxYears, setEditMaxYears] = useState(3);
  const [editRookieRounds, setEditRookieRounds] = useState(2);
  const [editRookieOrder, setEditRookieOrder] = useState('Reverse Record');
  const [editLotteryDraws, setEditLotteryDraws] = useState(4);
  const [editLotteryOdds, setEditLotteryOdds] = useState<number[] | null>(null);

  // Season edit state
  const [editRegWeeks, setEditRegWeeks] = useState(20);
  const [editPlayoffWeeks, setEditPlayoffWeeks] = useState(3);
  const [editPlayoffTeams, setEditPlayoffTeams] = useState(8);
  const [editSeedingFormat, setEditSeedingFormat] = useState('Standard');
  const [editReseed, setEditReseed] = useState(false);

  // Modal state
  const [showRosterModal, setShowRosterModal] = useState(false);
  const [editRoster, setEditRoster] = useState<{ position: string; slot_count: number }[]>([]);
  const [showScoringModal, setShowScoringModal] = useState(false);
  const [editScoring, setEditScoring] = useState<{ stat_name: string; point_value: number }[]>([]);

  // Commissioner action modals
  const [showReverseTrade, setShowReverseTrade] = useState(false);
  const [showForceAddDrop, setShowForceAddDrop] = useState(false);
  const [showForceMove, setShowForceMove] = useState(false);
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

  // ── Enter edit mode helpers ────────────────────────────────────

  function enterEdit(group: SettingGroup) {
    if (!league) return;
    if (group === 'basics') {
      setEditName(league.name);
      setEditPrivate(league.private ?? false);
    } else if (group === 'trade') {
      setEditVetoType(VETO_DISPLAY[league.trade_veto_type] ?? 'Commissioner');
      setEditReviewHours(league.trade_review_period_hours ?? 24);
      setEditVotesToVeto(league.trade_votes_to_veto ?? 4);
    } else if (group === 'waivers') {
      setEditWaiverType(WAIVER_DISPLAY[league.waiver_type] ?? 'Standard');
      setEditWaiverPeriod(league.waiver_period_days ?? 2);
      setEditFaabBudget(league.faab_budget ?? 100);
      setEditWaiverDay(league.waiver_day_of_week ?? 3);
    } else if (group === 'draft' && draft) {
      setEditDraftType(DRAFT_TYPE_DISPLAY(draft.draft_type ?? 'snake'));
      setEditTimePick(draft.time_limit ?? 90);
      setEditMaxYears(league.max_future_seasons ?? 3);
      setEditRookieRounds(league.rookie_draft_rounds ?? 2);
      setEditRookieOrder(ORDER_DISPLAY[league.rookie_draft_order] ?? 'Reverse Record');
      setEditLotteryDraws(league.lottery_draws ?? 4);
      setEditLotteryOdds(league.lottery_odds ?? null);
    } else if (group === 'season') {
      setEditRegWeeks(league.regular_season_weeks ?? 20);
      setEditPlayoffWeeks(league.playoff_weeks ?? 3);
      setEditPlayoffTeams(league.playoff_teams ?? Math.min(2 ** (league.playoff_weeks ?? 3), teamCount));
      setEditSeedingFormat(SEEDING_DISPLAY[league.playoff_seeding_format] ?? 'Standard');
      setEditReseed(league.reseed_each_round ?? false);
    }
    setEditingSection(group);
  }

  function openRosterModal() {
    if (!rosterConfig) return;
    // Build full position list from defaults, merging in current values
    const merged = DEFAULT_ROSTER_SLOTS.map((d) => {
      const existing = rosterConfig.find((r) => r.position === d.position);
      return { position: d.position, slot_count: existing?.slot_count ?? 0 };
    });
    setEditRoster(merged);
    setShowRosterModal(true);
  }

  function openScoringModal() {
    if (!scoring) return;
    const merged = DEFAULT_SCORING.map((d) => {
      const existing = scoring.find((s) => s.stat_name === d.stat_name);
      return { stat_name: d.stat_name, point_value: existing?.point_value ?? d.point_value };
    });
    setEditScoring(merged);
    setShowScoringModal(true);
  }

  // ── Save handlers ──────────────────────────────────────────────

  async function saveBasics() {
    if (!league) return;
    setSaving(true);
    const { error } = await supabase
      .from('leagues')
      .update({ name: editName.trim(), private: editPrivate })
      .eq('id', league.id);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    setEditingSection(null);
  }

  async function saveTrade() {
    if (!league) return;
    setSaving(true);
    const vetoDb = VETO_TO_DB[editVetoType] ?? 'commissioner';
    const { error } = await supabase
      .from('leagues')
      .update({
        trade_veto_type: vetoDb,
        trade_review_period_hours: vetoDb === 'none' ? 0 : editReviewHours,
        trade_votes_to_veto: editVotesToVeto,
      })
      .eq('id', league.id);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    setEditingSection(null);
  }

  async function saveWaivers() {
    if (!league) return;
    setSaving(true);
    const waiverDb = WAIVER_TO_DB[editWaiverType] ?? 'standard';
    const { error } = await supabase
      .from('leagues')
      .update({
        waiver_type: waiverDb,
        waiver_period_days: waiverDb === 'none' ? 0 : editWaiverPeriod,
        faab_budget: editFaabBudget,
        waiver_day_of_week: editWaiverDay,
      })
      .eq('id', league.id);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    setEditingSection(null);
  }

  async function saveDraft() {
    if (!league || !draft) return;
    setSaving(true);
    // Update leagues table fields
    const { error: leagueErr } = await supabase
      .from('leagues')
      .update({
        max_future_seasons: editMaxYears,
        rookie_draft_rounds: editRookieRounds,
        rookie_draft_order: ORDER_TO_DB[editRookieOrder] ?? 'reverse_record',
        lottery_draws: editLotteryDraws,
        lottery_odds: editLotteryOdds,
      })
      .eq('id', league.id);
    // Update drafts table fields
    const { error: draftErr } = await supabase
      .from('drafts')
      .update({
        draft_type: editDraftType.toLowerCase(),
        time_limit: editTimePick,
      })
      .eq('id', draft.id);
    setSaving(false);
    if (leagueErr || draftErr) {
      Alert.alert('Error', (leagueErr ?? draftErr)!.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['leagueDraft', leagueId] });
    setEditingSection(null);
  }

  async function saveSeason() {
    if (!league) return;
    setSaving(true);
    const { error } = await supabase
      .from('leagues')
      .update({
        regular_season_weeks: editRegWeeks,
        playoff_weeks: editPlayoffWeeks,
        playoff_teams: editPlayoffTeams,
        playoff_seeding_format: SEEDING_TO_DB[editSeedingFormat] ?? 'standard',
        reseed_each_round: editReseed,
      })
      .eq('id', league.id);
    setSaving(false);
    if (error) { Alert.alert('Error', error.message); return; }
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    setEditingSection(null);
  }

  async function saveRoster() {
    if (!leagueId) return;
    setSaving(true);
    const rows = editRoster
      .filter((r) => r.slot_count > 0)
      .map((r) => ({ league_id: leagueId, position: r.position, slot_count: r.slot_count }));
    const rosterSize = rows.reduce((sum, r) => {
      // IR doesn't count toward roster_size
      return r.position === 'IR' ? sum : sum + r.slot_count;
    }, 0);
    const { error: delErr } = await supabase.from('league_roster_config').delete().eq('league_id', leagueId);
    if (delErr) { setSaving(false); Alert.alert('Error', delErr.message); return; }
    const { error: insErr } = await supabase.from('league_roster_config').insert(rows);
    if (insErr) { setSaving(false); Alert.alert('Error', insErr.message); return; }
    await supabase.from('leagues').update({ roster_size: rosterSize }).eq('id', leagueId);
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['leagueRosterConfig', leagueId] });
    queryClient.invalidateQueries({ queryKey: ['league', leagueId] });
    setShowRosterModal(false);
  }

  async function saveScoring() {
    if (!leagueId) return;
    setSaving(true);
    const rows = editScoring.map((s) => ({
      league_id: leagueId,
      stat_name: s.stat_name,
      point_value: s.point_value,
    }));
    const { error: delErr } = await supabase.from('league_scoring_settings').delete().eq('league_id', leagueId);
    if (delErr) { setSaving(false); Alert.alert('Error', delErr.message); return; }
    const { error: insErr } = await supabase.from('league_scoring_settings').insert(rows);
    if (insErr) { setSaving(false); Alert.alert('Error', insErr.message); return; }
    setSaving(false);
    queryClient.invalidateQueries({ queryKey: ['leagueScoring', leagueId] });
    setShowScoringModal(false);
  }

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
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: c.border }]}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
          <Text style={[styles.backText, { color: c.accent }]}>‹ Back</Text>
        </TouchableOpacity>
        <ThemedText type="defaultSemiBold" style={styles.titleText}>League Info</ThemedText>
        <View style={styles.backBtn} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

        {/* ── League Basics ── */}
        <SectionCard title="League Basics" c={c} editable={sectionEditable('basics', lifecycle, isCommissioner)} editing={editingSection === 'basics'} onEdit={() => enterEdit('basics')} onCancel={() => setEditingSection(null)} onSave={saveBasics} saving={saving}>
          {editingSection === 'basics' ? (
            <>
              <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>Name</ThemedText>
                <TextInput
                  style={[styles.textInput, { color: c.text, backgroundColor: c.input, borderColor: c.border }]}
                  value={editName}
                  onChangeText={setEditName}
                  placeholder="League name"
                  placeholderTextColor={c.secondaryText}
                />
              </View>
              <View style={styles.editRow}>
                <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>Visibility</ThemedText>
                <View style={{ width: 160 }}>
                  <SegmentedControl
                    options={['Public', 'Private']}
                    selectedIndex={editPrivate ? 1 : 0}
                    onSelect={(i) => setEditPrivate(i === 1)}
                  />
                </View>
              </View>
            </>
          ) : (
            <>
              <Row label="Name" value={league.name} c={c} />
              <Row label="Visibility" value={league.private ? 'Private' : 'Public'} c={c} />
              {league.private && league.invite_code && (
                <Row label="Invite Code" value={league.invite_code} c={c} />
              )}
              <Row label="Teams" value={`${teamCount}`} c={c} />
              <Row label="Season" value={league.season} c={c} />
              {commissionerTeam && <Row label="Commissioner" value={commissionerTeam.name} c={c} last />}
            </>
          )}
        </SectionCard>

        {/* ── Roster Configuration ── */}
        <SectionCard title={`Roster (${league.roster_size ?? '?'} slots)`} c={c} editable={sectionEditable('roster', lifecycle, isCommissioner)} onEdit={openRosterModal}>
          <ThemedText style={[styles.summaryText, { color: c.secondaryText }]}>
            {rosterConfig
              ? rosterConfig.map((r) => `${r.position}: ${r.slot_count}`).join('  |  ')
              : 'Loading...'}
          </ThemedText>
        </SectionCard>

        {/* ── Scoring ── */}
        <SectionCard title="Scoring" c={c} editable={sectionEditable('scoring', lifecycle, isCommissioner)} onEdit={openScoringModal}>
          <ThemedText style={[styles.summaryText, { color: c.secondaryText }]}>
            {scoring
              ? scoring.map((s) => `${s.stat_name}: ${s.point_value > 0 ? '+' : ''}${s.point_value}`).join('  |  ')
              : 'Loading...'}
          </ThemedText>
        </SectionCard>

        {/* ── Draft Settings ── */}
        <SectionCard title="Draft Settings" c={c} editable={sectionEditable('draft', lifecycle, isCommissioner)} editing={editingSection === 'draft'} onEdit={() => enterEdit('draft')} onCancel={() => setEditingSection(null)} onSave={saveDraft} saving={saving}>
          {editingSection === 'draft' && draft ? (
            <>
              <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>Type</ThemedText>
                <View style={{ width: 160 }}>
                  <SegmentedControl
                    options={DRAFT_TYPE_OPTIONS}
                    selectedIndex={DRAFT_TYPE_OPTIONS.indexOf(editDraftType as any)}
                    onSelect={(i) => setEditDraftType(DRAFT_TYPE_OPTIONS[i])}
                  />
                </View>
              </View>
              <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>Time Per Pick</ThemedText>
                <View style={{ width: 200 }}>
                  <SegmentedControl
                    options={TIME_PER_PICK_OPTIONS.map((t) => `${t}s`)}
                    selectedIndex={TIME_PER_PICK_OPTIONS.indexOf(editTimePick as any)}
                    onSelect={(i) => setEditTimePick(TIME_PER_PICK_OPTIONS[i])}
                  />
                </View>
              </View>
              <NumberStepper label="Future Draft Years" value={editMaxYears} onValueChange={setEditMaxYears} min={1} max={10} />
              <NumberStepper label="Rookie Draft Rounds" value={editRookieRounds} onValueChange={setEditRookieRounds} min={1} max={5} />
              <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>Rookie Draft Order</ThemedText>
                <View style={{ width: 220 }}>
                  <SegmentedControl
                    options={[...ROOKIE_DRAFT_ORDER_OPTIONS]}
                    selectedIndex={ROOKIE_DRAFT_ORDER_OPTIONS.indexOf(editRookieOrder as any)}
                    onSelect={(i) => setEditRookieOrder(ROOKIE_DRAFT_ORDER_OPTIONS[i])}
                  />
                </View>
              </View>
              {editRookieOrder === 'Lottery' && (() => {
                const pt = league.playoff_teams ?? Math.min(2 ** (league.playoff_weeks ?? 3), teamCount);
                const lotteryPool = calcLotteryPoolSize(teamCount, pt);
                const effectiveOdds = editLotteryOdds ?? generateDefaultOdds(lotteryPool);
                if (lotteryPool <= 0) return (
                  <ThemedText style={{ fontSize: 13, color: '#b91c1c', marginTop: 4 }}>
                    All teams make playoffs — no lottery pool.
                  </ThemedText>
                );
                return (
                  <>
                    <ThemedText style={{ fontSize: 13, color: c.secondaryText, marginTop: 4, marginBottom: 8 }}>
                      {lotteryPool} non-playoff team{lotteryPool !== 1 ? 's' : ''} in the lottery
                    </ThemedText>
                    <NumberStepper label="Lottery Draws" value={editLotteryDraws} onValueChange={setEditLotteryDraws} min={1} max={lotteryPool} />
                    <View style={{ marginTop: 12 }}>
                      <LotteryOddsEditor odds={effectiveOdds} onChange={setEditLotteryOdds} lotteryTeams={lotteryPool} />
                    </View>
                  </>
                );
              })()}
            </>
          ) : (
            <>
              <Row label="Type" value={draft ? DRAFT_TYPE_DISPLAY(draft.draft_type ?? 'snake') : '-'} c={c} />
              <Row label="Time Per Pick" value={draft ? `${draft.time_limit ?? 90}s` : '-'} c={c} />
              <Row label="Status" value={draft ? (draft.status.charAt(0).toUpperCase() + draft.status.slice(1).replace('_', ' ')) : '-'} c={c} />
              <Row label="Future Draft Years" value={String(league.max_future_seasons ?? '-')} c={c} />
              <Row label="Rookie Draft Rounds" value={String(league.rookie_draft_rounds ?? '-')} c={c} />
              <Row label="Rookie Draft Order" value={ORDER_DISPLAY[league.rookie_draft_order] ?? '-'} c={c} />
              {league.rookie_draft_order === 'lottery' && (
                <Row label="Lottery Draws" value={String(league.lottery_draws ?? '-')} c={c} last />
              )}
            </>
          )}
        </SectionCard>

        {/* ── Trade Settings ── */}
        <SectionCard title="Trade Settings" c={c} editable={sectionEditable('trade', lifecycle, isCommissioner)} editing={editingSection === 'trade'} onEdit={() => enterEdit('trade')} onCancel={() => setEditingSection(null)} onSave={saveTrade} saving={saving}>
          {editingSection === 'trade' ? (
            <>
              <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>Veto Type</ThemedText>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <SegmentedControl
                    options={[...TRADE_VETO_OPTIONS]}
                    selectedIndex={TRADE_VETO_OPTIONS.indexOf(editVetoType as any)}
                    onSelect={(i) => setEditVetoType(TRADE_VETO_OPTIONS[i])}
                  />
                </View>
              </View>
              {editVetoType !== 'None' && (
                <NumberStepper label="Review Period (hrs)" value={editReviewHours} onValueChange={setEditReviewHours} min={1} max={72} />
              )}
              {editVetoType === 'League Vote' && (
                <NumberStepper label="Votes to Veto" value={editVotesToVeto} onValueChange={setEditVotesToVeto} min={1} max={teamCount - 1} />
              )}
            </>
          ) : (
            <>
              <Row label="Veto Type" value={VETO_DISPLAY[league.trade_veto_type] ?? '-'} c={c} />
              {league.trade_veto_type !== 'none' && (
                <Row label="Review Period" value={`${league.trade_review_period_hours ?? 0} hrs`} c={c} />
              )}
              {league.trade_veto_type === 'league_vote' && (
                <Row label="Votes to Veto" value={String(league.trade_votes_to_veto ?? '-')} c={c} last />
              )}
            </>
          )}
        </SectionCard>

        {/* ── Waiver Settings ── */}
        <SectionCard title="Waiver Settings" c={c} editable={sectionEditable('waivers', lifecycle, isCommissioner)} editing={editingSection === 'waivers'} onEdit={() => enterEdit('waivers')} onCancel={() => setEditingSection(null)} onSave={saveWaivers} saving={saving}>
          {editingSection === 'waivers' ? (
            <>
              <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>Waiver Type</ThemedText>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <SegmentedControl
                    options={[...WAIVER_TYPE_OPTIONS]}
                    selectedIndex={WAIVER_TYPE_OPTIONS.indexOf(editWaiverType as any)}
                    onSelect={(i) => setEditWaiverType(WAIVER_TYPE_OPTIONS[i])}
                  />
                </View>
              </View>
              {editWaiverType !== 'None' && (
                <NumberStepper label="Waiver Period (days)" value={editWaiverPeriod} onValueChange={setEditWaiverPeriod} min={1} max={5} />
              )}
              {editWaiverType === 'FAAB' && (
                <>
                  <View style={[styles.editRow, { borderBottomColor: c.border }]}>
                    <ThemedText style={[styles.rowLabel, { color: c.secondaryText }]}>Process Day</ThemedText>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <SegmentedControl
                        options={[...WAIVER_DAY_LABELS]}
                        selectedIndex={editWaiverDay}
                        onSelect={(i) => setEditWaiverDay(i)}
                      />
                    </View>
                  </View>
                  <NumberStepper label="FAAB Budget ($)" value={editFaabBudget} onValueChange={setEditFaabBudget} min={10} max={1000} step={10} />
                </>
              )}
            </>
          ) : (
            <>
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
            </>
          )}
        </SectionCard>

        {/* ── Season Settings ── */}
        <SectionCard title="Season" c={c} editable={sectionEditable('season', lifecycle, isCommissioner)} editing={editingSection === 'season'} onEdit={() => enterEdit('season')} onCancel={() => setEditingSection(null)} onSave={saveSeason} saving={saving}>
          {editingSection === 'season' ? (
            <>
              <Row label="Start Date" value={league.season_start_date ?? '-'} c={c} />
              <NumberStepper label="Regular Season Weeks" value={editRegWeeks} onValueChange={setEditRegWeeks} min={1} max={30} />
              <NumberStepper label="Playoff Weeks" value={editPlayoffWeeks} onValueChange={(v) => {
                setEditPlayoffWeeks(v);
                // Auto-adjust playoff teams to closest valid option
                const options = getPlayoffTeamOptions(v, teamCount);
                if (!options.includes(editPlayoffTeams)) {
                  const closest = options.reduce((best, o) => Math.abs(o - editPlayoffTeams) < Math.abs(best - editPlayoffTeams) ? o : best, options[0]);
                  setEditPlayoffTeams(closest);
                }
              }} min={1} max={6} />
              {(() => {
                const options = getPlayoffTeamOptions(editPlayoffWeeks, teamCount);
                return (
                  <View style={{ marginTop: 8 }}>
                    <ThemedText style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: c.secondaryText }}>Playoff Teams</ThemedText>
                    <SegmentedControl
                      options={options.map(String)}
                      selectedIndex={Math.max(0, options.indexOf(editPlayoffTeams))}
                      onSelect={(i) => setEditPlayoffTeams(options[i])}
                    />
                  </View>
                );
              })()}
              <View style={{ marginTop: 12 }}>
                <ThemedText style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: c.secondaryText }}>Seeding Format</ThemedText>
                <SegmentedControl
                  options={[...PLAYOFF_SEEDING_OPTIONS]}
                  selectedIndex={PLAYOFF_SEEDING_OPTIONS.indexOf(editSeedingFormat as any)}
                  onSelect={(i) => {
                    setEditSeedingFormat(PLAYOFF_SEEDING_OPTIONS[i]);
                    if (PLAYOFF_SEEDING_OPTIONS[i] === 'Fixed Bracket') setEditReseed(false);
                  }}
                />
              </View>
              {editSeedingFormat === 'Standard' && (
                <View style={{ marginTop: 12 }}>
                  <ThemedText style={{ fontSize: 14, fontWeight: '500', marginBottom: 8, color: c.secondaryText }}>Reseed Each Round</ThemedText>
                  <SegmentedControl
                    options={['Yes', 'No']}
                    selectedIndex={editReseed ? 0 : 1}
                    onSelect={(i) => setEditReseed(i === 0)}
                  />
                </View>
              )}
            </>
          ) : (
            <>
              <Row label="Start Date" value={league.season_start_date ? new Date(league.season_start_date + 'T00:00:00').toLocaleDateString() : '-'} c={c} />
              <Row label="Regular Season" value={`${league.regular_season_weeks ?? '-'} weeks`} c={c} />
              <Row label="Playoffs" value={`${league.playoff_weeks ?? '-'} weeks`} c={c} />
              <Row label="Playoff Teams" value={String(league.playoff_teams ?? '-')} c={c} />
              <Row label="Seeding Format" value={SEEDING_DISPLAY[league.playoff_seeding_format] ?? 'Standard'} c={c} />
              {league.playoff_seeding_format === 'standard' && (
                <Row label="Reseed Each Round" value={league.reseed_each_round ? 'Yes' : 'No'} c={c} />
              )}
              <Row label="Schedule" value={league.schedule_generated ? 'Generated' : 'Not yet generated'} c={c} last />
            </>
          )}
        </SectionCard>

        {/* ── Members ── */}
        <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
          <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Members</ThemedText>
          {(league.league_teams ?? []).map((team: any, idx: number) => (
            <View
              key={team.id}
              style={[styles.memberRow, idx === (league.league_teams?.length ?? 0) - 1 && { borderBottomWidth: 0 }, { borderBottomColor: c.border }]}
            >
              <ThemedText>{team.name}</ThemedText>
              {team.is_commissioner && (
                <View style={[styles.commBadge, { backgroundColor: c.activeCard, borderColor: c.activeBorder }]}>
                  <ThemedText style={[styles.commBadgeText, { color: c.activeText }]}>Commish</ThemedText>
                </View>
              )}
            </View>
          ))}
        </View>

        {/* ── Season History ── */}
        <SeasonHistory leagueId={league.id} />

        {/* ── Commissioner Actions ── */}
        {isCommissioner && (
          <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
            <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>Commissioner Actions</ThemedText>
            {/* Advance to Offseason — only show when season is complete (mid_season + no active offseason) */}
            {lifecycle === 'mid_season' && !league?.offseason_step && (
              <TouchableOpacity
                style={[styles.commAction, { borderBottomColor: c.border }, advancingseason && { opacity: 0.6 }]}
                onPress={handleAdvanceSeason}
                disabled={advancingseason}
              >
                <Ionicons name="calendar" size={18} color="#FF9500" />
                <ThemedText style={[styles.commActionText, { color: '#FF9500' }]}>Advance to Offseason</ThemedText>
                {advancingseason ? (
                  <ActivityIndicator size="small" color="#FF9500" />
                ) : (
                  <Ionicons name="chevron-forward" size={16} color={c.secondaryText} />
                )}
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.commAction, { borderBottomColor: c.border }]}
              onPress={() => setShowReverseTrade(true)}
            >
              <Ionicons name="arrow-undo" size={18} color={c.text} />
              <ThemedText style={styles.commActionText}>Reverse Trade</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={c.secondaryText} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.commAction, { borderBottomColor: c.border }]}
              onPress={() => setShowForceAddDrop(true)}
            >
              <Ionicons name="person-add" size={18} color={c.text} />
              <ThemedText style={styles.commActionText}>Force Add/Drop</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={c.secondaryText} />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.commAction, { borderBottomWidth: 0 }]}
              onPress={() => setShowForceMove(true)}
            >
              <Ionicons name="swap-vertical" size={18} color={c.text} />
              <ThemedText style={styles.commActionText}>Force Roster Move</ThemedText>
              <Ionicons name="chevron-forward" size={16} color={c.secondaryText} />
            </TouchableOpacity>
          </View>
        )}

      </ScrollView>

      {/* ── Roster Edit Modal ── */}
      <Modal visible={showRosterModal} animationType="slide" transparent onRequestClose={() => setShowRosterModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: c.card }]}>
            <ThemedText type="subtitle" style={styles.modalTitle}>Edit Roster</ThemedText>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {editRoster.map((slot, idx) => (
                <NumberStepper
                  key={slot.position}
                  label={positionLabel(slot.position)}
                  value={slot.slot_count}
                  onValueChange={(v) => {
                    const next = [...editRoster];
                    next[idx] = { ...slot, slot_count: v };
                    setEditRoster(next);
                  }}
                  min={0}
                  max={slot.position === 'IR' ? 5 : 10}
                />
              ))}
            </ScrollView>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: c.cardAlt }]} onPress={() => setShowRosterModal(false)}>
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: saving ? c.buttonDisabled : c.accent }]} onPress={saveRoster} disabled={saving}>
                {saving ? <ActivityIndicator color={c.accentText} size="small" /> : <Text style={{ color: c.accentText, fontWeight: '600' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Scoring Edit Modal ── */}
      <Modal visible={showScoringModal} animationType="slide" transparent onRequestClose={() => setShowScoringModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: c.card }]}>
            <ThemedText type="subtitle" style={styles.modalTitle}>Edit Scoring</ThemedText>
            <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
              {editScoring.map((s, idx) => (
                <NumberStepper
                  key={s.stat_name}
                  label={statLabel(s.stat_name)}
                  value={s.point_value}
                  onValueChange={(v) => {
                    const next = [...editScoring];
                    next[idx] = { ...s, point_value: v };
                    setEditScoring(next);
                  }}
                  min={-10}
                  max={10}
                  step={0.5}
                />
              ))}
            </ScrollView>
            <View style={styles.modalButtons}>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: c.cardAlt }]} onPress={() => setShowScoringModal(false)}>
                <ThemedText>Cancel</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.modalBtn, { backgroundColor: saving ? c.buttonDisabled : c.accent }]} onPress={saveScoring} disabled={saving}>
                {saving ? <ActivityIndicator color={c.accentText} size="small" /> : <Text style={{ color: c.accentText, fontWeight: '600' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Commissioner Modals ── */}
      {isCommissioner && leagueId && (
        <>
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
  title, c, editable, editing, onEdit, onCancel, onSave, saving, children,
}: {
  title: string;
  c: any;
  editable?: boolean;
  editing?: boolean;
  onEdit?: () => void;
  onCancel?: () => void;
  onSave?: () => void;
  saving?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <View style={styles.sectionHeader}>
        <ThemedText type="defaultSemiBold" style={styles.sectionTitle}>{title}</ThemedText>
        {editable && !editing && onEdit && (
          <TouchableOpacity onPress={onEdit} hitSlop={8}>
            <Ionicons name="pencil" size={16} color={c.accent} />
          </TouchableOpacity>
        )}
      </View>
      {children}
      {editing && (
        <View style={styles.editActions}>
          <TouchableOpacity style={[styles.editBtn, { backgroundColor: c.cardAlt }]} onPress={onCancel}>
            <ThemedText style={{ fontSize: 14 }}>Cancel</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.editBtn, { backgroundColor: saving ? c.buttonDisabled : c.accent }]} onPress={onSave} disabled={saving}>
            {saving ? <ActivityIndicator color={c.accentText} size="small" /> : <Text style={{ color: c.accentText, fontWeight: '600', fontSize: 14 }}>Save</Text>}
          </TouchableOpacity>
        </View>
      )}
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

  // Edit mode
  editRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  textInput: {
    flex: 1,
    marginLeft: 12,
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 14,
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 12,
  },
  editBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
  },

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

  // Commissioner actions
  commAction: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  commActionText: { flex: 1, fontSize: 14 },

  // Modals
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    maxHeight: '80%',
  },
  modalTitle: { marginBottom: 16 },
  modalScroll: { marginBottom: 16 },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
  },
  modalBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    minWidth: 80,
  },
});
