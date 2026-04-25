import { AGE_BUCKET_COLORS } from '@/constants/StatusColors';
import { PlayerSeasonStats, ScoringWeight } from '@/types/player';
import { calculateAvgFantasyPoints } from '@/utils/fantasyPoints';


// Age bucket boundaries
const RISING_MAX = 25;
const PRIME_MAX = 31;

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

export function ageBucket(age: number): 'rising' | 'prime' | 'vet' {
  if (age < RISING_MAX) return 'rising';
  if (age < PRIME_MAX) return 'prime';
  return 'vet';
}

export function calculateRosterAgeProfile(
  players: PlayerSeasonStats[],
  scoringWeights: ScoringWeight[],
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
    const fpts = calculateAvgFantasyPoints(p, scoringWeights);

    totalWithAge++;
    totalAge += age;
    weightedAgeSum += age * Math.max(fpts, 0);
    totalFpts += Math.max(fpts, 0);

    const bucket = ageBucket(age);
    if (bucket === 'rising') risingCount++;
    else if (bucket === 'prime') primeCount++;
    else vetCount++;
  }

  return {
    avgAge: totalWithAge > 0 ? Math.round((totalAge / totalWithAge) * 10) / 10 : 0,
    weightedProductionAge: totalFpts > 0
      ? Math.round((weightedAgeSum / totalFpts) * 10) / 10
      : 0,
    risingCount,
    primeCount,
    vetCount,
    totalWithAge,
  };
}

export function buildScatterData(
  players: PlayerSeasonStats[],
  scoringWeights: ScoringWeight[],
): AgeFptsPoint[] {
  return players
    .filter((p) => p.birthdate && p.games_played >= 5)
    .map((p) => ({
      name: p.name,
      shortName: shortDisplayName(p.name),
      age: calculateAge(p.birthdate!),
      avgFpts: calculateAvgFantasyPoints(p, scoringWeights),
      playerId: p.player_id,
      position: p.position,
    }));
}

/** Compute age profiles for every team in the league, then rank & compare */
export function buildLeagueComparison(
  allPlayers: { team_id: string }[] & PlayerSeasonStats[],
  scoringWeights: ScoringWeight[],
  myTeamId: string,
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
    const profile = calculateRosterAgeProfile(teamPlayers, scoringWeights);
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

  // Rank by weighted age (1 = youngest)
  const sorted = [...profiles].sort(
    (a, b) => a.weightedProductionAge - b.weightedProductionAge,
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

export function getInsightText(
  profile: RosterAgeProfile,
  comparison?: LeagueAgeComparison | null,
): string {
  const { risingCount, primeCount, vetCount, avgAge, weightedProductionAge } = profile;

  // Build composition string
  const parts: string[] = [];
  if (primeCount > 0) parts.push(`${primeCount} prime-age`);
  if (risingCount > 0) parts.push(`${risingCount} rising`);
  if (vetCount > 0) parts.push(`${vetCount} veteran`);
  const composition = parts.length > 0 ? parts.join(', ') : null;

  // League-aware insight
  if (comparison) {
    const rank = comparison.weightedAgeRank;
    const total = comparison.totalTeams;

    let rankLabel: string;
    if (rank === 1) rankLabel = 'Youngest roster in league';
    else if (rank === total) rankLabel = 'Oldest roster in league';
    else if (rank <= Math.ceil(total / 2)) rankLabel = `${ordinal(rank)} youngest of ${total} teams`;
    else rankLabel = `${ordinal(total - rank + 1)} oldest of ${total} teams`;

    return composition ? `${rankLabel} — ${composition}` : rankLabel;
  }

  // Fallback: team-only insight using weighted vs raw gap
  const diff = weightedProductionAge - avgAge;
  const gap = Math.abs(diff).toFixed(1);

  let detail: string;
  if (diff > 1) detail = `Production weighted ${gap}yr above raw average`;
  else if (diff < -1) detail = `Production weighted ${gap}yr below raw average`;
  else detail = 'Balanced age profile';

  return composition ? `${detail} — ${composition}` : detail;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export const PEAK_YEARS = { start: 25, end: 30 };
