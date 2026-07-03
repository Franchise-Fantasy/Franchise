import { useQuery } from '@tanstack/react-query';

import {
  formatSeason,
  getCurrentSeason,
  isRookieDraftComplete,
  parseSeasonStartYear,
  rookieDraftStartOffset,
  type Sport,
} from '@/constants/LeagueDefaults';
import { queryKeys } from '@/constants/queryKeys';
import { supabase } from '@/lib/supabase';

export interface DraftHubPick {
  id: string;
  season: string;
  round: number;
  slot_number: number | null;
  /** Position within the round to DISPLAY. Derived from archived standings
   *  pre-lottery, or from slot_number post-lottery. Always trust this over
   *  the raw slot_number field for UI — the DB value can be stale. */
  display_slot: number;
  current_team_id: string;
  original_team_id: string;
  current_team_name: string;
  original_team_name: string;
  isTraded: boolean;
  protection_threshold: number | null;
  protection_owner_id: string | null;
  protection_owner_name: string | null;
  // Set by simulation resolution
  wasProtected?: boolean;
  wasConveyed?: boolean;
  wasSwapped?: boolean;
}

export interface DraftHubSwap {
  id: string;
  season: string;
  round: number;
  beneficiary_team_id: string;
  counterparty_team_id: string;
  beneficiary_team_name: string;
  counterparty_team_name: string;
}

export interface DraftHubTeam {
  id: string;
  name: string;
  tricode: string | null;
  logo_key: string | null;
  wins: number;
  losses: number;
  points_for: number;
}

export interface DraftHubLeagueSettings {
  playoffTeams: number;
  lotteryDraws: number;
  lotteryOdds: number[] | null;
  rookieDraftRounds: number;
  pickConditionsEnabled: boolean;
  leagueFull: boolean;
  lotteryComplete: boolean;
  lotteryDrawn: boolean;
  rookieDraftComplete: boolean;
  inOffseason: boolean;
}

export interface DraftHubData {
  picks: DraftHubPick[];
  swaps: DraftHubSwap[];
  teams: DraftHubTeam[];
  validSeasons: string[];
  leagueSettings: DraftHubLeagueSettings;
}

export function useDraftHub(leagueId: string | null) {
  return useQuery({
    queryKey: queryKeys.draftHub(leagueId!),
    queryFn: async (): Promise<DraftHubData> => {
      const { data: league, error: leagueError } = await supabase
        .from('leagues')
        .select('max_future_seasons, playoff_teams, lottery_draws, lottery_odds, rookie_draft_rounds, season, sport, pick_conditions_enabled, teams, current_teams, lottery_status, offseason_step')
        .eq('id', leagueId!)
        .single();
      if (leagueError) throw leagueError;

      const sport = (league?.sport as Sport | null) ?? 'nba';

      const offseasonStep = league?.offseason_step as string | null;
      const inOffseason = offseasonStep != null;
      // FINALIZED: the commissioner pressed "Done" (create-rookie-draft applied
      // the staged resolution). Only then do we show the resolved draft order —
      // during `lottery_revealing` the picks are still pre-lottery (the result
      // is staged, not committed). NOTE: deliberately NOT keyed on
      // `lottery_status === 'complete'`, which flips at draw time.
      const lotteryComplete =
        offseasonStep === 'lottery_complete' ||
        offseasonStep === 'rookie_draft_pending' ||
        offseasonStep === 'rookie_draft_complete' ||
        offseasonStep === 'ready_for_new_season';
      // DRAWN: the RNG has run (results staged). Used to hide the Simulate
      // button during the reveal, before the result is committed.
      const lotteryDrawn =
        lotteryComplete ||
        league?.lottery_status === 'complete' ||
        offseasonStep === 'lottery_revealing';
      const rookieDraftComplete = isRookieDraftComplete(offseasonStep);

      const maxFuture = league?.max_future_seasons ?? 3;
      const currentStartYear = parseSeasonStartYear(league?.season ?? getCurrentSeason(sport));

      // Future rookie drafts: NBA 2026 draft = '2026-27' season, etc.
      // WNBA seasons are single-year ('2027', '2028').
      //
      // During the regular season `league.season` is the active *playing*
      // season, so the next rookie draft is offset +1. But `advance-season`
      // flips `league.season` to the new season at the START of the offseason,
      // and the upcoming rookie draft (the one the lottery seeds via
      // `start-lottery`/`run-lottery`, both keyed on `league.season`) is for
      // `league.season` ITSELF — offset 0. Until that draft completes we must
      // start the window at offset 0 so its picks AND the lottery results stay
      // visible; otherwise they fall outside the `.in('season', validSeasons)`
      // filter and disappear, and the hub appears to jump a year ahead. The
      // two windows cover the same absolute seasons across the boundary because
      // `league.season` incremented while the start offset decremented.
      const startOffset = rookieDraftStartOffset(offseasonStep);
      const validSeasons: string[] = [];
      for (let i = 0; i < maxFuture; i++) {
        validSeasons.push(formatSeason(currentStartYear + startOffset + i, sport));
      }

      const rookieDraftRounds = league?.rookie_draft_rounds ?? 2;

      const { data: picks, error: picksError } = await supabase
        .from('draft_picks')
        .select('id, season, round, slot_number, current_team_id, original_team_id, player_id, protection_threshold, protection_owner_id')
        .eq('league_id', leagueId!)
        .is('player_id', null)
        .in('season', validSeasons)
        .lte('round', rookieDraftRounds)
        .order('season', { ascending: true })
        .order('round', { ascending: true })
        .order('slot_number', { ascending: true });
      if (picksError) throw picksError;

      // Fetch unresolved pick swaps
      const { data: swapRows, error: swapsError } = await supabase
        .from('pick_swaps')
        .select('id, season, round, beneficiary_team_id, counterparty_team_id')
        .eq('league_id', leagueId!)
        .eq('resolved', false);
      if (swapsError) throw swapsError;

      const { data: liveTeams, error: teamsError } = await supabase
        .from('teams')
        .select('id, name, tricode, logo_key, wins, losses, points_for')
        .eq('league_id', leagueId!)
        .order('wins', { ascending: false })
        .order('points_for', { ascending: false });
      if (teamsError) throw teamsError;

      // During offseason the live teams table has been reset to 0-0, so the
      // "standings" it returns are meaningless. Overlay records from the most
      // recent archived team_seasons rows so the draft hub shows the standings
      // that the lottery / draft order is derived from.
      let teams = liveTeams ?? [];
      if (inOffseason && !rookieDraftComplete && teams.length > 0) {
        const { data: archived } = await supabase
          .from('team_seasons')
          .select('team_id, wins, losses, points_for, final_standing, season')
          .eq('league_id', leagueId!)
          .order('season', { ascending: false });
        if (archived && archived.length > 0) {
          const latestSeason = archived[0].season;
          const latestRows = archived.filter((r) => r.season === latestSeason);
          const statMap = new Map(latestRows.map((r) => [r.team_id, r]));
          teams = teams
            .map((t) => {
              const archivedStats = statMap.get(t.id);
              return archivedStats
                ? {
                    ...t,
                    wins: archivedStats.wins ?? 0,
                    losses: archivedStats.losses ?? 0,
                    points_for: Number(archivedStats.points_for ?? 0),
                    _finalStanding: archivedStats.final_standing ?? null,
                  }
                : { ...t, _finalStanding: null };
            })
            .sort((a: any, b: any) => {
              if (a._finalStanding != null && b._finalStanding != null) {
                return a._finalStanding - b._finalStanding;
              }
              if (b.wins !== a.wins) return b.wins - a.wins;
              return b.points_for - a.points_for;
            })
            .map(({ _finalStanding, ...rest }: any) => rest);
        }
      }

      const nameMap: Record<string, string> = {};
      for (const t of teams ?? []) {
        nameMap[t.id] = t.name;
      }

      // Reverse-standings index: worst team → 0, next-worst → 1, ...
      // Keys off `teams` which is already sorted best-first (by archived
      // final_standing during offseason, by live record otherwise).
      const reverseStandingIndex: Record<string, number> = {};
      for (let i = 0; i < teams.length; i++) {
        reverseStandingIndex[teams[i].id] = teams.length - 1 - i;
      }

      const mappedPicks: DraftHubPick[] = (picks ?? []).map((p) => {
        const currentId = p.current_team_id ?? '';
        const originalId = p.original_team_id ?? '';
        // Pre-lottery: derive slot from the ORIGINATING team's reverse
        // standings position. Post-lottery: trust the stored slot_number
        // (it reflects the actual lottery draw result).
        const derivedFromStandings = (reverseStandingIndex[originalId] ?? 0) + 1;
        const displaySlot = lotteryComplete
          ? (p.slot_number ?? derivedFromStandings)
          : derivedFromStandings;

        return {
          id: p.id,
          season: p.season,
          round: p.round,
          slot_number: p.slot_number,
          display_slot: displaySlot,
          current_team_id: currentId,
          original_team_id: originalId,
          current_team_name: nameMap[currentId] ?? 'Unknown',
          original_team_name: nameMap[originalId] ?? 'Unknown',
          isTraded: currentId !== originalId,
          protection_threshold: p.protection_threshold ?? null,
          protection_owner_id: p.protection_owner_id ?? null,
          protection_owner_name: p.protection_owner_id ? (nameMap[p.protection_owner_id] ?? null) : null,
        };
      });

      const mappedSwaps: DraftHubSwap[] = (swapRows ?? []).map((s) => ({
        id: s.id,
        season: s.season,
        round: s.round,
        beneficiary_team_id: s.beneficiary_team_id,
        counterparty_team_id: s.counterparty_team_id,
        beneficiary_team_name: nameMap[s.beneficiary_team_id] ?? 'Unknown',
        counterparty_team_name: nameMap[s.counterparty_team_id] ?? 'Unknown',
      }));

      return {
        picks: mappedPicks,
        swaps: mappedSwaps,
        teams: (teams ?? []) as DraftHubTeam[],
        validSeasons,
        leagueSettings: {
          playoffTeams: league?.playoff_teams ?? 4,
          lotteryDraws: league?.lottery_draws ?? 4,
          lotteryOdds: (league?.lottery_odds as number[] | null) ?? null,
          rookieDraftRounds: league?.rookie_draft_rounds ?? 2,
          pickConditionsEnabled: league?.pick_conditions_enabled ?? false,
          leagueFull: (league?.current_teams ?? 0) >= (league?.teams ?? 0),
          lotteryComplete,
          lotteryDrawn,
          rookieDraftComplete,
          inOffseason,
        },
      };
    },
    enabled: !!leagueId,
    staleTime: 1000 * 60 * 5,
  });
}
