import { getSeasonStart, type Sport } from "@/constants/LeagueDefaults";
import { getSportToday, getSportTomorrow } from "@/utils/leagueTime";

/**
 * The earliest valid `season_start_date` for a league given an actual draft
 * date. Two rules stack:
 *
 *  1. **Day after the draft slate.** Fantasy scoring can't begin until the
 *     calendar day AFTER picks are made — otherwise games played before the
 *     draft retroactively credit newly-drafted players.
 *  2. **At or after the pro league's opening night.** A draft scheduled
 *     pre-tipoff (e.g. WNBA draft in April, season opens mid-May) can't
 *     push Week 1 into a stretch with zero real games. If the sport's
 *     opening night is still in the future, it floors the candidate. If
 *     we're already mid-season (opening night past), this rule is a no-op.
 *
 * Whatever weekday the result lands on, Week 1 absorbs it — a Thu/Fri/Sat/Sun
 * start produces a 8–11 day Week 1 ending the second Sunday (see
 * {@link week1Length}). No Monday-snapping here.
 */
export function minSeasonStartForDraft(params: {
  sport: Sport | string | null | undefined;
  season: string | null | undefined;
  draftDate: Date;
}): string {
  const { sport, season, draftDate } = params;

  // Rule 1: the slate day immediately after the draft, in the sport's TZ.
  let candidate = getSportTomorrow(sport, draftDate);

  // Rule 2: respect the IRL opening night when it's still ahead of us.
  if (season) {
    const opening = getSeasonStart(sport as Sport, season);
    const today = getSportToday(sport);
    if (opening && opening > today && opening > candidate) {
      candidate = opening;
    }
  }

  return candidate;
}
