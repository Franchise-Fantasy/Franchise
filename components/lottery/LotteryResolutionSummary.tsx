import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';

import { ThemedText } from '@/components/ui/ThemedText';
import { Colors } from '@/constants/Colors';
import { queryKeys } from '@/constants/queryKeys';
import { useColorScheme } from '@/hooks/useColorScheme';
import { supabase } from '@/lib/supabase';
import { ms, s } from '@/utils/scale';

/**
 * Mirrors the ResolutionEvent union written by the start-lottery edge function
 * to lottery_results.pick_resolution. Kept in sync by hand — the two runtimes
 * can't share the type. See supabase/functions/start-lottery/index.ts.
 */
type ResolutionEvent =
  | { kind: 'protected'; round: number; slot: number | null; threshold: number; fromTeam: string; toTeam: string }
  | { kind: 'conveyed'; round: number; slot: number | null; threshold: number; toTeam: string; protectedBy: string }
  | { kind: 'swap_executed'; round: number; teamA: string; teamB: string }
  | { kind: 'swap_kept'; round: number; teamA: string; teamB: string }
  | { kind: 'swap_voided'; round: number; teamA: string; teamB: string; missing: string };

interface Props {
  leagueId: string;
  season: string;
  /**
   * When true (draft hub), render a tappable header that expands/collapses the
   * list, collapsed by default. When false (lottery room, post-reveal), the
   * list is always shown. Either way the whole card renders nothing when the
   * lottery touched no protected picks or swaps.
   */
  collapsible?: boolean;
}

interface Display {
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  title: string;
  subtitle?: string;
}

function describe(e: ResolutionEvent, c: (typeof Colors)['light']): Display {
  // Slot is assigned during the lottery reorder, so it's set in practice — but
  // guard against null so the sentence never reads "Landed  (...".
  const landed = (n: number | null) => (n != null ? `Landed No. ${n}, ` : '');
  switch (e.kind) {
    case 'protected':
      return {
        icon: 'shield-checkmark',
        color: c.success,
        title: `${e.toTeam} kept their protected Rd ${e.round} pick`,
        subtitle: `${landed(e.slot)}within top-${e.threshold} protection — ${e.fromTeam} does not receive it.`,
      };
    case 'conveyed':
      return {
        icon: 'arrow-redo',
        color: c.accent,
        title: `${e.protectedBy}'s Rd ${e.round} pick conveyed to ${e.toTeam}`,
        subtitle: `${landed(e.slot)}outside top-${e.threshold} protection.`,
      };
    case 'swap_executed':
      return {
        icon: 'swap-horizontal',
        color: c.gold,
        title: `Rd ${e.round} pick swap executed`,
        subtitle: `${e.teamA} swapped into ${e.teamB}'s better pick.`,
      };
    case 'swap_kept':
      return {
        icon: 'swap-horizontal',
        color: c.gold,
        title: `Rd ${e.round} pick swap resolved`,
        subtitle: `${e.teamA} kept their own pick — already better than ${e.teamB}'s.`,
      };
    case 'swap_voided':
      return {
        icon: 'close-circle',
        color: c.danger,
        title: `Rd ${e.round} swap (${e.teamA} ↔ ${e.teamB}) voided`,
        subtitle: `${e.missing} no longer holds a pick this round (protection triggered).`,
      };
  }
}

export function LotteryResolutionSummary({ leagueId, season, collapsible = false }: Props) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const [expanded, setExpanded] = useState(!collapsible);

  const { data: events } = useQuery({
    queryKey: queryKeys.lotteryResolution(leagueId, season),
    queryFn: async (): Promise<ResolutionEvent[]> => {
      const { data } = await supabase
        .from('lottery_results')
        .select('pick_resolution')
        .eq('league_id', leagueId)
        .eq('season', season)
        .maybeSingle();
      const raw = data?.pick_resolution;
      return Array.isArray(raw) ? (raw as ResolutionEvent[]) : [];
    },
    enabled: !!leagueId && !!season,
    staleTime: 1000 * 60 * 5,
  });

  // Nothing happened (no protected picks, no swaps) — render nothing rather
  // than an empty "0 changes" card.
  if (!events || events.length === 0) return null;

  const headerLabel = `Lottery Resolution · ${events.length} ${events.length === 1 ? 'change' : 'changes'}`;

  const list = (
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.listContent}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
    >
      {events.map((e, i) => {
        const d = describe(e, c);
        return (
          <View
            key={i}
            style={[styles.row, i > 0 && { borderTopColor: c.border, borderTopWidth: StyleSheet.hairlineWidth }]}
            accessibilityRole="text"
            accessibilityLabel={d.subtitle ? `${d.title}. ${d.subtitle}` : d.title}
          >
            <Ionicons name={d.icon} size={18} color={d.color} style={styles.rowIcon} accessible={false} />
            <View style={styles.rowText}>
              <ThemedText style={[styles.rowTitle, { color: c.text }]}>{d.title}</ThemedText>
              {d.subtitle ? (
                <ThemedText style={[styles.rowSubtitle, { color: c.secondaryText }]}>{d.subtitle}</ThemedText>
              ) : null}
            </View>
          </View>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
      {collapsible ? (
        <TouchableOpacity
          style={styles.header}
          onPress={() => setExpanded((v) => !v)}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          accessibilityLabel={`${headerLabel}. ${expanded ? 'Collapse' : 'Expand'}.`}
          activeOpacity={0.7}
        >
          <View style={[styles.headerRule, { backgroundColor: c.gold }]} />
          <ThemedText type="sectionLabel" style={[styles.headerLabel, { color: c.text }]}>
            {headerLabel}
          </ThemedText>
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={c.secondaryText}
            accessible={false}
          />
        </TouchableOpacity>
      ) : (
        <View style={styles.header}>
          <View style={[styles.headerRule, { backgroundColor: c.gold }]} />
          <ThemedText type="sectionLabel" style={[styles.headerLabel, { color: c.text }]}>
            {headerLabel}
          </ThemedText>
        </View>
      )}
      {expanded ? list : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: s(14),
    paddingVertical: s(10),
    marginBottom: s(12),
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(10),
  },
  headerRule: {
    height: 2,
    width: s(18),
  },
  headerLabel: {
    flex: 1,
  },
  list: {
    maxHeight: s(220),
    marginTop: s(8),
  },
  listContent: {
    paddingBottom: s(2),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: s(9),
    gap: s(10),
  },
  rowIcon: {
    marginTop: ms(1),
  },
  rowText: {
    flex: 1,
    gap: s(2),
  },
  rowTitle: {
    fontSize: ms(13),
    fontWeight: '500',
  },
  rowSubtitle: {
    fontSize: ms(12),
    lineHeight: ms(16),
  },
});
