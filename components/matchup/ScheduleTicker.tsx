import { useMemo } from 'react';
import { View } from 'react-native';

import { chipStyles, MarqueeBand } from '@/components/matchup/MarqueeBand';
import { RosterPlayer } from '@/components/matchup/PlayerCell';
import { ThemedText } from '@/components/ui/ThemedText';
import { formatGameTime, ScheduleEntry } from '@/utils/nba/nbaSchedule';

interface ScheduleTickerProps {
  /** Active-starter players for both sides of the matchup. */
  players: RosterPlayer[];
  /** tricode → schedule entry for the selected (future) date. */
  schedule: Map<string, ScheduleEntry>;
  emptyText?: string;
}

/**
 * Upcoming-games preview for future days. Each of the matchup's starters who
 * has a game on the selected date gets a chip with their opponent and tipoff,
 * sorted by tip time — turns the otherwise-dead future ticker into a scouting
 * glance at what's on tap.
 */
export function ScheduleTicker({
  players,
  schedule,
  emptyText = 'NO GAMES SCHEDULED',
}: ScheduleTickerProps) {
  const rendered = useMemo(() => {
    const out: {
      id: string;
      name: string;
      matchup: string;
      tipoff: string | null;
      sortKey: number;
    }[] = [];
    for (const p of players) {
      const entry = p.nbaTricode ? schedule.get(p.nbaTricode) : undefined;
      if (!entry) continue;
      out.push({
        id: p.player_id,
        name: p.name.toUpperCase(),
        matchup: entry.matchup.toUpperCase(),
        tipoff: entry.gameTimeUtc ? formatGameTime(entry.gameTimeUtc) : null,
        sortKey: entry.gameTimeUtc ? new Date(entry.gameTimeUtc).getTime() : Infinity,
      });
    }
    return out.sort((a, b) => a.sortKey - b.sortKey);
  }, [players, schedule]);

  const a11yLabel =
    rendered.length > 0
      ? `Up next: ${rendered
          .map((r) => `${r.name} ${r.matchup}${r.tipoff ? ` ${r.tipoff}` : ''}`)
          .join(', ')}`
      : `Up next: ${emptyText.toLowerCase()}`;

  const items = rendered.map((r) => (
    <View key={r.id} style={chipStyles.chip}>
      <ThemedText type="varsity" style={chipStyles.name} numberOfLines={1}>
        {r.name}
      </ThemedText>
      <ThemedText style={chipStyles.detail} numberOfLines={1}>
        {r.matchup}
      </ThemedText>
      {r.tipoff ? (
        <ThemedText style={chipStyles.muted} numberOfLines={1}>
          {r.tipoff}
        </ThemedText>
      ) : null}
      <View style={chipStyles.dot} />
    </View>
  ));

  return <MarqueeBand label="UP NEXT" items={items} emptyText={emptyText} a11yLabel={a11yLabel} />;
}
