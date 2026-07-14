import { isTaxiEligible } from '@/utils/roster/taxiEligibility';
import { nflDraftYearFromExperience, nflReferenceSeason } from '@/utils/sports/nflExperience';

// Every expectation below is pinned to the live BDL feed as probed 2026-07-13.
const REF = 2026;

describe('nflReferenceSeason', () => {
  it('rolls to the new season in May, after the late-April draft', () => {
    // Pre-draft: BDL is still counting the season just played.
    expect(nflReferenceSeason(new Date('2027-03-15T00:00:00Z'))).toBe(2026);
    expect(nflReferenceSeason(new Date('2027-04-20T00:00:00Z'))).toBe(2026);
    // Post-draft: the new class exists and BDL counts the new season.
    expect(nflReferenceSeason(new Date('2027-05-02T00:00:00Z'))).toBe(2027);
    expect(nflReferenceSeason(new Date('2026-07-13T00:00:00Z'))).toBe(2026);
    expect(nflReferenceSeason(new Date('2026-12-25T00:00:00Z'))).toBe(2026);
    // January playoffs still belong to the previous season.
    expect(nflReferenceSeason(new Date('2027-01-10T00:00:00Z'))).toBe(2026);
  });
});

describe('nflDraftYearFromExperience — real BDL values', () => {
  it('maps "Rookie" to the current draft class', () => {
    expect(nflDraftYearFromExperience('Rookie', REF)).toBe(2026);
  });

  it('inverts the 2025 first round (all read "2nd Season")', () => {
    // Ward, Hunter, Carter, Jeanty, McMillan, Warren, Hampton — verified.
    expect(nflDraftYearFromExperience('2nd Season', REF)).toBe(2025);
  });

  it('inverts the 2024 first round (all read "3rd Season")', () => {
    // C. Williams, Daniels, Nabers, Bowers — verified.
    expect(nflDraftYearFromExperience('3rd Season', REF)).toBe(2024);
  });

  it('inverts known veterans to their real draft years', () => {
    expect(nflDraftYearFromExperience('10th Season', REF)).toBe(2017); // Mahomes
    expect(nflDraftYearFromExperience('6th Season', REF)).toBe(2021); // Ja'Marr Chase
    expect(nflDraftYearFromExperience('9th Season', REF)).toBe(2018); // Saquon Barkley
    expect(nflDraftYearFromExperience('5th Season', REF)).toBe(2022); // Brock Purdy
    expect(nflDraftYearFromExperience('4th Season', REF)).toBe(2023); // Puka Nacua
    expect(nflDraftYearFromExperience('14th Season', REF)).toBe(2013); // Travis Kelce
    expect(nflDraftYearFromExperience('22nd Season', REF)).toBe(2005); // Aaron Rodgers
  });

  // The bug this file exists to prevent. "1st Season" is NOT a draft class: its
  // 279 players run ages 22–29 (median 25) while the real rookie class runs
  // 20–28 (median 22). It is BDL's label for players with no *accrued* season —
  // camp/practice-squad bodies whose entry year is unknowable. Mapping it to N=1
  // would give all 279 a rookie's draft_year, letting a 29-year-old career
  // practice-squad player onto the taxi squad as a "rookie".
  it('REFUSES "1st Season" — no-accrued-season bucket, not a rookie label', () => {
    expect(nflDraftYearFromExperience('1st Season', REF)).toBeNull();
  });

  it('a "1st Season" player can never reach the taxi squad', () => {
    const unknown = nflDraftYearFromExperience('1st Season', REF);
    // null draft_year → not taxi-eligible at any max-experience setting.
    expect(isTaxiEligible(unknown, '2026', 1)).toBe(false);
    expect(isTaxiEligible(unknown, '2026', 3)).toBe(false);
  });

  it('returns null for missing/garbage values', () => {
    expect(nflDraftYearFromExperience(null, REF)).toBeNull();
    expect(nflDraftYearFromExperience(undefined, REF)).toBeNull();
    expect(nflDraftYearFromExperience('', REF)).toBeNull();
    expect(nflDraftYearFromExperience('Veteran', REF)).toBeNull();
    // Absurd ordinals can't poison the column.
    expect(nflDraftYearFromExperience('99th Season', REF)).toBeNull();
  });
});

// The whole point of deriving draft_year: taxi eligibility for NFL leagues.
// isTaxiEligible computes `parseInt(season) + 1 - draft_year`, so an NFL 2026
// season gives a 2026 rookie exactly 1 year of experience.
describe('taxi eligibility for an NFL 2026 league', () => {
  const draftYearOf = (exp: string) => nflDraftYearFromExperience(exp, REF);

  it('"Rookies Only" (max 1) admits the 2026 class and nobody else', () => {
    expect(isTaxiEligible(draftYearOf('Rookie'), '2026', 1)).toBe(true);
    expect(isTaxiEligible(draftYearOf('2nd Season'), '2026', 1)).toBe(false);
    expect(isTaxiEligible(draftYearOf('10th Season'), '2026', 1)).toBe(false);
  });

  it('a 2-year max admits the 2025 class too', () => {
    expect(isTaxiEligible(draftYearOf('Rookie'), '2026', 2)).toBe(true);
    expect(isTaxiEligible(draftYearOf('2nd Season'), '2026', 2)).toBe(true);
    expect(isTaxiEligible(draftYearOf('3rd Season'), '2026', 2)).toBe(false);
  });
});
