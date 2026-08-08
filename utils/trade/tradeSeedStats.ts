import {
  formatSeasonShort,
  getCurrentSeason,
  getPreviousSeason,
  type Sport,
} from '@/constants/LeagueDefaults';
import type { ProjectionRow } from '@/hooks/usePlayerProjections';
import { supabase } from '@/lib/supabase';
import type { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/scoring/fantasyPoints';
import { resolveStatBasis } from '@/utils/scoring/statBasis';

export interface SeedPlayerStats {
  /** player_id → FPTS/G, the value the lane renders and the fairness bar sums. */
  fptsMap: Record<string, number>;
  externalIdMap: Record<string, string | null>;
}

/**
 * Per-game fantasy points for the trade builder's SEEDED entry paths — a
 * counteroffer restoring the original offer's assets, and the deep link that
 * opens the modal with one player already on a lane. Both bypass the player
 * picker, so without this they'd compute straight off `player_season_stats` and
 * read 0.0 between seasons while the picker beside them showed a projection.
 *
 * Resolves through the same projection → last-season chain
 * (`resolveStatBasis`), so every number inside one trade agrees regardless of
 * how the asset got onto the lane.
 */
export async function fetchSeedPlayerStats(
  playerIds: string[],
  scoringWeights: ScoringWeight[] | undefined,
  sport: Sport,
): Promise<SeedPlayerStats> {
  const empty: SeedPlayerStats = { fptsMap: {}, externalIdMap: {} };
  if (playerIds.length === 0 || !scoringWeights?.length) return empty;

  const previousSeason = getPreviousSeason(sport);
  const [statsRes, projRes, prevRes] = await Promise.all([
    supabase.from('player_season_stats').select('*').in('player_id', playerIds),
    // NFL has no projections engine in v1 — skip rather than round-trip for an
    // empty set, and let last season carry those rows.
    sport === 'nfl'
      ? Promise.resolve({ data: [] as ProjectionRow[] })
      : supabase
          .from('current_player_projections')
          .select('*')
          .eq('sport', sport)
          .eq('horizon', 'season')
          .eq('season', getCurrentSeason(sport))
          .in('player_id', playerIds),
    supabase
      .from('player_historical_stats')
      .select('*')
      .eq('sport', sport)
      .eq('season', previousSeason)
      .in('player_id', playerIds),
  ]);

  const projections = new Map<string, ProjectionRow>();
  for (const row of (projRes.data ?? []) as ProjectionRow[]) {
    if (row.player_id) projections.set(row.player_id, row);
  }
  const historical = new Map<string, Record<string, unknown>>();
  for (const row of prevRes.data ?? []) {
    const pid = (row as { player_id?: string }).player_id;
    if (pid) historical.set(pid, row as Record<string, unknown>);
  }

  const prevSeasonLabel = formatSeasonShort(previousSeason, sport);
  const out: SeedPlayerStats = { fptsMap: {}, externalIdMap: {} };
  for (const raw of (statsRes.data ?? []) as PlayerSeasonStats[]) {
    if (!raw.player_id) continue;
    const { row, hasStats } = resolveStatBasis({
      player: raw,
      projection: projections.get(raw.player_id),
      historical: historical.get(raw.player_id),
      sport,
      prevSeasonLabel,
    });
    out.fptsMap[raw.player_id] = hasStats
      ? calculateAvgFantasyPoints(row, scoringWeights, sport)
      : 0;
    out.externalIdMap[raw.player_id] = raw.external_id_nba ?? null;
  }
  return out;
}
