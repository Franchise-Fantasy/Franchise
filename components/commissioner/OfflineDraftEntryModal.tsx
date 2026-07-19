import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Alert, FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';

import { PlayerName } from '@/components/player/PlayerName';
import { TeamLogo } from '@/components/team/TeamLogo';
import { AppTextInput } from '@/components/ui/AppTextInput';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { BrandButton } from '@/components/ui/BrandButton';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useConfirm } from '@/context/ConfirmProvider';
import { useColors } from '@/hooks/useColors';
import { publishOfflineDraft, saveOfflineDraft } from '@/lib/draft';
import { supabase } from '@/lib/supabase';
import { foldSearchText } from '@/utils/formatting';
import { ms, s } from '@/utils/scale';

interface Props {
  visible: boolean;
  onClose: () => void;
  draftId: string;
  leagueId: string;
  sport: string;
}

type DraftPickRow = {
  pick_number: number;
  round: number;
  team: { id: string; name: string; tricode: string | null; logo_key: string | null } | null;
};

type PoolPlayer = { player_id: string; name: string; position: string | null };

/**
 * Commissioner batch-entry sheet for an offline rookie draft. Lists every pick
 * in order; each row assigns the rookie that pick landed on. Selections are held
 * locally, persisted with "Save Draft" (durability + reopen), and committed with
 * "Publish Results" — which drafts the players onto rosters and finishes the
 * draft. Two views: the pick list and a per-pick player picker.
 *
 * The outer component loads the persisted staged picks, then key-remounts the
 * form so its editable state initializes cleanly from that data (no effect/ref
 * seeding). The key bumps whenever the staged query refetches (e.g. after a
 * reopen), re-seeding the form from the latest saved state.
 */
export function OfflineDraftEntryModal({ visible, onClose, draftId, leagueId, sport }: Props) {
  const { data: staged, dataUpdatedAt } = useQuery<Record<number, string>>({
    queryKey: ['offlineDraftStaged', draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('drafts')
        .select('offline_picks')
        .eq('id', draftId)
        .single();
      if (error) throw error;
      const rows = (data?.offline_picks as { pick_number: number; player_id: string }[] | null) ?? [];
      return Object.fromEntries(rows.map((r) => [r.pick_number, r.player_id]));
    },
    enabled: visible && !!draftId,
  });

  if (staged === undefined) {
    return (
      <BottomSheet visible={visible} onClose={onClose} title="Enter Draft Results" height="92%">
        <View style={{ marginTop: s(24) }}>
          <LogoSpinner />
        </View>
      </BottomSheet>
    );
  }

  return (
    <OfflineDraftEntryForm
      key={`${draftId}:${dataUpdatedAt}`}
      visible={visible}
      onClose={onClose}
      draftId={draftId}
      leagueId={leagueId}
      sport={sport}
      initialAssignments={staged}
    />
  );
}

function OfflineDraftEntryForm({
  visible,
  onClose,
  draftId,
  leagueId,
  sport,
  initialAssignments,
}: Props & { initialAssignments: Record<number, string> }) {
  const c = useColors();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  // pick_number the commissioner is currently choosing a player for; null shows
  // the pick list.
  const [pickingFor, setPickingFor] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  // pick_number -> player_id. Seeded from the persisted staged picks.
  const [assignments, setAssignments] = useState<Record<number, string>>(initialAssignments);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Ordered pick board with owning team.
  const { data: picks, isLoading: picksLoading } = useQuery<DraftPickRow[]>({
    queryKey: ['offlineDraftPicks', draftId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('draft_picks')
        .select('pick_number, round, teams:teams!draft_picks_current_team_id_fkey(id, name, tricode, logo_key)')
        .eq('draft_id', draftId)
        .order('pick_number', { ascending: true });
      if (error) throw error;
      return (data ?? []).map((p: any) => ({
        pick_number: p.pick_number,
        round: p.round,
        team: p.teams ?? null,
      }));
    },
    enabled: visible && !!draftId,
  });

  // Rookie pool — same source as the live draft (rookie=true, not yet rostered).
  const { data: pool, isLoading: poolLoading } = useQuery<PoolPlayer[]>({
    queryKey: ['offlineDraftRookiePool', leagueId, sport],
    queryFn: async () => {
      const { data: rostered } = await supabase
        .from('league_players')
        .select('player_id')
        .eq('league_id', leagueId);
      const rosteredIds = (rostered ?? []).map((r) => String(r.player_id));

      let query = supabase
        .from('player_season_stats')
        .select('player_id, name, position')
        .eq('sport', sport)
        .eq('rookie', true)
        .order('avg_pts', { ascending: false });
      if (rosteredIds.length > 0) {
        query = query.filter('player_id', 'not.in', `(${rosteredIds.join(',')})`);
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as PoolPlayer[];
    },
    enabled: visible && !!leagueId,
  });

  const poolById = useMemo(() => new Map((pool ?? []).map((p) => [p.player_id, p])), [pool]);

  // Player ids already assigned to a different pick — excluded from the picker
  // so the same rookie can't be entered twice.
  const takenElsewhere = useMemo(() => {
    const set = new Set<string>();
    for (const [pn, pid] of Object.entries(assignments)) {
      if (Number(pn) !== pickingFor) set.add(pid);
    }
    return set;
  }, [assignments, pickingFor]);

  function handleClose() {
    setPickingFor(null);
    setSearch('');
    onClose();
  }

  function assign(pickNumber: number, playerId: string) {
    setAssignments((prev) => ({ ...prev, [pickNumber]: playerId }));
    setPickingFor(null);
    setSearch('');
  }

  function clearPick(pickNumber: number) {
    setAssignments((prev) => {
      const next = { ...prev };
      delete next[pickNumber];
      return next;
    });
  }

  function toPayload() {
    return Object.entries(assignments).map(([pn, pid]) => ({
      pick_number: Number(pn),
      player_id: pid,
    }));
  }

  async function handleSave() {
    setSaving(true);
    try {
      await saveOfflineDraft(draftId, toPayload());
      queryClient.invalidateQueries({ queryKey: ['offlineDraftStaged', draftId] });
      handleClose();
    } catch (err) {
      Alert.alert('Error', (err instanceof Error && err.message) || 'Failed to save draft');
    } finally {
      setSaving(false);
    }
  }

  function handlePublish() {
    const total = picks?.length ?? 0;
    const filled = Object.keys(assignments).length;
    const empties = total - filled;
    confirm({
      title: 'Publish Results',
      message:
        (empties > 0
          ? `${empties} of ${total} picks have no player assigned and will be skipped. `
          : '') +
        'This drafts the selected rookies onto their rosters and notifies the league. Continue?',
      action: {
        label: 'Publish',
        onPress: async () => {
          setPublishing(true);
          try {
            await publishOfflineDraft(draftId, toPayload());
            queryClient.invalidateQueries({ queryKey: queryKeys.league(leagueId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.activeDraft(leagueId) });
            queryClient.invalidateQueries({ queryKey: queryKeys.draftHub(leagueId) });
            queryClient.invalidateQueries({ queryKey: ['leagueRookieDraft', leagueId] });
            Alert.alert('Published', 'The offline rookie draft results are in.');
            handleClose();
          } catch (err) {
            Alert.alert('Error', (err instanceof Error && err.message) || 'Failed to publish results');
          } finally {
            setPublishing(false);
          }
        },
      },
    });
  }

  const filteredPool = useMemo(() => {
    const key = foldSearchText(search);
    return (pool ?? []).filter(
      (p) => !takenElsewhere.has(p.player_id) && foldSearchText(p.name).includes(key),
    );
  }, [pool, search, takenElsewhere]);

  const busy = saving || publishing;

  return (
    <BottomSheet
      visible={visible}
      onClose={handleClose}
      title={pickingFor != null ? `Pick ${pickingFor}` : 'Enter Draft Results'}
      subtitle={pickingFor != null ? 'Choose the rookie for this pick' : 'Assign the rookie each pick landed on'}
      height="92%"
      scrollableBody={false}
      headerAction={
        pickingFor != null ? (
          <TouchableOpacity
            onPress={() => {
              setPickingFor(null);
              setSearch('');
            }}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            accessibilityRole="button"
            accessibilityLabel="Back to pick list"
          >
            <Ionicons name="arrow-back" size={ms(22)} color={c.secondaryText} />
          </TouchableOpacity>
        ) : undefined
      }
      footer={
        pickingFor == null ? (
          <View style={styles.footer}>
            <BrandButton
              label="Save Draft"
              variant="secondary"
              size="large"
              onPress={handleSave}
              loading={saving}
              disabled={busy}
              fullWidth
              style={styles.footerBtn}
              accessibilityLabel="Save draft progress"
            />
            <BrandButton
              label="Publish Results"
              variant="primary"
              size="large"
              onPress={handlePublish}
              loading={publishing}
              disabled={busy || (picks?.length ?? 0) === 0}
              fullWidth
              style={styles.footerBtn}
              accessibilityLabel="Publish offline draft results"
            />
          </View>
        ) : undefined
      }
    >
      {pickingFor != null ? (
        // ── Player picker ──────────────────────────────────────────────────
        <>
          <AppTextInput
            accessibilityLabel="Search rookies"
            style={[styles.searchInput, { backgroundColor: c.cardAlt, color: c.text, borderColor: c.border }]}
            placeholder="Search rookies..."
            placeholderTextColor={c.secondaryText}
            value={search}
            onChangeText={setSearch}
          />
          {poolLoading ? (
            <View style={{ marginTop: s(20) }}>
              <LogoSpinner />
            </View>
          ) : filteredPool.length === 0 ? (
            <ThemedText style={[styles.empty, { color: c.secondaryText }]}>No rookies found.</ThemedText>
          ) : (
            <FlatList
              data={filteredPool}
              keyExtractor={(p) => p.player_id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item, index }) => (
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel={`Assign ${item.name}${item.position ? `, ${item.position}` : ''} to pick ${pickingFor}`}
                  style={[styles.row, { borderBottomColor: c.border }, index === filteredPool.length - 1 && { borderBottomWidth: 0 }]}
                  onPress={() => assign(pickingFor, item.player_id)}
                >
                  <View style={{ flex: 1 }}>
                    <PlayerName name={item.name} type="defaultSemiBold" style={{ fontSize: ms(14) }} containerStyle={{ flexShrink: 1 }} />
                    {item.position ? (
                      <ThemedText style={[styles.sub, { color: c.secondaryText }]}>{item.position}</ThemedText>
                    ) : null}
                  </View>
                  <Ionicons name="add-circle-outline" size={20} color={c.secondaryText} />
                </TouchableOpacity>
              )}
            />
          )}
        </>
      ) : picksLoading ? (
        <View style={{ marginTop: s(24) }}>
          <LogoSpinner />
        </View>
      ) : (
        // ── Pick list ──────────────────────────────────────────────────────
        <FlatList
          data={picks ?? []}
          keyExtractor={(p) => String(p.pick_number)}
          renderItem={({ item }) => {
            const assignedId = assignments[item.pick_number];
            const assigned = assignedId ? poolById.get(assignedId) : null;
            return (
              <View style={[styles.pickRow, { borderBottomColor: c.border }]}>
                <ThemedText style={[styles.pickNum, { color: c.secondaryText }]}>{item.pick_number}</ThemedText>
                {item.team ? (
                  <TeamLogo
                    logoKey={item.team.logo_key}
                    teamName={item.team.name}
                    tricode={item.team.tricode ?? undefined}
                    size="small"
                  />
                ) : null}
                <View style={styles.pickBody}>
                  <ThemedText type="varsitySmall" style={[styles.teamName, { color: c.secondaryText }]} numberOfLines={1}>
                    {item.team?.name ?? 'Unassigned'}
                  </ThemedText>
                  {assignedId ? (
                    <PlayerName
                      name={assigned?.name ?? 'Selected player'}
                      type="defaultSemiBold"
                      style={{ fontSize: ms(14) }}
                      containerStyle={{ flexShrink: 1 }}
                    />
                  ) : (
                    <ThemedText style={[styles.emptyPick, { color: c.secondaryText }]}>No player yet</ThemedText>
                  )}
                </View>
                {assignedId ? (
                  <TouchableOpacity
                    onPress={() => clearPick(item.pick_number)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    accessibilityRole="button"
                    accessibilityLabel={`Clear pick ${item.pick_number}`}
                    style={styles.pickAction}
                  >
                    <Ionicons name="close-circle" size={22} color={c.secondaryText} />
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  onPress={() => {
                    setSearch('');
                    setPickingFor(item.pick_number);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={assignedId ? `Change player for pick ${item.pick_number}` : `Assign player to pick ${item.pick_number}`}
                  style={[styles.assignBtn, { borderColor: c.border }]}
                >
                  <ThemedText type="varsitySmall" style={{ color: c.text }}>
                    {assignedId ? 'Change' : 'Assign'}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            );
          }}
        />
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  footer: { flexDirection: 'row', gap: s(12) },
  footerBtn: { flex: 1 },
  searchInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(10),
    fontSize: ms(14),
    marginBottom: s(8),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(12),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  sub: { fontSize: ms(12), marginTop: s(2) },
  empty: { textAlign: 'center', marginTop: s(24), fontSize: ms(14) },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    paddingVertical: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  pickNum: {
    fontFamily: Fonts.mono,
    fontSize: ms(14),
    fontWeight: '700',
    width: s(22),
    textAlign: 'center',
  },
  pickBody: { flex: 1, minWidth: 0 },
  teamName: { fontSize: ms(10), letterSpacing: 0.8 },
  emptyPick: { fontSize: ms(13), fontStyle: 'italic', marginTop: s(1) },
  pickAction: { padding: s(2) },
  assignBtn: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: s(12),
    paddingVertical: s(6),
  },
});
