import { ThemedText } from '@/components/ThemedText';
import { Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useDraftHistory, DraftSummary, DraftHistoryPick } from '@/hooks/useLeagueHistory';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface DraftBoardProps {
  leagueId: string;
}

/** e.g. "2025-26" → "'26 Rookie Draft", "2025-26" initial → "2025-26 Draft" */
function draftLabel(draft: DraftSummary): string {
  if (draft.type === 'rookie') {
    // Rookie draft class year = the end year of the season (e.g. "2025-26" → "'26")
    const endYear = draft.season.split('-')[1];
    return `'${endYear} Rookie Draft`;
  }
  return `${draft.season} Draft`;
}

export function DraftBoard({ leagueId }: DraftBoardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data, isLoading } = useDraftHistory(leagueId);

  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  // All drafts as selectable options
  const draftOptions = useMemo(() => {
    if (!data) return [];
    return data.drafts.map((d) => ({ ...d, label: draftLabel(d) }));
  }, [data]);

  const activeDraft = useMemo(() => {
    if (!draftOptions.length) return null;
    if (selectedDraftId) return draftOptions.find((d) => d.id === selectedDraftId) ?? draftOptions[0];
    return draftOptions[0];
  }, [draftOptions, selectedDraftId]);

  // Picks for the active draft, grouped by round
  const picksByRound = useMemo(() => {
    if (!data || !activeDraft) return new Map<number, DraftHistoryPick[]>();
    const draftPicks = data.picks.filter((p) => p.draft_id === activeDraft.id);
    const map = new Map<number, DraftHistoryPick[]>();
    for (const p of draftPicks) {
      if (!map.has(p.round)) map.set(p.round, []);
      map.get(p.round)!.push(p);
    }
    return map;
  }, [data, activeDraft]);

  if (isLoading) return <ActivityIndicator style={{ marginVertical: 16 }} />;
  if (!data || data.drafts.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        No completed drafts yet.
      </ThemedText>
    );
  }

  return (
    <View>
      {/* Draft selector pills */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.pillRow}>
        {draftOptions.map((d) => {
          const isActive = activeDraft?.id === d.id;
          return (
            <TouchableOpacity
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={d.label}
              accessibilityState={{ selected: isActive }}
              style={[styles.pill, isActive ? { backgroundColor: c.accent } : { backgroundColor: c.cardAlt }]}
              onPress={() => setSelectedDraftId(d.id)}
            >
              <ThemedText style={[styles.pillText, isActive && { color: c.accentText }]}>{d.label}</ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* Draft info */}
      {activeDraft && (
        <ThemedText style={[styles.draftInfo, { color: c.secondaryText }]}>
          {activeDraft.draft_type === 'snake' ? 'Snake' : 'Linear'} · {activeDraft.rounds} rounds
        </ThemedText>
      )}

      {/* Pick-by-pick board */}
      {[...picksByRound.entries()].map(([round, picks]) => (
        <View key={round} style={styles.roundBlock}>
          <ThemedText accessibilityRole="header" type="defaultSemiBold" style={[styles.roundLabel, { color: c.secondaryText }]}>
            Round {round}
          </ThemedText>
          {picks.map((pick) => (
            <View
              key={pick.id}
              style={[styles.pickRow, { borderBottomColor: c.border }]}
            >
              <ThemedText style={[styles.pickNum, { color: c.secondaryText }]}>
                {pick.pick_number}
              </ThemedText>
              <View style={styles.pickInfo}>
                <ThemedText style={styles.pickTeam} numberOfLines={1}>
                  {pick.current_team_name}
                </ThemedText>
                {pick.isTraded && (
                  <ThemedText style={[styles.viaLabel, { color: c.secondaryText }]}>
                    via {pick.original_team_name}
                  </ThemedText>
                )}
              </View>
              <View style={styles.playerInfo}>
                <ThemedText style={styles.playerName} numberOfLines={1}>
                  {pick.player_name ?? '—'}
                </ThemedText>
                {pick.player_position && (
                  <ThemedText style={[styles.playerPos, { color: c.secondaryText }]}>
                    {pick.player_position}
                  </ThemedText>
                )}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: 13, textAlign: 'center', paddingVertical: 16 },
  pillRow: { marginBottom: 10 },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    marginRight: 8,
  },
  pillText: { fontSize: 13, fontWeight: '600' },
  draftInfo: { fontSize: 12, marginBottom: 12 },
  roundBlock: { marginBottom: 12 },
  roundLabel: { fontSize: 12, marginBottom: 6 },
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 10,
  },
  pickNum: { width: 28, fontSize: 12, textAlign: 'center', fontWeight: '600' },
  pickInfo: { flex: 1 },
  pickTeam: { fontSize: 13, fontWeight: '600' },
  viaLabel: { fontSize: 10, marginTop: 1 },
  playerInfo: { alignItems: 'flex-end' },
  playerName: { fontSize: 13 },
  playerPos: { fontSize: 10, marginTop: 1 },
});
