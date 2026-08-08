import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsResponse } from '../_shared/cors.ts';
import { requireUser } from '../_shared/auth.ts';
import { HttpError, handleError, jsonResponse } from '../_shared/http.ts';
import { kickOpenDraftSeason } from '../_shared/openDraftSeason.ts';
import { notifyLeague } from '../_shared/push.ts';
import { checkRateLimit } from '../_shared/rate-limit.ts';
import { shuffle } from '../_shared/shuffle.ts';
import { parseBody, z } from '../_shared/validate.ts';
import { getSportModule } from '../../../utils/sports/registry.ts';

const Body = z.object({
  league_id: z.string().uuid(),
});

/** Sport-aware season string `offset` years after `current`. NBA seasons span
 *  two calendar years ("2025-26" → "2026-27"); WNBA and NFL seasons are
 *  single-year ("2026" → "2027"). Hardcoding NBA format produced "2026-27" for
 *  WNBA leagues, which then didn't match the rest of the app's season-format
 *  expectations. Mirrors `formatSeason` in constants/LeagueDefaults.ts. */
function seasonAtOffset(current: string, sport: string, offset: number): string {
  const startYear = parseInt(current.split('-')[0], 10) + offset;
  if (getSportModule(sport).seasonFormat === 'single-year') return String(startYear);
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}

function nextSeason(current: string, sport: string): string {
  return seasonAtOffset(current, sport, 1);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return corsResponse();

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? ''
    );

    // Auth
    const user = await requireUser(req);

    const rateLimited = await checkRateLimit(supabaseAdmin, user.id, 'advance-season');
    if (rateLimited) return rateLimited;

    const { league_id } = parseBody(Body, await req.json());

    // Fetch league config
    const { data: league, error: leagueErr } = await supabaseAdmin
      .from('leagues')
      .select('created_by, name, sport, season, teams, playoff_teams, playoff_weeks, rookie_draft_order, rookie_draft_rounds, max_future_seasons, lottery_draws, lottery_odds, waiver_type, faab_budget, waiver_priority_reset, offseason_step, league_type, taxi_slots, taxi_max_experience')
      .eq('id', league_id)
      .single();
    if (leagueErr || !league) throw new HttpError('League not found', 404);
    if (league.created_by !== user.id) throw new HttpError('Only the commissioner can advance the season', 403);
    if (league.offseason_step !== null) throw new HttpError('League is already in the offseason', 409);

    // Verify playoffs are complete: a non-bye championship entry must have a winner
    const { data: bracketCheck } = await supabaseAdmin
      .from('playoff_bracket')
      .select('round, winner_id, is_bye, is_third_place')
      .eq('league_id', league_id)
      .eq('season', league.season)
      .order('round', { ascending: false });

    if (!bracketCheck || bracketCheck.length === 0) {
      throw new HttpError('Cannot advance season: no playoff bracket found. Playoffs must be completed first.');
    }
    const finalRound = bracketCheck[0].round;
    const finalRoundEntries = bracketCheck.filter(e => e.round === finalRound);
    const championshipEntry = finalRoundEntries.find(e => !e.is_bye && !e.is_third_place);
    if (!championshipEntry) {
      throw new HttpError('Cannot advance season: no championship matchup found in the final round.');
    }
    if (!championshipEntry.winner_id) {
      throw new HttpError('Cannot advance season: the final playoff round has not been decided yet.');
    }

    const currentSeason = league.season;
    const sport = league.sport ?? 'nba';
    const newSeason = nextSeason(currentSeason, sport);

    // ── 1. Calculate final standings ──
    const { data: allTeams, error: teamsErr } = await supabaseAdmin
      .from('teams')
      .select('id, name, wins, losses, ties, points_for, points_against')
      .eq('league_id', league_id)
      .order('wins', { ascending: false })
      .order('points_for', { ascending: false });
    if (teamsErr || !allTeams) {
      if (teamsErr) throw teamsErr;
      throw new HttpError('Failed to fetch teams');
    }

    // Re-sort by win percentage DESC (handles ties counting as half-win)
    allTeams.sort((a, b) => {
      const gpA = a.wins + a.losses + a.ties;
      const gpB = b.wins + b.losses + b.ties;
      const pctA = gpA === 0 ? 0 : (a.wins + a.ties * 0.5) / gpA;
      const pctB = gpB === 0 ? 0 : (b.wins + b.ties * 0.5) / gpB;
      return pctB - pctA || b.points_for - a.points_for;
    });

    // ── 2. Determine playoff results from bracket ──
    const { data: bracket } = await supabaseAdmin
      .from('playoff_bracket')
      .select('round, team_a_id, team_b_id, winner_id, is_bye, is_third_place')
      .eq('league_id', league_id)
      .eq('season', currentSeason)
      .order('round', { ascending: true });

    const playoffTeamIds = new Set<string>();
    const eliminatedInRound = new Map<string, number>();
    let championId: string | null = null;
    let runnerUpId: string | null = null;
    let thirdPlaceId: string | null = null;
    let fourthPlaceId: string | null = null;
    let maxRound = 0;

    if (bracket && bracket.length > 0) {
      for (const slot of bracket) {
        // Don't count 3rd place game participants in the main bracket tracking
        if (slot.is_third_place) continue;
        if (slot.team_a_id) playoffTeamIds.add(slot.team_a_id);
        if (slot.team_b_id) playoffTeamIds.add(slot.team_b_id);
        if (slot.round > maxRound) maxRound = slot.round;
      }
      // Still track 3rd place participants as playoff teams
      for (const slot of bracket) {
        if (!slot.is_third_place) continue;
        if (slot.team_a_id) playoffTeamIds.add(slot.team_a_id);
        if (slot.team_b_id) playoffTeamIds.add(slot.team_b_id);
      }

      for (const slot of bracket) {
        if (slot.is_bye || !slot.winner_id || slot.is_third_place) continue;
        const loserId = slot.team_a_id === slot.winner_id ? slot.team_b_id : slot.team_a_id;
        if (loserId && !eliminatedInRound.has(loserId)) {
          eliminatedInRound.set(loserId, slot.round);
        }
      }

      // Championship: non-3rd-place entry in final round
      const finalSlots = bracket.filter(s => s.round === maxRound && s.winner_id && !s.is_third_place);
      if (finalSlots.length > 0) {
        championId = finalSlots[0].winner_id;
        const finalSlot = finalSlots[0];
        runnerUpId = finalSlot.team_a_id === championId ? finalSlot.team_b_id : finalSlot.team_a_id;
      }

      // 3rd place winner — and the loser of that game is 4th, not a generic
      // "semifinalist" elimination.
      const thirdPlaceSlot = bracket.find(s => s.is_third_place && s.winner_id);
      if (thirdPlaceSlot) {
        thirdPlaceId = thirdPlaceSlot.winner_id;
        fourthPlaceId = thirdPlaceSlot.team_a_id === thirdPlaceId
          ? thirdPlaceSlot.team_b_id
          : thirdPlaceSlot.team_a_id;
      }
    }

    // ── 3. Insert team_seasons rows ──
    const teamSeasonRows = allTeams.map((t, idx) => {
      let playoffResult = 'missed_playoffs';
      if (t.id === championId) playoffResult = 'champion';
      else if (t.id === runnerUpId) playoffResult = 'runner_up';
      else if (t.id === thirdPlaceId) playoffResult = 'third_place';
      else if (t.id === fourthPlaceId) playoffResult = 'fourth_place';
      else if (playoffTeamIds.has(t.id)) {
        const elimRound = eliminatedInRound.get(t.id);
        if (elimRound != null) playoffResult = `eliminated_round_${elimRound}`;
        else playoffResult = 'playoff_participant';
      }

      return {
        team_id: t.id,
        league_id,
        season: currentSeason,
        team_name: t.name,
        wins: t.wins,
        losses: t.losses,
        ties: t.ties,
        points_for: t.points_for,
        points_against: t.points_against,
        final_standing: idx + 1,
        playoff_result: playoffResult,
      };
    });

    // ── 4. Champion + new-season league fields ──
    const leagueUpdates: Record<string, unknown> = {
      champion_team_id: championId,
      season: newSeason,
      schedule_generated: false,
      lottery_status: 'pending',
      lottery_date: null,
    };

    const teamIds = allTeams.map(t => t.id);

    // ── 5. Waiver priority order for the new season ──
    // 'keep' leaves the end-of-season (rolling) order untouched — signalled to the
    // RPC as null. allTeams is sorted best → worst (see the sort in step 1).
    const resetMode = league.waiver_priority_reset ?? 'reverse_standings';
    const waiverOrder: string[] | null =
      resetMode === 'keep'
        ? null
        : resetMode === 'random'
          ? shuffle(allTeams.map(t => t.id))
          : [...allTeams].reverse().map(t => t.id); // reverse_standings: worst finisher first

    // ── 6. League-type branch: what happens to rosters and rookie picks ──
    const leagueType = league.league_type ?? 'dynasty';
    const isRedraft = leagueType === 'redraft';
    let newPicks: Record<string, unknown>[] = [];
    let pickUpdates: Record<string, unknown>[] = [];

    if (isRedraft) {
      // Rosters + orphan picks are cleared inside the RPC, so the entire
      // offseason is "wait for the next draft" — and that draft can't happen
      // until the incoming rookie class is in the player pool (months away for
      // most sports). Park the league in the dormant step; open-draft-season
      // owns the gate, builds the draft, and flips to 'ready_for_new_season'.
      // It's kicked below so a league already past its gate opens right away.
      leagueUpdates.offseason_step = 'offseason';
    } else if (leagueType === 'keeper') {
      // Players stay on rosters until keepers are declared.
      leagueUpdates.offseason_step = 'keeper_pending';
    } else if (league.rookie_draft_order === 'lottery') {
      leagueUpdates.offseason_step = 'lottery_pending';
    } else {
      const rounds = league.rookie_draft_rounds ?? 2;
      const reversedTeams = [...allTeams].reverse();

      // Next season's picks may not exist yet (e.g. a brand-new league).
      const { data: existingPicks } = await supabaseAdmin
        .from('draft_picks')
        .select('id')
        .eq('league_id', league_id)
        .eq('season', newSeason)
        .is('draft_id', null)
        .limit(1);

      for (let pos = 0; pos < reversedTeams.length; pos++) {
        const team = reversedTeams[pos];
        for (let round = 1; round <= rounds; round++) {
          const pick_number = (round - 1) * reversedTeams.length + (pos + 1);
          if (!existingPicks || existingPicks.length === 0) {
            newPicks.push({
              season: newSeason,
              round,
              slot_number: pos + 1,
              pick_number,
              current_team_id: team.id,
              original_team_id: team.id,
            });
          } else {
            // Slot order keys off the ORIGINATING team's standing — current_team_id
            // may be a trade partner, which would give a traded pick the wrong slot.
            pickUpdates.push({
              round,
              original_team_id: team.id,
              pick_number,
              slot_number: pos + 1,
            });
          }
        }
      }
      leagueUpdates.offseason_step = 'rookie_draft_pending';
    }

    // ── 6b. Roll the tradable pick horizon forward ──
    // `max_future_seasons` means "N rookie drafts ahead of the league's current
    // season are tradable", so the horizon is the inclusive start-year range
    // [newSeason, newSeason + N] — the same range `execute-trade` validates
    // swaps against and the draft hub / trade builder render. It's seeded once
    // at league creation (`buildFutureDraftPicks`, offsets 1..N) and nothing
    // used to extend it, so every rollover shortened it by a year until a
    // long-running dynasty had no future picks left to trade at all.
    //
    // Offsets 1..N only: offset 0 is `newSeason` itself, already owned by the
    // branch above (and by `buildFutureDraftPicks` for the lottery path).
    // Seasons that already have picks are skipped, so this is idempotent and
    // also back-fills a league that rolled over several times before this
    // existed. Dynasty only — it's the one type that trades future picks
    // (`buildFutureDraftPicks` has the same gate at league creation), and
    // redraft's orphan picks are cleared by the RPC anyway.
    const maxFuture = league.max_future_seasons ?? 0;
    if (leagueType === 'dynasty' && maxFuture > 0) {
      const rounds = league.rookie_draft_rounds ?? 2;
      const horizonSeasons = Array.from(
        { length: maxFuture },
        (_, i) => seasonAtOffset(newSeason, league.sport, i + 1),
      );

      // One bounded existence probe per season rather than a single `.in(...)`
      // over all of them: that response scales with teams × rounds × N and
      // would silently truncate at PostgREST's 1000-row cap, which reads as
      // "this season has no picks" and duplicates a whole season.
      const seededFlags = await Promise.all(horizonSeasons.map(async (season) => {
        const { data, error } = await supabaseAdmin
          .from('draft_picks')
          .select('id')
          .eq('league_id', league_id)
          .eq('season', season)
          .limit(1);
        if (error) throw error;
        return (data?.length ?? 0) > 0;
      }));

      for (const [i, season] of horizonSeasons.entries()) {
        if (seededFlags[i]) continue;
        for (const team of allTeams) {
          for (let round = 1; round <= rounds; round++) {
            // A future pick carries no draft position — `slot_number` is a
            // placeholder until the lottery or reverse standings set the order
            // in the season it's actually drafted, and `pick_number` stays null
            // so `formatPickLabel` renders "2031 1st" with no pick number.
            newPicks.push({
              season,
              round,
              slot_number: null,
              pick_number: null,
              current_team_id: team.id,
              original_team_id: team.id,
            });
          }
        }
      }
    }

    // ── 7. Work out which taxi-squad players have aged out ──
    const taxiPromoteIds: string[] = [];
    const taxiTransactions: { team_id: string; notes: string }[] = [];
    if (league.taxi_slots > 0 && league.taxi_max_experience !== null) {
      const { data: taxiPlayers } = await supabaseAdmin
        .from('league_players')
        .select('id, player_id, team_id')
        .eq('league_id', league_id)
        .eq('roster_slot', 'TAXI');

      if (taxiPlayers && taxiPlayers.length > 0) {
        const [{ data: players }, { data: pNames }] = await Promise.all([
          supabaseAdmin.from('players').select('id, draft_year').in('id', taxiPlayers.map(tp => tp.player_id)),
          supabaseAdmin.from('players').select('id, name').in('id', taxiPlayers.map(tp => tp.player_id)),
        ]);
        const draftYearMap = new Map((players ?? []).map(p => [p.id, p.draft_year]));
        const nameMap = new Map((pNames ?? []).map(p => [p.id, p.name]));
        const newYear = parseInt(newSeason.split('-')[0], 10) + 1;

        for (const tp of taxiPlayers) {
          const draftYear = draftYearMap.get(tp.player_id);
          const agedOut = draftYear == null || (newYear - draftYear) > league.taxi_max_experience;
          if (!agedOut) continue;
          taxiPromoteIds.push(tp.id);
          taxiTransactions.push({
            team_id: tp.team_id,
            notes: `${nameMap.get(tp.player_id) ?? 'Unknown'} auto-promoted from taxi squad (aged out)`,
          });
        }
      }
    }

    // ── 8. Apply EVERY write in one transaction ──
    // The season archive, the team-stat reset, the cancellations, the waiver
    // re-seed, the roster/pick changes, and the offseason_step flip all commit
    // together. Previously the reset landed early but the gate (offseason_step)
    // flipped last, so a mid-flow failure left the gate open with the standings
    // already zeroed — and the retry archived that all-zero garbage over the real
    // season and derived the draft order from it.
    const { error: advErr } = await supabaseAdmin.rpc('advance_season_atomic', {
      p_league_id: league_id,
      p_team_seasons: teamSeasonRows,
      p_team_ids: teamIds,
      p_league_updates: leagueUpdates,
      p_faab_budget: league.faab_budget ?? 100,
      p_waiver_order: waiverOrder,
      p_is_redraft: isRedraft,
      p_new_season: newSeason,
      p_new_picks: newPicks,
      p_pick_updates: pickUpdates,
      p_taxi_promote_ids: taxiPromoteIds,
      p_taxi_transactions: taxiTransactions,
    });
    if (advErr) {
      // Lost the race to a concurrent advance (the RPC re-checks the gate).
      if ((advErr as { code?: string }).code === '23505') {
        throw new HttpError('League is already in the offseason', 409);
      }
      throw advErr;
    }

    // Redraft leagues park in the dormant offseason; ask the gate to look at
    // this one now so a league whose rookie class has already landed skips
    // straight to draft season instead of waiting for tomorrow's sweep.
    //
    // Awaited, not deferred: this decides the step the client renders the
    // instant this call returns, and the home screen won't refetch on its own.
    // Deferring would show "Offseason — draft opens <a date already past>"
    // until the user pulled to refresh. Failure is non-fatal — the season HAS
    // advanced, and the daily sweep opens the league.
    if (isRedraft) {
      try {
        await kickOpenDraftSeason(league_id);
      } catch (openErr) {
        console.warn('open-draft-season kick failed (non-fatal):', openErr);
      }
    }

    // ── 14. Notify league ──
    const champName = championId
      ? allTeams.find(t => t.id === championId)?.name ?? 'The champion'
      : 'No champion';
    const ln = league.name ?? 'Your League';

    // A redraft league has no offseason to work through — it goes dormant and
    // wakes up for the draft — so don't announce a process that doesn't exist.
    // "Offseason" is dynasty vocabulary; see utils/league/offseasonState.ts.
    const offseasonLine = isRedraft
      ? `Rosters are cleared and the league is between seasons. It reopens for the ${newSeason} draft once the rookie class is in.`
      : 'The offseason is now underway.';
    const notifTitle = isRedraft
      ? `${ln} — Season Over`
      : `${ln} — Season Over — Offseason Begins!`;

    try {
      await notifyLeague(supabaseAdmin, league_id, 'league_activity',
        notifTitle,
        `${champName} won the ${currentSeason} championship. ${offseasonLine}`,
        { screen: 'home' }
      );
    } catch (notifyErr) {
      console.warn('Push notification failed (non-fatal):', notifyErr);
    }

    // ── 15. Post announcement to league chat ──
    try {
      const { data: leagueChat } = await supabaseAdmin
        .from('chat_conversations')
        .select('id')
        .eq('league_id', league_id)
        .eq('type', 'league')
        .single();
      if (leagueChat) {
        const chatBody = championId
          ? `🏆 ${champName} won the ${currentSeason} championship! ${offseasonLine}`
          : `The ${currentSeason} season is over. ${offseasonLine}`;
        // team_id NULL + type 'announcement': this is a league notice, not a
        // message from the champion. Attributing it to the winning team made
        // it render as that team bragging in their own chat bubble.
        await supabaseAdmin.from('chat_messages').insert({
          conversation_id: leagueChat.id,
          team_id: null,
          content: chatBody,
          type: 'announcement',
          league_id,
        });
      }
    } catch (chatErr) {
      console.warn('Chat announcement failed (non-fatal):', chatErr);
    }

    return jsonResponse({
      message: 'Season advanced successfully',
      previous_season: currentSeason,
      new_season: newSeason,
      champion_team_id: championId,
      offseason_step: leagueUpdates.offseason_step,
    });
  } catch (error) {
    return handleError(error, 'advance-season');
  }
});
