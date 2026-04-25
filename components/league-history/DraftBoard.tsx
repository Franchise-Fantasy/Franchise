import { ThemedText } from '@/components/ui/ThemedText';
import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { Brand, Colors } from '@/constants/Colors';
import { useColorScheme } from '@/hooks/useColorScheme';
import { DraftHistoryPick, DraftSummary, useDraftHistory } from '@/hooks/useLeagueHistory';
import { ms, s } from '@/utils/scale';
import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

interface DraftBoardProps {
  leagueId: string;
}

function draftLabel(draft: DraftSummary): string {
  if (draft.type === 'rookie') {
    const startYear = draft.season.split('-')[0];
    return `'${startYear.slice(-2)} Rookie`;
  }
  return `${draft.season}`;
}

export function DraftBoard({ leagueId }: DraftBoardProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const { data, isLoading } = useDraftHistory(leagueId);

  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);

  const draftOptions = useMemo(() => {
    if (!data) return [];
    return data.drafts.map((d) => ({ ...d, label: draftLabel(d) }));
  }, [data]);

  const activeDraft = useMemo(() => {
    if (!draftOptions.length) return null;
    if (selectedDraftId) return draftOptions.find((d) => d.id === selectedDraftId) ?? draftOptions[0];
    return draftOptions[0];
  }, [draftOptions, selectedDraftId]);

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

  if (isLoading) return <View style={styles.loading}><LogoSpinner /></View>;
  if (!data || data.drafts.length === 0) {
    return (
      <ThemedText style={[styles.emptyText, { color: c.secondaryText }]}>
        No completed drafts yet.
      </ThemedText>
    );
  }

  return (
    <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.pillRowContent}
        style={styles.pillRow}
      >
        {draftOptions.map((d) => {
          const isActive = activeDraft?.id === d.id;
          return (
            <TouchableOpacity
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={d.label}
              accessibilityState={{ selected: isActive }}
              style={[
                styles.pill,
                { borderColor: c.border },
                isActive
                  ? { backgroundColor: Brand.turfGreen, borderColor: Brand.turfGreen }
                  : { backgroundColor: c.cardAlt },
              ]}
              onPress={() => setSelectedDraftId(d.id)}
            >
              <ThemedText
                type="varsitySmall"
                style={[
                  styles.pillText,
                  { color: isActive ? Brand.ecru : c.secondaryText },
                ]}
              >
                {d.label}
              </ThemedText>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {activeDraft && (
        <ThemedText
          type="varsitySmall"
          style={[styles.draftInfo, { color: c.secondaryText }]}
        >
          {activeDraft.draft_type === 'snake' ? 'Snake' : 'Linear'} · {activeDraft.rounds} Rounds
        </ThemedText>
      )}

      {[...picksByRound.entries()].map(([round, picks]) => (
        <View key={round} style={styles.roundBlock}>
          <View style={styles.roundHeader}>
            <View style={[styles.roundRule, { backgroundColor: c.heritageGold }]} />
            <ThemedText
              type="varsity"
              style={[styles.roundLabel, { color: c.text }]}
              accessibilityRole="header"
            >
              Round {round}
            </ThemedText>
          </View>
          {picks.map((pick, idx) => (
            <View
              key={pick.id}
              style={[
                styles.pickRow,
                { borderBottomColor: c.border },
                idx === picks.length - 1 && { borderBottomWidth: 0 },
              ]}
            >
              <ThemedText type="mono" style={[styles.pickNum, { color: c.secondaryText }]}>
                {pick.pick_number}
              </ThemedText>
              <View style={styles.pickInfo}>
                <ThemedText
                  style={[styles.pickTeam, { color: c.text }]}
                  numberOfLines={1}
                >
                  {pick.current_team_name}
                </ThemedText>
                {pick.isTraded && (
                  <ThemedText
                    type="varsitySmall"
                    style={[styles.viaLabel, { color: c.secondaryText }]}
                  >
                    via {pick.original_team_name}
                  </ThemedText>
                )}
              </View>
              <View style={styles.playerInfo}>
                <ThemedText
                  style={[styles.playerName, { color: c.text }]}
                  numberOfLines={1}
                >
                  {pick.player_name ?? '—'}
                </ThemedText>
                {pick.player_position && (
                  <ThemedText
                    type="mono"
                    style={[styles.playerPos, { color: c.secondaryText }]}
                  >
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
  emptyText: { fontSize: ms(13), textAlign: 'center', paddingVertical: s(16) },
  loading: { paddingVertical: s(24) },

  pillRow: {
    marginBottom: s(10),
    marginHorizontal: -s(4),
  },
  pillRowContent: {
    paddingHorizontal: s(4),
    gap: s(8),
  },
  pill: {
    paddingHorizontal: s(14),
    paddingVertical: s(7),
    borderRadius: 8,
    borderWidth: 1,
  },
  pillText: {
    fontSize: ms(10),
  },

  draftInfo: {
    fontSize: ms(10),
    marginBottom: s(14),
  },

  roundBlock: {
    marginBottom: s(14),
  },
  roundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(8),
    marginBottom: s(6),
  },
  roundRule: {
    height: 1,
    width: s(14),
  },
  roundLabel: {
    fontSize: ms(11),
  },

  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(9),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
    marginHorizontal: -s(4),
  },
  pickNum: {
    width: s(28),
    fontSize: ms(12),
    textAlign: 'center',
  },
  pickInfo: { flex: 1 },
  pickTeam: { fontSize: ms(13), fontWeight: '600' },
  viaLabel: { fontSize: ms(9), marginTop: s(1) },
  playerInfo: { alignItems: 'flex-end', maxWidth: s(140) },
  playerName: { fontSize: ms(13) },
  playerPos: { fontSize: ms(10), marginTop: s(1) },
});
