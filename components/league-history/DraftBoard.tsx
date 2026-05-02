import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { LogoSpinner } from '@/components/ui/LogoSpinner';
import { ThemedText } from '@/components/ui/ThemedText';
import { Fonts } from '@/constants/Colors';
import { useColors } from '@/hooks/useColors';
import { DraftHistoryPick, DraftSummary, useDraftHistory } from '@/hooks/useLeagueHistory';
import { ms, s } from '@/utils/scale';

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
  const c = useColors();
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
      {/* Draft selector — underline-active text-only filter, matches the
          ByYearTab / ProspectsTab / prospect-board / draft-room rhythm.
          Replaces the filled pill row that lived here previously. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.selectorContent}
        style={styles.selectorRow}
      >
        {draftOptions.map((d) => {
          const isActive = activeDraft?.id === d.id;
          return (
            <TouchableOpacity
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={d.label}
              accessibilityState={{ selected: isActive }}
              style={styles.selectorBtn}
              onPress={() => setSelectedDraftId(d.id)}
              activeOpacity={0.7}
            >
              <ThemedText
                type="varsity"
                style={[
                  styles.selectorText,
                  { color: isActive ? c.text : c.secondaryText },
                ]}
              >
                {d.label}
              </ThemedText>
              <View
                style={[
                  styles.selectorUnderline,
                  { backgroundColor: isActive ? c.gold : 'transparent' },
                ]}
              />
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
          {/* Round header — gold-rule + Alfa Slab "Round N." matches the
              eyebrow rhythm used across the brand surfaces. */}
          <View style={styles.roundHeader}>
            <View style={[styles.roundRule, { backgroundColor: c.gold }]} />
            <ThemedText
              type="varsitySmall"
              style={[styles.roundLabel, { color: c.gold }]}
              accessibilityRole="header"
            >
              Round {round}
            </ThemedText>
          </View>
          {picks.map((pick, idx) => {
            const viaTricode = pick.original_team_tricode ?? pick.original_team_name;
            // Round.pick-within-round notation (e.g. 2.05) — reads more
            // naturally for a historical board than the overall pick
            // number, especially in snake drafts where Round 2 starts at
            // overall #6+ and the within-round position is what matters.
            const pickInRound = String(idx + 1).padStart(2, '0');
            return (
              <View
                key={pick.id}
                style={[styles.pickRow, { borderBottomColor: c.border }]}
              >
                {/* Gold side-rule + Alfa Slab "round.pick" — same chrome
                    used in the live DraftOrder and the lottery slot rows. */}
                <View style={[styles.sideRule, { backgroundColor: c.gold }]} />
                <ThemedText
                  type="display"
                  style={[styles.pickNumber, { color: c.text }]}
                >
                  {pick.round}.{pickInRound}
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
                      style={[styles.viaLabel, { color: c.gold }]}
                      numberOfLines={1}
                    >
                      via {viaTricode}
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
                      type="varsitySmall"
                      style={[styles.playerPos, { color: c.secondaryText }]}
                    >
                      {pick.player_position}
                    </ThemedText>
                  )}
                </View>
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  emptyText: { fontSize: ms(13), textAlign: 'center', paddingVertical: s(16) },
  loading: { paddingVertical: s(24) },

  // Selector — varsity caps with gold-underline active. Mirrors the
  // within-tab filter pattern shared across the app.
  selectorRow: {
    marginBottom: s(8),
    marginHorizontal: -s(2),
  },
  selectorContent: {
    paddingHorizontal: s(2),
    gap: s(20),
  },
  selectorBtn: {
    alignItems: 'center',
    paddingTop: s(4),
  },
  selectorText: {
    fontSize: ms(11),
    letterSpacing: 1.0,
  },
  selectorUnderline: {
    marginTop: s(6),
    height: 2,
    width: '100%',
    minWidth: s(28),
  },

  draftInfo: {
    fontSize: ms(10),
    letterSpacing: 1.2,
    marginBottom: s(14),
  },

  roundBlock: {
    marginBottom: s(18),
  },
  roundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
    marginBottom: s(8),
  },
  roundRule: { height: 2, width: s(18) },
  roundLabel: {
    fontSize: ms(10),
    letterSpacing: 1.4,
  },

  // Pick row — gold side-rule (3 × 36) + Alfa Slab pick number + team /
  // player columns. Matches the live DraftOrder pick redesign and the
  // lottery slot chrome so the historical board reads as the same
  // surface, frozen in time.
  pickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(4),
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: s(10),
    marginHorizontal: -s(4),
  },
  sideRule: {
    width: 3,
    height: s(32),
    marginRight: s(6),
  },
  pickNumber: {
    fontFamily: Fonts.display,
    fontSize: ms(17),
    lineHeight: ms(19),
    letterSpacing: -0.3,
    minWidth: s(50),
  },
  pickInfo: { flex: 1, minWidth: 0 },
  pickTeam: { fontSize: ms(13), fontWeight: '600' },
  viaLabel: {
    fontSize: ms(9),
    letterSpacing: 1.2,
    marginTop: s(2),
  },
  playerInfo: { alignItems: 'flex-end', maxWidth: s(140) },
  playerName: { fontSize: ms(13) },
  playerPos: {
    fontSize: ms(9),
    letterSpacing: 1.2,
    marginTop: s(2),
  },
});
