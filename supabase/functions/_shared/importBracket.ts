// Builds `playoff_bracket` rows from an imported/OCR'd bracket structure so an
// imported season renders in the same Playoff History view as a played one.
// Pure — the caller supplies a `resolve(teamName) => team_id | null` fn (each
// import function has its own fuzzy matcher), so this stays runtime-agnostic.

import { z } from './validate.ts';

const ImportBracketMatchupSchema = z.object({
  team_a: z.string(),
  team_a_seed: z.number().int().nullable().optional(),
  team_a_score: z.number().nullable().optional(),
  team_b: z.string(),
  team_b_seed: z.number().int().nullable().optional(),
  team_b_score: z.number().nullable().optional(),
  winner: z.string().nullable().optional(),
});

/** Zod schema for the imported-bracket payload, shared by both import functions. */
export const ImportBracketSchema = z.object({
  rounds: z.array(z.object({ matchups: z.array(ImportBracketMatchupSchema) })),
  third_place: ImportBracketMatchupSchema.nullable().optional(),
});

export interface ImportBracketMatchupInput {
  team_a: string;
  team_a_seed?: number | null;
  team_a_score?: number | null;
  team_b: string;
  team_b_seed?: number | null;
  team_b_score?: number | null;
  winner?: string | null;
}

export interface ImportBracketInput {
  /** Rounds ordered earliest-first, championship last. Excludes the 3rd-place game. */
  rounds: { matchups: ImportBracketMatchupInput[] }[];
  third_place?: ImportBracketMatchupInput | null;
}

export interface BracketRow {
  league_id: string;
  season: string;
  round: number;
  bracket_position: number;
  team_a_id: string | null;
  team_a_seed: number | null;
  team_a_score: number | null;
  team_b_id: string | null;
  team_b_seed: number | null;
  team_b_score: number | null;
  winner_id: string | null;
  is_bye: boolean;
  is_third_place: boolean;
}

function makeRow(
  leagueId: string,
  season: string,
  round: number,
  position: number,
  m: ImportBracketMatchupInput,
  resolve: (name: string) => string | null,
  isThirdPlace: boolean,
): BracketRow {
  return {
    league_id: leagueId,
    season,
    round,
    bracket_position: position,
    team_a_id: resolve(m.team_a),
    team_a_seed: m.team_a_seed ?? null,
    team_a_score: m.team_a_score ?? null,
    team_b_id: resolve(m.team_b),
    team_b_seed: m.team_b_seed ?? null,
    team_b_score: m.team_b_score ?? null,
    winner_id: m.winner ? resolve(m.winner) : null,
    is_bye: false,
    is_third_place: isThirdPlace,
  };
}

export function buildBracketRows(
  leagueId: string,
  season: string,
  bracket: ImportBracketInput,
  resolve: (name: string) => string | null,
): BracketRow[] {
  const rows: BracketRow[] = [];
  bracket.rounds.forEach((round, roundIdx) => {
    round.matchups.forEach((m, position) => {
      rows.push(makeRow(leagueId, season, roundIdx + 1, position, m, resolve, false));
    });
  });
  // The 3rd-place game shares the championship round number — the bracket view
  // filters `is_third_place` into its own section, so `round` only feeds the
  // main-bracket max-round label.
  if (bracket.third_place) {
    rows.push(
      makeRow(leagueId, season, Math.max(bracket.rounds.length, 1), 0, bracket.third_place, resolve, true),
    );
  }
  return rows;
}
