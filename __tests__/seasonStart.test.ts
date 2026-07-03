import { earliestSeasonStart, minSeasonStartForDraft } from "@/utils/league/seasonStart";

describe("minSeasonStartForDraft", () => {
  // WNBA_SEASON_START['2026'] = '2026-05-15' (Friday, past relative to now)
  // June 2026: 06-01 Mon, 06-04 Thu, 06-08 Mon

  it("when mid-season, uses the slate day after the draft", () => {
    // Draft Sun 2026-05-31 → tomorrow = Mon 2026-06-01
    const result = minSeasonStartForDraft({
      sport: "wnba",
      season: "2026",
      draftDate: new Date("2026-05-31T20:00:00Z"),
    });
    expect(result).toBe("2026-06-01");
  });

  it("returns draft+1 even when it lands on a Thu/Fri/Sat/Sun (Week 1 absorbs the leading days)", () => {
    // Draft Wed 2026-06-03 → tomorrow = Thu 2026-06-04. NO Monday roll —
    // Week 1 just becomes an 11-day long week ending Sun Jun 14.
    const result = minSeasonStartForDraft({
      sport: "wnba",
      season: "2026",
      draftDate: new Date("2026-06-03T20:00:00Z"),
    });
    expect(result).toBe("2026-06-04");
  });

  it("when draft is pre-tipoff, floors at the IRL opening night", () => {
    // WNBA 2027 opens 2027-05-15 (hardcoded). Draft scheduled 2027-04-01 →
    // the floor is opening night, regardless of its weekday — Week 1 just
    // becomes a long week if it lands on Thu-Sun.
    const result = minSeasonStartForDraft({
      sport: "wnba",
      season: "2027",
      draftDate: new Date("2027-04-01T20:00:00Z"),
    });
    expect(result).toBe("2027-05-15");
  });

  it("does not float forward when IRL opening is already past", () => {
    // Today is 2026-05-31. WNBA 2026 opened 2026-05-15 (past). Draft Wed
    // 2026-06-03 → tomorrow = Thu 2026-06-04. IRL opening doesn't apply.
    const result = minSeasonStartForDraft({
      sport: "wnba",
      season: "2026",
      draftDate: new Date("2026-06-03T20:00:00Z"),
    });
    expect(result).toBe("2026-06-04");
  });

  it("handles a missing season gracefully (only the draft+1 rule applies)", () => {
    const result = minSeasonStartForDraft({
      sport: "nba",
      season: null,
      draftDate: new Date("2026-06-03T20:00:00Z"),
    });
    expect(result).toBe("2026-06-04");
  });
});

describe("earliestSeasonStart", () => {
  it("floors at the pro season's opening night before tipoff", () => {
    // Creating an NBA 2026-27 league in July: opening night is 2026-10-20,
    // so the season can't start on "tomorrow" months before real games.
    const result = earliestSeasonStart("nba", "2026-27", new Date("2026-07-02T16:00:00Z"));
    expect(result).toBe("2026-10-20");
  });

  it("returns tomorrow once the season is underway", () => {
    const result = earliestSeasonStart("nba", "2026-27", new Date("2027-01-15T17:00:00Z"));
    expect(result).toBe("2027-01-16");
  });

  it("returns tomorrow when the season has no known opening date", () => {
    const result = earliestSeasonStart("nba", null, new Date("2026-07-02T16:00:00Z"));
    expect(result).toBe("2026-07-03");
  });
});
