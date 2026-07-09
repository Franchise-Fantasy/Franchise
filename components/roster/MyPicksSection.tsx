import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, TouchableOpacity, View } from 'react-native';

import { SectionEyebrow } from '@/components/roster/SectionEyebrow';
import { ThemedText } from '@/components/ui/ThemedText';
import { cardShadow, Colors } from '@/constants/Colors';
import { formatSeason } from '@/constants/LeagueDefaults';
import { useActiveLeagueSport } from '@/hooks/useActiveLeagueSport';
import { useColorScheme } from '@/hooks/useColorScheme';
import { useNextRookieDraftYear } from '@/hooks/useNextRookieDraftYear';
import { useTeamTradablePicks } from '@/hooks/useTrades';
import { formatPickLabel } from '@/types/trade';
import { ms, s } from '@/utils/scale';

interface MyPicksSectionProps {
  teamId: string | null;
  leagueId: string | null;
  /** True for dynasty leagues — the section won't render otherwise */
  isDynasty: boolean;
}

/**
 * Collapsible "My Draft Picks" section rendered below Taxi on the roster tab.
 * Reuses useTeamTradablePicks so the pick list matches what shows up in trades.
 * Dynasty-only — returns null for redraft / keeper leagues.
 */
export function MyPicksSection({ teamId, leagueId, isDynasty }: MyPicksSectionProps) {
  const scheme = useColorScheme() ?? 'light';
  const c = Colors[scheme];
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const sport = useActiveLeagueSport(leagueId);

  const { data: picks } = useTeamTradablePicks(teamId, leagueId, true);

  // Only the genuinely-upcoming rookie draft shows real slot numbers. Derive
  // which class that is the same way the draft hub does — off THIS league's own
  // season + offseason step (useNextRookieDraftYear), not the sport-wide
  // season. Using the global season put the slot on the wrong year's pick once
  // the sport season rolled over ahead of this league's own draft.
  const upcomingSeason = formatSeason(useNextRookieDraftYear(sport), sport);

  if (!isDynasty) return null;
  if (!picks || picks.length === 0) return null;

  const count = picks.length;

  return (
    <View style={styles.section}>
      <TouchableOpacity
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole="button"
        accessibilityLabel={`My draft picks, ${count} ${count === 1 ? 'pick' : 'picks'}, tap to ${expanded ? 'collapse' : 'expand'}`}
        accessibilityState={{ expanded }}
      >
        <SectionEyebrow
          label="MY DRAFT PICKS"
          right={
            <View style={styles.headerRight}>
              <ThemedText style={[styles.count, { color: c.secondaryText }]}>
                {count}
              </ThemedText>
              <Ionicons
                name={expanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={c.secondaryText}
              />
            </View>
          }
        />
      </TouchableOpacity>

      {expanded && (
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          {picks.map((pick) => {
            // Only show pick number for the upcoming season — future seasons have unknown standings
            const showSlot = pick.season === upcomingSeason;
            const label = formatPickLabel(pick.season, pick.round, showSlot ? (pick as any).display_slot : null);
            const via =
              pick.original_team_name && pick.original_team_id !== teamId
                ? `via ${pick.original_team_name}`
                : null;
            return (
              <TouchableOpacity
                key={pick.id}
                style={[styles.row, { borderBottomColor: c.border }]}
                onPress={() => router.push('/draft-hub')}
                accessibilityRole="button"
                accessibilityLabel={`${label}${via ? `, ${via}` : ''}, tap to view in draft hub`}
              >
                <View style={[styles.iconCircle, { backgroundColor: c.cardAlt, borderColor: c.border }]}>
                  <Ionicons name="ticket-outline" size={16} color={c.accent} />
                </View>
                <View style={styles.info}>
                  <ThemedText style={styles.pickLabel}>{label}</ThemedText>
                  {via && (
                    <ThemedText style={[styles.pickSub, { color: c.secondaryText }]}>
                      {via}
                    </ThemedText>
                  )}
                </View>
                <Ionicons name="chevron-forward" size={16} color={c.secondaryText} />
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { padding: s(16), paddingBottom: 0 },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: s(6),
  },
  count: {
    fontSize: ms(13),
    fontWeight: '600',
  },
  card: {
    borderRadius: 8,
    overflow: 'hidden',
    ...cardShadow,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: s(10),
    paddingHorizontal: s(12),
    gap: s(10),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconCircle: {
    width: s(32),
    height: s(32),
    borderRadius: s(16),
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: { flex: 1 },
  pickLabel: { fontSize: ms(14), fontWeight: '600' },
  pickSub: { fontSize: ms(11), marginTop: 1 },
});
