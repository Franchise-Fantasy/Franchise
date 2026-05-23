import { useMemo } from 'react';
import { View } from 'react-native';

import { chipStyles, MarqueeBand } from '@/components/matchup/MarqueeBand';
import { RosterPlayer } from '@/components/matchup/PlayerCell';
import { ThemedText } from '@/components/ui/ThemedText';
import { Brand } from '@/constants/Colors';
import { formatScore } from '@/utils/scoring/fantasyPoints';

interface RecapTickerProps {
  /** Active-starter players for both sides of the matchup. */
  players: RosterPlayer[];
  /** Category leagues have no fpts to rank by — hide the points pill and keep
   *  the stat line as the headline instead. */
  hideFpts?: boolean;
  emptyText?: string;
}

/**
 * Top-performers recap for past days. The live event stream (live_scoring_events)
 * is TTL'd, so older days have no plays to crawl — instead we rebuild the tape
 * from each starter's box score for the day, sorted by fantasy points, so the
 * past ticker answers "who won the day?" rather than going blank.
 */
export function RecapTicker({
  players,
  hideFpts = false,
  emptyText = 'NO GAMES PLAYED',
}: RecapTickerProps) {
  const rendered = useMemo(() => {
    return players
      .filter((p) => p.dayStatLine || p.dayMatchup)
      .map((p) => ({
        id: p.player_id,
        name: p.name.toUpperCase(),
        fpts: p.dayPoints,
        statLine: p.dayStatLine,
      }))
      .sort((a, b) => b.fpts - a.fpts);
  }, [players]);

  const a11yLabel =
    rendered.length > 0
      ? `Recap: ${rendered
          .map((r) =>
            hideFpts
              ? `${r.name} ${r.statLine ?? ''}`
              : `${r.name} ${formatScore(r.fpts)}${r.statLine ? ` ${r.statLine}` : ''}`,
          )
          .join(', ')}`
      : `Recap: ${emptyText.toLowerCase()}`;

  const items = rendered.map((r) => (
    <View key={r.id} style={chipStyles.chip}>
      <ThemedText type="varsity" style={chipStyles.name} numberOfLines={1}>
        {r.name}
      </ThemedText>
      {!hideFpts && (
        <ThemedText style={[chipStyles.value, { color: Brand.vintageGold }]}>
          {formatScore(r.fpts)}
        </ThemedText>
      )}
      {r.statLine ? (
        <ThemedText style={chipStyles.detail} numberOfLines={1}>
          {r.statLine}
        </ThemedText>
      ) : null}
      <View style={chipStyles.dot} />
    </View>
  ));

  return <MarqueeBand label="RECAP" items={items} emptyText={emptyText} a11yLabel={a11yLabel} />;
}
