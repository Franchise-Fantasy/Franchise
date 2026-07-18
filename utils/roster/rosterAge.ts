import { AGE_BUCKET_COLORS } from '@/constants/StatusColors';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { ordinalSuffix } from '@/utils/formatting';
import { effectiveFantasyPoints } from '@/utils/scoring/fantasyPoints';


// Age bucket boundaries. NFL careers run shorter and peak earlier than NBA
// ones — a 31-year-old RB is a veteran on the decline, not "prime" — so the
// buckets shift down a year rather than mislabeling half an NFL roster.
const RISING_MAX = 25;
const PRIME_MAX = 31;
const NFL_RISING_MAX = 25;
const NFL_PRIME_MAX = 29;

export interface AgeFptsPoint {
  name: string;
  shortName: string;
  age: number;
  avgFpts: number;
  playerId: string;
  position: string;
}

export interface RosterAgeProfile {
  avgAge: number;
  weightedProductionAge: number;
  risingCount: number;
  primeCount: number;
  vetCount: number;
  totalWithAge: number;
}

export interface TeamAgeProfile extends RosterAgeProfile {
  teamId: string;
}

export interface LeagueAgeComparison {
  myProfile: TeamAgeProfile;
  leagueAvgWeightedAge: number;
  leagueAvgRosterAge: number;
  weightedAgeRank: number;  // 1 = youngest weighted age in league
  totalTeams: number;
  allProfiles: TeamAgeProfile[];
}

export const BUCKET_COLORS = AGE_BUCKET_COLORS;

const SUFFIXES = new Set(['Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV', 'V']);

/** Returns a short display name: last name + suffix if present (e.g. "Porter Jr.") */
export function shortDisplayName(fullName: string): string {
  const parts = fullName.split(' ');
  if (parts.length <= 1) return fullName;
  const last = parts[parts.length - 1];
  if (SUFFIXES.has(last) && parts.length > 2) {
    return `${parts[parts.length - 2]} ${last}`;
  }
  return last;
}

/** Returns precise fractional age (e.g. 28.3) for charts and averaging */
export function calculateAge(birthdate: string): number {
  const birth = new Date(birthdate);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const monthDiff = now.getMonth() - birth.getMonth();
  const dayDiff = now.getDate() - birth.getDate();
  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    years--;
  }
  // Add fractional part from months elapsed since last birthday
  let monthsElapsed = monthDiff + (dayDiff < 0 ? -1 : 0);
  if (monthsElapsed < 0) monthsElapsed += 12;
  return Math.round((years + monthsElapsed / 12) * 10) / 10;
}

export function ageBucket(age: number, sport?: string | null): 'rising' | 'prime' | 'vet' {
  const risingMax = sport === 'nfl' ? NFL_RISING_MAX : RISING_MAX;
  const primeMax = sport === 'nfl' ? NFL_PRIME_MAX : PRIME_MAX;
  if (age < risingMax) return 'rising';
  if (age < primeMax) return 'prime';
  return 'vet';
}

export function calculateRosterAgeProfile(
  players: PlayerSeasonStats[],
  scoringWeights: ScoringWeight[],
  prevSeasonFptsMap?: Map<string, number>,
  minGames?: number,
  sport?: string | null,
): RosterAgeProfile {
  let totalAge = 0;
  let weightedAgeSum = 0;
  let totalFpts = 0;
  let risingCount = 0;
  let primeCount = 0;
  let vetCount = 0;
  let totalWithAge = 0;

  for (const p of players) {
    if (!p.birthdate) continue;
    const age = calculateAge(p.birthdate);
    // Use prev-season fpts as the weight for players who haven't crossed
    // the games threshold yet — keeps the metric meaningful during WNBA
    // pre-tipoff and the first weeks of any season.
    const fpts = effectiveFantasyPoints(p, scoringWeights, prevSeasonFptsMap, minGames, sport);

    totalWithAge++;
    totalAge += age;
    weightedAgeSum += age * Math.max(fpts, 0);
    totalFpts += Math.max(fpts, 0);

    const bucket = ageBucket(age, sport);
    if (bucket === 'rising') risingCount++;
    else if (bucket === 'prime') primeCount++;
    else vetCount++;
  }

  return {
    avgAge: totalWithAge > 0 ? Math.round((totalAge / totalWithAge) * 10) / 10 : 0,
    // When no production signal exists for anyone (preseason + no historical
    // fallback), fall back to the plain avg age so the chart still reads.
    weightedProductionAge: totalFpts > 0
      ? Math.round((weightedAgeSum / totalFpts) * 10) / 10
      : (totalWithAge > 0 ? Math.round((totalAge / totalWithAge) * 10) / 10 : 0),
    risingCount,
    primeCount,
    vetCount,
    totalWithAge,
  };
}

export function buildScatterData(
  players: PlayerSeasonStats[],
  scoringWeights: ScoringWeight[],
  prevSeasonFptsMap?: Map<string, number>,
  minGames?: number,
  sport?: string | null,
): AgeFptsPoint[] {
  // Players need either a current-season sample OR a prev-season fallback
  // — pre-tipoff WNBA rosters have no current games but should still chart.
  return players
    .filter((p) => p.birthdate && (p.games_played >= 5 || prevSeasonFptsMap?.has(p.player_id)))
    .map((p) => ({
      name: p.name,
      shortName: shortDisplayName(p.name),
      age: calculateAge(p.birthdate!),
      avgFpts: effectiveFantasyPoints(p, scoringWeights, prevSeasonFptsMap, minGames, sport),
      playerId: p.player_id,
      position: p.position,
    }));
}

/** Compute age profiles for every team in the league, then rank & compare */
export function buildLeagueComparison(
  allPlayers: { team_id: string }[] & PlayerSeasonStats[],
  scoringWeights: ScoringWeight[],
  myTeamId: string,
  prevSeasonFptsMap?: Map<string, number>,
  minGames?: number,
  sport?: string | null,
): LeagueAgeComparison | null {
  // Group players by team
  const byTeam = new Map<string, PlayerSeasonStats[]>();
  for (const p of allPlayers) {
    const tid = (p as any).team_id as string;
    if (!tid) continue;
    if (!byTeam.has(tid)) byTeam.set(tid, []);
    byTeam.get(tid)!.push(p);
  }

  // Compute profile for each team
  const profiles: TeamAgeProfile[] = [];
  for (const [teamId, teamPlayers] of byTeam) {
    const profile = calculateRosterAgeProfile(teamPlayers, scoringWeights, prevSeasonFptsMap, minGames, sport);
    if (profile.totalWithAge >= 3) {
      profiles.push({ ...profile, teamId });
    }
  }

  const myProfile = profiles.find((p) => p.teamId === myTeamId);
  if (!myProfile || profiles.length < 2) return null;

  // League averages
  const leagueAvgWeightedAge =
    Math.round(
      (profiles.reduce((s, p) => s + p.weightedProductionAge, 0) / profiles.length) * 10,
    ) / 10;
  const leagueAvgRosterAge =
    Math.round(
      (profiles.reduce((s, p) => s + p.avgAge, 0) / profiles.length) * 10,
    ) / 10;

  // Rank by weighted age (1 = youngest). Ages are rounded to 1dp before ranking,
  // so exact ties between teams are common — teamId breaks them, otherwise the
  // stable sort falls back to input order and the rank rides on the row order of
  // `get_league_roster_stats` (which has no ORDER BY, so it can differ per call).
  const sorted = [...profiles].sort(
    (a, b) =>
      a.weightedProductionAge - b.weightedProductionAge ||
      a.teamId.localeCompare(b.teamId),
  );
  const weightedAgeRank = sorted.findIndex((p) => p.teamId === myTeamId) + 1;

  return {
    myProfile,
    leagueAvgWeightedAge,
    leagueAvgRosterAge,
    weightedAgeRank,
    totalTeams: profiles.length,
    allProfiles: sorted,
  };
}

/**
 * The league-position label, always counted up from the youngest team —
 * "9th" / "youngest of 12".
 *
 * Both age cards (the analytics narrative card and the home preview) render
 * this, and they used to each mirror the rank past the halfway mark on their
 * own — rank 9 of 12 became "4th oldest". Two teams' cards then read on
 * opposite scales, which is what made the number impossible to compare. One
 * formatter means a direction change can only ever happen in one place.
 *
 * `sub` is lowercase; callers that render in varsity caps uppercase it.
 */
export function formatAgeRank(
  rank: number,
  totalTeams: number,
): { value: string; sub: string } {
  return {
    value: `${rank}${ordinalSuffix(rank)}`,
    sub: `youngest of ${totalTeams}`,
  };
}

export const PEAK_YEARS = { start: 25, end: 30 };
