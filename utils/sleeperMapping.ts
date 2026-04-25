import { RosterSlot, ScoringCategory, DEFAULT_SCORING } from '@/constants/LeagueDefaults';

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

const SCORING_KEY_MAP: Record<string, string> = {
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

// --- Sleeper Roster Positions → Our Positions ---

const POSITION_MAP: Record<string, string> = {
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

// --- Mapping Functions ---

/**
 * Convert Sleeper roster_positions array to our RosterSlot[] format.
 * Sleeper sends: ["PG","SG","SF","PF","C","G","F","UTIL","UTIL","BN","BN","BN","IR"]
 * We count occurrences and map to our position names.
 */
export function mapSleeperPositions(rosterPositions: string[]): RosterSlot[] {
  const counts = new Map<string, number>();

  for (const pos of rosterPositions) {
    const mapped = POSITION_MAP[pos.toUpperCase()];
    if (!mapped) continue;
    counts.set(mapped, (counts.get(mapped) ?? 0) + 1);
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

  // Maintain standard slot ordering. TAXI is a dynasty-only concept
  // that Sleeper doesn't model, so it's always appended with count 0
  // — users opt in during the Roster step. Same shape as
  // `DEFAULT_ROSTER_SLOTS` so StepRoster's TAXI UI renders for
  // imports too.
  const ORDER = ['PG', 'SG', 'SF', 'PF', 'C', 'G', 'F', 'UTIL', 'BE', 'IR', 'TAXI'];

  return ORDER.map((pos) => ({
    position: pos,
    label: LABELS[pos] ?? pos,
    count: counts.get(pos) ?? 0,
  }));
}

/**
 * Convert Sleeper scoring_settings to our ScoringCategory[] format.
 * Sleeper sends: { pts: 1, reb: 1.2, ast: 1.5, ... }
 * We map keys and fill defaults for any missing categories.
 */
export function mapSleeperScoring(
  scoringSettings: Record<string, number>
): ScoringCategory[] {
  const mapped = new Map<string, number>();

  for (const [key, value] of Object.entries(scoringSettings)) {
    const ourKey = SCORING_KEY_MAP[key.toLowerCase()];
    if (ourKey && !mapped.has(ourKey)) {
      mapped.set(ourKey, value);
    }
  }

  return DEFAULT_SCORING.map((cat) => ({
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
  rosterPositions: string[]
): Map<string, string> {
  const slotMap = new Map<string, string>();
  const utilCount = new Map<number, boolean>();

  // Starter positions (non-BN, non-IR entries in roster_positions)
  const starterPositions = rosterPositions.filter(
    (p) => p !== 'BN' && p !== 'IR' && p !== 'IL'
  );

  // Map starters to their positional slots
  let utilIndex = 0;
  for (let i = 0; i < starters.length && i < starterPositions.length; i++) {
    const playerId = starters[i];
    if (!playerId || playerId === '0') continue; // empty slot

    const pos = POSITION_MAP[starterPositions[i].toUpperCase()] ?? starterPositions[i];
    if (pos === 'UTIL') {
      utilIndex++;
      slotMap.set(playerId, `UTIL${utilIndex}`);
    } else {
      slotMap.set(playerId, pos);
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
