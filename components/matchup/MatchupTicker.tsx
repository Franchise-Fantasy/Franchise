import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';

import { chipStyles, MarqueeBand } from '@/components/matchup/MarqueeBand';
import { ThemedText } from '@/components/ui/ThemedText';
import { TickerEvent, TickerEventKind } from '@/hooks/useMatchupTickerEvents';
import { ScoringWeight } from '@/types/player';
import { NFL_EVENT_DEFS, nflEventLabel } from '@/utils/scoring/nflStatLine';

const NFL_EVENT_KINDS = new Set<string>(NFL_EVENT_DEFS.map((d) => d.kind));

// Live recap fpts colors. Green for a positive contribution, red for a
// negative one (e.g. a turnover in a league that penalizes it).
const FPTS_POS = '#7CD083';
const FPTS_NEG = '#E55353';

interface MatchupTickerProps {
  events: TickerEvent[];
  scoring: ScoringWeight[];
  /** Copy shown when there are no events. Caller decides — depends on
   *  whether the selected day is today, future, or out-of-TTL past. */
  emptyText?: string;
  /** Category leagues have no per-stat point values, so the fpts pill
   *  resolves to +0.0 on every chip — meaningless noise. Hide it. */
  hideFpts?: boolean;
}

/**
 * Approximates the fantasy-points contribution of a single ticker event by
 * multiplying the implied stat changes through the league's scoring
 * weights. We don't track misses (FGA / FTA on a miss), so the value is a
 * lower bound — that matches user intuition that a make should always
 * register positively.
 */
function fptsForEvent(
  kind: TickerEventKind,
  value: number,
  scoring: ScoringWeight[],
): number {
  const w = (name: string) =>
    scoring.find((s) => s.stat_name === name)?.point_value ?? 0;
  // NFL event kinds are named after the league's own scoring stat_name
  // (PASS_TD, DST_SACK, …), so the value is just delta × weight — no map.
  if (NFL_EVENT_KINDS.has(kind)) return value * w(kind);
  switch (kind) {
    case 'MADE_3PT':
      // 3pt make moves PTS+3, 3PM+1, 3PA+1, FGM+1, FGA+1
      return value * (w('PTS') * 3 + w('3PM') + w('3PA') + w('FGM') + w('FGA'));
    case 'MADE_2PT':
      return value * (w('PTS') * 2 + w('FGM') + w('FGA'));
    case 'MADE_FT':
      return value * (w('PTS') + w('FTM') + w('FTA'));
    case 'MISSED_3PT':
      // Miss only increments the attempt counters
      return value * (w('FGA') + w('3PA'));
    case 'MISSED_2PT':
      return value * w('FGA');
    case 'MISSED_FT':
      return value * w('FTA');
    case 'REB':
      return value * w('REB');
    case 'AST':
      return value * w('AST');
    case 'STL':
      return value * w('STL');
    case 'BLK':
      return value * w('BLK');
    case 'TOV':
      return value * w('TO');
    case 'PF':
      return value * w('PF');
    case 'DD':
      return w('DD');
    case 'TD':
      // A TD always implies a DD, so the bonus stack mirrors how
      // calculateGameFantasyPoints treats double_double + triple_double.
      return w('DD') + w('TD');
    default:
      return 0;
  }
}

function actionLabel(kind: TickerEventKind, value: number): string {
  const nfl = nflEventLabel(kind, value);
  if (nfl) return nfl;
  switch (kind) {
    case 'MADE_3PT':   return value > 1 ? `MADE ${value} 3-PT`    : 'MADE 3-PT';
    case 'MADE_2PT':   return value > 1 ? `MADE ${value} 2-PT`    : 'MADE 2-PT';
    case 'MADE_FT':    return value > 1 ? `MADE ${value} FT`      : 'MADE FT';
    case 'MISSED_3PT': return value > 1 ? `MISSED ${value} 3-PT`  : 'MISSED 3-PT';
    case 'MISSED_2PT': return value > 1 ? `MISSED ${value} 2-PT`  : 'MISSED 2-PT';
    case 'MISSED_FT':  return value > 1 ? `MISSED ${value} FT`    : 'MISSED FT';
    case 'REB':        return value > 1 ? `${value} REB`          : 'REBOUND';
    case 'AST':        return value > 1 ? `${value} AST`          : 'ASSIST';
    case 'STL':        return value > 1 ? `${value} STL`          : 'STEAL';
    case 'BLK':        return value > 1 ? `${value} BLK`          : 'BLOCK';
    case 'TOV':        return value > 1 ? `${value} TO`           : 'TURNOVER';
    case 'PF':         return value > 1 ? `${value} FOULS`        : 'FOUL';
    case 'DD':         return 'DOUBLE-DOUBLE';
    case 'TD':         return 'TRIPLE-DOUBLE';
    default:           return kind;
  }
}

function relativeTime(iso: string, now: number): string {
  const diffSec = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  const min = Math.floor(diffSec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  return `${h}h ago`;
}

/**
 * Live recap tape for the matchup hero. Turns the stream of live scoring
 * events into chips and feeds them to {@link MarqueeBand}.
 */
export function MatchupTicker({
  events,
  scoring,
  emptyText = 'NO GAMES STARTED YET',
  hideFpts = false,
}: MatchupTickerProps) {
  const [now, setNow] = useState(() => Date.now());

  // Refresh relative time labels every 10s so "Xs ago" actually counts for
  // fresh events. The whole component re-renders, but it's a tight marquee —
  // cheap enough to keep the labels honest. Without this the first 30s of a
  // new event's life all read as "0s ago".
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  // Points-league filter: drop events whose computed fpts is 0 — e.g. a foul
  // in a league that doesn't score PF, or a missed FT in a league that doesn't
  // count attempts. Those are visual noise on the recap tape. Category leagues
  // skip the filter (no point values exist) and show every play.
  const rendered = useMemo(() => {
    const out: {
      id: string;
      name: string;
      fptsStr: string;
      fptsNeg: boolean;
      action: string;
      ago: string;
    }[] = [];
    for (const e of events) {
      const fpts = hideFpts
        ? 0
        : Math.round(fptsForEvent(e.kind, e.value, scoring) * 10) / 10;
      if (!hideFpts && fpts === 0) continue;
      const fptsStr = fpts > 0 ? `+${fpts.toFixed(1)}` : fpts.toFixed(1);
      out.push({
        id: e.id,
        name: e.player_name.toUpperCase(),
        fptsStr,
        fptsNeg: fpts < 0,
        action: actionLabel(e.kind, e.value),
        ago: relativeTime(e.occurred_at, now),
      });
    }
    return out;
  }, [events, scoring, now, hideFpts]);

  const a11yLabel =
    rendered.length > 0
      ? `Recap: ${rendered
          .map((r) =>
            hideFpts
              ? `${r.name} ${r.action} ${r.ago}`
              : `${r.name} ${r.fptsStr} ${r.action} ${r.ago}`,
          )
          .join(', ')}`
      : `Recap: ${emptyText.toLowerCase()}`;

  const items = rendered.map((r) => (
    <View key={r.id} style={chipStyles.chip}>
      <ThemedText type="varsity" style={chipStyles.name} numberOfLines={1}>
        {r.name}
      </ThemedText>
      {!hideFpts && (
        <ThemedText
          style={[chipStyles.value, { color: r.fptsNeg ? FPTS_NEG : FPTS_POS }]}
        >
          {r.fptsStr}
        </ThemedText>
      )}
      <ThemedText style={chipStyles.detail} numberOfLines={1}>
        {r.action}
      </ThemedText>
      <ThemedText style={chipStyles.muted} numberOfLines={1}>
        {r.ago}
      </ThemedText>
      <View style={chipStyles.dot} />
    </View>
  ));

  return <MarqueeBand label="RECAP" items={items} emptyText={emptyText} a11yLabel={a11yLabel} />;
}
