/**
 * FG% / 3P% / FT% for a player stat row.
 *
 * These must NEVER be derived from `avg_*` columns when anything better is on
 * the row. Both `player_season_stats` and `player_historical_stats` persist
 * per-game averages as `numeric(5,1)`, so a low-volume line like 0.55 FTM on
 * 0.64 FTA is stored as `0.6 / 0.6` and divides out to a nonsense **100.0%**.
 * Al Horford's 2024-25 row shipped exactly that (user-reported 2026-07-31);
 * 99 of 1,191 historical rows were showing FT% ≥ 100%.
 *
 * Precedence, most to least precise:
 *   1. a stored `*_pct` column (a real season rate, full precision)
 *   2. season `total_*` makes/attempts (exact integers)
 *   3. `avg_*` makes/attempts — the rounded last resort, kept only so rows
 *      predating the pct backfill still render something.
 *
 * Windowed rows built by `buildWindowedStatRow` are safe at any tier: their
 * `avg_*` values are unrounded means, so every path agrees.
 */

export type ShootingStat = "fg" | "fg3" | "ft";

const COLUMNS: Record<ShootingStat, { pct: string; made: string; att: string }> = {
  fg: { pct: "fg_pct", made: "fgm", att: "fga" },
  fg3: { pct: "fg3_pct", made: "3pm", att: "3pa" },
  ft: { pct: "ft_pct", made: "ftm", att: "fta" },
};

/** Numeric-or-null. Postgres numerics arrive as strings over PostgREST. */
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** made ÷ att as a 0-100 percentage, or null when there were no attempts. */
function ratio(made: unknown, att: unknown): number | null {
  const m = num(made);
  const a = num(att);
  if (m == null || a == null || a <= 0) return null;
  return (m / a) * 100;
}

/**
 * Shooting percentage (0-100) for a `player_season_stats` /
 * `player_historical_stats` / windowed row. Null when the player has no
 * attempts — callers render that as "—", not "0.0%".
 */
export function shootingPct(row: object | null | undefined, stat: ShootingStat): number | null {
  if (!row) return null;
  // Loose read: the three row shapes (matview, historical, windowed) carry
  // overlapping but non-identical column sets, and only one cast is needed.
  const r = row as Record<string, unknown>;
  const col = COLUMNS[stat];
  // Stored pct columns hold a fraction (numeric(4,3), e.g. 0.845).
  const stored = num(r[col.pct]);
  if (stored != null) return stored * 100;
  return (
    ratio(r[`total_${col.made}`], r[`total_${col.att}`]) ??
    ratio(r[`avg_${col.made}`], r[`avg_${col.att}`])
  );
}

/**
 * Shooting percentage (0-100) for a `player_projections` row. Projections
 * carry no totals, so it's the stored `proj_*_pct` or the rounded per-game
 * projection. `proj_fg3_pct` doesn't exist yet — 3P% falls back to
 * proj_3pm/proj_3pa, where the attempt volume makes rounding error small.
 */
export function projShootingPct(row: object | null | undefined, stat: ShootingStat): number | null {
  if (!row) return null;
  const r = row as Record<string, unknown>;
  const col = COLUMNS[stat];
  const stored = num(r[`proj_${col.pct}`]);
  if (stored != null) return stored * 100;
  return ratio(r[`proj_${col.made}`], r[`proj_${col.att}`]);
}

/** `84.6%`, or "—" when there's nothing to show. */
export function formatShootingPct(value: number | null, digits = 1): string {
  return value == null ? "—" : `${value.toFixed(digits)}%`;
}
