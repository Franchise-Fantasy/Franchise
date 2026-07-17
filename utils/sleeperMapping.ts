import { RosterSlot, ScoringCategory, Sport, getDefaultRosterSlots } from '@/constants/LeagueDefaults';
import { ROSTER_SLOT } from '@/utils/roster/rosterSlotsShared';
import { getSportModule } from '@/utils/sports/registry';

// --- Types ---

export interface SleeperPlayer {
  player_id: string;
  full_name: string;
  team: string | null;
  position: string | null;
  fantasy_positions: string[] | null;
}

export interface PlayerMatch {
  sleeper_id: string;
  sleeper_name: string;
  sleeper_team: string | null;
  matched_player_id: string | null;
  matched_name: string | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
}

export interface OurPlayer {
  id: string;
  name: string;
  pro_team: string | null;
  position: string | null;
}

// --- Sleeper Scoring Keys → Our Stat Names ---
//
// Two per-sport maps, kept in sync with the edge copies in
// supabase/functions/import-sleeper-league/index.ts.

const NBA_SCORING_KEY_MAP: Record<string, string> = {
  pts: 'PTS',
  reb: 'REB',
  ast: 'AST',
  stl: 'STL',
  blk: 'BLK',
  to: 'TO',
  fg3m: '3PM',
  fg3a: '3PA',
  fgm: 'FGM',
  fga: 'FGA',
  ftm: 'FTM',
  fta: 'FTA',
  pf: 'PF',
  dd: 'DD',
  td: 'TD',
  // Sleeper sometimes uses these alternate keys
  threes: '3PM',
  turnovers: 'TO',
  double_double: 'DD',
  triple_double: 'TD',
};

const NFL_SCORING_KEY_MAP: Record<string, string> = {
  pass_yd: 'PASS_YD',
  pass_td: 'PASS_TD',
  pass_int: 'PASS_INT',
  rush_yd: 'RUSH_YD',
  rush_td: 'RUSH_TD',
  rec: 'REC',
  rec_yd: 'REC_YD',
  rec_td: 'REC_TD',
  fum_lost: 'FUM_LOST',
  fgm: 'FG',
  xpm: 'XP',
  def_td: 'DST_TD',
  sack: 'DST_SACK',
  int: 'DST_INT',
  fum_rec: 'DST_FUM_REC',
};

function scoringKeyMap(sport: Sport): Record<string, string> {
  return sport === 'nfl' ? NFL_SCORING_KEY_MAP : NBA_SCORING_KEY_MAP;
}

// --- Sleeper Roster Positions → Our Positions ---

const NBA_POSITION_MAP: Record<string, string> = {
  PG: 'PG',
  SG: 'SG',
  SF: 'SF',
  PF: 'PF',
  C: 'C',
  G: 'G',
  F: 'F',
  UTIL: 'UTIL',
  FLEX: 'UTIL',
  BN: 'BE',
  IR: 'IR',
  IL: 'IR',
};

const NFL_POSITION_MAP: Record<string, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'TE',
  K: 'K',
  DEF: 'DST',
  DST: 'DST',
  FLEX: 'FLEX',
  SUPER_FLEX: 'SFLX',
  WRRB_FLEX: 'FLEX',
  REC_FLEX: 'FLEX',
  BN: 'BE',
  IR: 'IR',
  IL: 'IR',
};

// --- Mapping Functions ---

/**
 * Convert Sleeper roster_positions array to our RosterSlot[] format.
 * Sleeper sends e.g. ["PG","SG","UTIL","BN","IR"] (NBA) or
 * ["QB","RB","RB","WR","WR","TE","FLEX","K","DEF","BN","IR"] (NFL).
 * We count occurrences, map to our slot names, and lay them out in the
 * sport's canonical slot order (labels + order sourced from the registry
 * template so a new sport doesn't need a hand-maintained list here).
 * TAXI is always 0 — Sleeper doesn't model it; users opt in on the Roster step.
 */
export function mapSleeperPositions(rosterPositions: string[], sport: Sport = 'nba'): RosterSlot[] {
  const map = sport === 'nfl' ? NFL_POSITION_MAP : NBA_POSITION_MAP;
  const counts = new Map<string, number>();

  for (const pos of rosterPositions) {
    const mapped = map[pos.toUpperCase()];
    if (!mapped) continue;
    counts.set(mapped, (counts.get(mapped) ?? 0) + 1);
  }

  // Basketball keeps its historical explicit order/labels (the NBA registry
  // template collapses G/F/UTIL differently); NFL is driven off the registry
  // template so FLEX/SFLX/DST render with the right labels.
  if (sport === 'nfl') {
    return getDefaultRosterSlots('nfl').map((slot) => ({
      ...slot,
      count: slot.position === ROSTER_SLOT.TAXI ? 0 : (counts.get(slot.position) ?? 0),
    }));
  }

  const LABELS: Record<string, string> = {
    PG: 'Point Guard',
    SG: 'Shooting Guard',
    SF: 'Small Forward',
    PF: 'Power Forward',
    C: 'Center',
    G: 'Guard',
    F: 'Forward',
    UTIL: 'Utility',
    BE: 'Bench',
    IR: 'Injured Reserve',
    TAXI: 'Taxi Squad',
  };

  const ORDER = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BE', 'IR', ROSTER_SLOT.TAXI];

  return ORDER.map((pos) => ({
    position: pos,
    label: LABELS[pos] ?? pos,
    count: counts.get(pos) ?? 0,
  }));
}

/**
 * Convert Sleeper scoring_settings to our ScoringCategory[] format.
 * Sleeper sends { pts: 1, reb: 1.2, ... } (NBA) or { pass_yd: 0.04, rec: 1, ... }
 * (NFL). We map keys to our stat names and fill the sport's defaults for any
 * missing categories. The input may already be our-stat-name keyed (the edge
 * preview pre-maps it), so an unrecognized key that IS one of the sport's own
 * stat names is accepted verbatim.
 */
export function mapSleeperScoring(
  scoringSettings: Record<string, number>,
  sport: Sport = 'nba',
): ScoringCategory[] {
  const keyMap = scoringKeyMap(sport);
  const base = getSportModule(sport).defaultScoring;
  const knownStats = new Set(base.map((c) => c.stat_name));
  const mapped = new Map<string, number>();

  for (const [key, value] of Object.entries(scoringSettings)) {
    const ourKey = keyMap[key.toLowerCase()] ?? (knownStats.has(key) ? key : undefined);
    if (ourKey && !mapped.has(ourKey)) {
      mapped.set(ourKey, value);
    }
  }

  return base.map((cat) => ({
    ...cat,
    point_value: mapped.get(cat.stat_name) ?? cat.point_value,
  }));
}

/**
 * Normalize a player name for fuzzy matching.
 * Strips suffixes, periods, unicode accents, and lowercases.
 */
export function normalizePlayerName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '') // strip suffixes
    .replace(/\./g, '') // strip periods (P.J. → PJ)
    .replace(/['-]/g, '') // strip apostrophes/hyphens
    .replace(/\s+/g, ' ') // collapse whitespace
    .trim();
}

/**
 * Match Sleeper players to our players table.
 * Returns matched (with confidence) and unmatched arrays.
 */
export function matchPlayers(
  sleeperPlayers: SleeperPlayer[],
  ourPlayers: OurPlayer[]
): { matched: PlayerMatch[]; unmatched: PlayerMatch[] } {
  // Build lookup maps by normalized name
  const byNameAndTeam = new Map<string, OurPlayer>();
  const byNameOnly = new Map<string, OurPlayer[]>();

  for (const p of ourPlayers) {
    const norm = normalizePlayerName(p.name);
    const key = `${norm}|${(p.pro_team ?? '').toUpperCase()}`;
    byNameAndTeam.set(key, p);

    if (!byNameOnly.has(norm)) byNameOnly.set(norm, []);
    byNameOnly.get(norm)!.push(p);
  }

  const matched: PlayerMatch[] = [];
  const unmatched: PlayerMatch[] = [];

  for (const sp of sleeperPlayers) {
    const norm = normalizePlayerName(sp.full_name);
    const team = (sp.team ?? '').toUpperCase();
    const key = `${norm}|${team}`;

    const base: Omit<PlayerMatch, 'matched_player_id' | 'matched_name' | 'confidence'> = {
      sleeper_id: sp.player_id,
      sleeper_name: sp.full_name,
      sleeper_team: sp.team,
    };

    // Try exact name + team match
    const exactMatch = byNameAndTeam.get(key);
    if (exactMatch) {
      matched.push({
        ...base,
        matched_player_id: exactMatch.id,
        matched_name: exactMatch.name,
        confidence: 'high',
      });
      continue;
    }

    // Try name-only match
    const nameMatches = byNameOnly.get(norm);
    if (nameMatches && nameMatches.length === 1) {
      matched.push({
        ...base,
        matched_player_id: nameMatches[0].id,
        matched_name: nameMatches[0].name,
        confidence: 'medium',
      });
      continue;
    }

    if (nameMatches && nameMatches.length > 1) {
      // Multiple name matches — ambiguous, mark as unmatched for manual resolution
      unmatched.push({
        ...base,
        matched_player_id: null,
        matched_name: null,
        confidence: 'low',
      });
      continue;
    }

    // No match at all
    unmatched.push({
      ...base,
      matched_player_id: null,
      matched_name: null,
      confidence: 'none',
    });
  }

  return { matched, unmatched };
}

/**
 * Assign roster_slot values based on Sleeper's starters/players/reserve arrays
 * and the league's roster_positions config.
 *
 * Sleeper's `starters` array is ordered to match `roster_positions` (excluding BN/IR).
 * `players` array contains ALL player IDs on the roster (starters + bench).
 * `reserve` array contains IR player IDs.
 */
export function assignRosterSlots(
  starters: string[],
  allPlayers: string[],
  reserve: string[] | null,
  rosterPositions: string[],
  sport: Sport = 'nba',
): Map<string, string> {
  const slotMap = new Map<string, string>();
  const map = sport === 'nfl' ? NFL_POSITION_MAP : NBA_POSITION_MAP;

  // Starter positions (non-BN, non-IR, non-TAXI entries in roster_positions)
  const NON_STARTER = new Set(['BN', 'IR', 'IL', 'TAXI']);
  const starterPositions = rosterPositions.filter((p) => !NON_STARTER.has(p.toUpperCase()));

  // Map starters to their positional slots. UTIL is numbered; every other slot
  // uses its bare name; an unknown token benches the player.
  let utilIndex = 0;
  for (let i = 0; i < starters.length && i < starterPositions.length; i++) {
    const playerId = starters[i];
    if (!playerId || playerId === '0') continue; // empty slot

    const mappedSlot = map[starterPositions[i].toUpperCase()];
    if (mappedSlot === 'UTIL') {
      utilIndex++;
      slotMap.set(playerId, `UTIL${utilIndex}`);
    } else {
      slotMap.set(playerId, mappedSlot ?? 'BE');
    }
  }

  // Map reserve/IR players
  if (reserve) {
    for (const playerId of reserve) {
      if (playerId && playerId !== '0') {
        slotMap.set(playerId, 'IR');
      }
    }
  }

  // Everyone else in `allPlayers` not already assigned is bench
  for (const playerId of allPlayers) {
    if (!slotMap.has(playerId)) {
      slotMap.set(playerId, 'BE');
    }
  }

  return slotMap;
}

/**
 * Compute roster_size from roster slots (excluding IR).
 */
export function computeRosterSize(slots: RosterSlot[]): number {
  return slots.reduce(
    (sum, s) => (s.position === 'IR' ? sum : sum + s.count),
    0
  );
}
