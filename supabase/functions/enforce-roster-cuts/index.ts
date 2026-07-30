import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { deferWork } from '../_shared/background.ts';
import { recordHeartbeat } from '../_shared/heartbeat.ts';
import { errorResponse, handleError, jsonResponse } from '../_shared/http.ts';
import { notifyTeamsBulk, type BulkTeamsNotification } from '../_shared/push.ts';
import {
  computeCutsPlan,
  fetchLeagueCutsInputs,
  formatDeadline,
} from '../_shared/rosterCuts.ts';
import { getSportToday } from '../../../utils/leagueTime.ts';
import { daysBetweenIsoDates } from '../../../utils/roster/rosterCutsShared.ts';
import type { Database } from '../../../types/database.types.ts';

/**
 * Roster-cuts enforcement. The WHY and the ordering rules live in
 * utils/roster/rosterCutsShared.ts — this is the driver.
 *
 * `leagues.roster_cuts_deadline` is the DEFINITIVE cutoff and the ONLY thing
 * that cuts a player. Nothing else may: the commissioner is never blocked from
 * starting the season with over-cap rosters, and starting it doesn't cut anyone
 * early. The deadline therefore survives into the regular season, and this cron
 * honours it whether the league is still in the offseason or already playing —
 * which is why enforce_team_roster_cuts snapshots the scoring week and routes
 * cut players through waivers (see 20260730000200).
 *
 * Cron-only (Bearer CRON_SECRET), daily at 10:25 UTC: warns at T-3 and on the
 * deadline day, enforces the morning after. enforce_team_roster_cuts applies one
 * team per transaction and is self-limiting, so a racing GM move is harmless.
 *
 * Deploy with --no-verify-jwt.
 */

const JOB_NAME = 'enforce-roster-cuts';


function nameList(names: string[], max = 3): string {
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')}, +${names.length - max} more`;
}

interface EnforcedTeam {
  teamId: string;
  teamName: string;
  stashed: string[];
  dropped: string[];
}

/**
 * Plan and apply cuts for every over-cap team in one league.
 *
 * Returns the teams actually changed plus any that couldn't be resolved. A
 * `plan_stale` rejection means the roster moved under us, so that team is
 * replanned from fresh data and retried exactly once.
 */
async function enforceLeague(
  supabase: ReturnType<typeof createClient<Database>>,
  leagueId: string,
  notes: string,
): Promise<{ enforced: EnforcedTeam[]; failedTeams: string[]; leagueName: string }> {
  const inputs = await fetchLeagueCutsInputs(supabase, leagueId);
  const enforced: EnforcedTeam[] = [];
  const failedTeams: string[] = [];

  for (const team of inputs.teams) {
    let plan = computeCutsPlan(team.roster, inputs.config);
    if (plan.overBy === 0) continue;
    let roster = team.roster;

    for (let attempt = 0; attempt < 2; attempt++) {
      const { data, error } = await supabase.rpc('enforce_team_roster_cuts', {
        p_league_id: leagueId,
        p_team_id: team.teamId,
        p_to_taxi: plan.toTaxi.map((p) => p.player_id),
        p_to_drop: plan.toDrop.map((p) => p.player_id),
        p_notes: notes,
      });

      if (!error) {
        const result = data as { applied?: boolean; stashed?: string[]; dropped?: string[] } | null;
        if (result?.applied) {
          const nameOf = (id: string) =>
            roster.find((r) => r.player_id === id)?.name ?? 'A player';
          enforced.push({
            teamId: team.teamId,
            teamName: team.teamName,
            stashed: (result.stashed ?? []).map(nameOf),
            dropped: (result.dropped ?? []).map(nameOf),
          });
        }
        break;
      }

      const isStale = (error.message ?? '').includes('plan_stale');
      if (!isStale || attempt === 1) {
        console.error(`${JOB_NAME}: team ${team.teamId} failed:`, error.message);
        failedTeams.push(team.teamName);
        break;
      }

      // Replan from fresh data — a GM edited the roster mid-run.
      const fresh = await fetchLeagueCutsInputs(supabase, leagueId);
      const freshTeam = fresh.teams.find((t) => t.teamId === team.teamId);
      if (!freshTeam) {
        failedTeams.push(team.teamName);
        break;
      }
      roster = freshTeam.roster;
      plan = computeCutsPlan(freshTeam.roster, fresh.config);
      if (plan.overBy === 0) break;
    }
  }

  return { enforced, failedTeams, leagueName: inputs.leagueName };
}

function appliedNotifications(
  leagueName: string,
  enforced: EnforcedTeam[],
): BulkTeamsNotification[] {
  return enforced.map((t) => {
    const parts: string[] = [];
    if (t.stashed.length > 0) parts.push(`Moved to taxi: ${t.stashed.join(', ')}.`);
    if (t.dropped.length > 0) parts.push(`Dropped: ${t.dropped.join(', ')}.`);
    parts.push('Your roster is back at the cap.');
    return {
      teamIds: [t.teamId],
      title: `${leagueName} — Roster Cuts Applied`,
      body: parts.join(' '),
      data: { screen: 'roster' },
    };
  });
}

/**
 * Pre-deadline nudges for a league's over-cap teams.
 *
 * T-3 and the deadline day only. Enforcement runs the morning AFTER the deadline
 * day, so day-of is the genuine last call — a T-1 warning on top would mean
 * buzzing on two consecutive mornings.
 */
async function warningNotifications(
  supabase: ReturnType<typeof createClient<Database>>,
  leagueId: string,
  deadline: string,
  daysLeft: number,
): Promise<BulkTeamsNotification[]> {
  const inputs = await fetchLeagueCutsInputs(supabase, leagueId);
  const out: BulkTeamsNotification[] = [];

  for (const team of inputs.teams) {
    const plan = computeCutsPlan(team.roster, inputs.config);
    if (plan.overBy === 0) continue;

    if (daysLeft === 0) {
      out.push({
        teamIds: [team.teamId],
        title: `${inputs.leagueName} — Roster Cuts Due Today`,
        body: `Last day: you're ${plan.overBy} over the cap. At risk: ${nameList([...plan.toTaxi, ...plan.toDrop].map((p) => p.name))}. Automatic cuts run tomorrow morning.`,
        data: { screen: 'roster' },
      });
      continue;
    }

    const noun = plan.overBy === 1 ? 'player' : 'players';
    out.push({
      teamIds: [team.teamId],
      title: `${inputs.leagueName} — Roster Cuts Due Soon`,
      body: `Your active roster is ${plan.activeCount}/${plan.rosterSize}. Stash or drop ${plan.overBy} ${noun} by the end of ${formatDeadline(deadline)} or your newest additions will be cut automatically.`,
      data: { screen: 'roster' },
    });
  }

  return out;
}

Deno.serve(async (req) => {
  try {
    const cronSecret = Deno.env.get('CRON_SECRET') ?? '';
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      return errorResponse('Unauthorized', 401);
    }

    const supabaseAdmin = createClient<Database>(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SB_SECRET_KEY') ?? '',
    );

    // Every league carrying a deadline, in-season or not — the deadline is the
    // cutoff regardless of whether the commissioner has already started the
    // season. Service role bypasses the leagues RLS that hides archived
    // leagues, so filter those or we'd cut rosters nobody can see.
    const { data: leagues, error } = await supabaseAdmin
      .from('leagues')
      .select('id, name, sport, roster_cuts_deadline')
      .not('roster_cuts_deadline', 'is', null)
      .is('archived_at', null);
    if (error) throw error;

    let warnedLeagues = 0;
    let enforcedLeagues = 0;
    let failedLeagues = 0;
    const warnings: BulkTeamsNotification[] = [];
    const applied: BulkTeamsNotification[] = [];

    for (const league of leagues ?? []) {
      const deadline = league.roster_cuts_deadline;
      if (!deadline) continue;

      try {
        const today = getSportToday(league.sport);
        const daysLeft = daysBetweenIsoDates(today, deadline);

        if (daysLeft === 3 || daysLeft === 0) {
          warnings.push(
            ...(await warningNotifications(supabaseAdmin, league.id, deadline, daysLeft)),
          );
          warnedLeagues++;
          continue;
        }

        if (daysLeft > 0) continue; // deadline still ahead

        const { enforced, failedTeams, leagueName } = await enforceLeague(
          supabaseAdmin,
          league.id,
          'Roster cuts deadline passed',
        );

        if (failedTeams.length > 0) {
          // Leave the deadline armed so tomorrow's run retries.
          failedLeagues++;
          continue;
        }

        // One-shot: the deadline has done its job, so clear it. Without this a
        // later commissioner force_add (or a trade that puts a team back over
        // cap) would be silently cut the next morning by a deadline everyone
        // has forgotten about.
        const { error: clearErr } = await supabaseAdmin
          .from('leagues')
          .update({ roster_cuts_deadline: null })
          .eq('id', league.id);
        if (clearErr) throw clearErr;

        enforcedLeagues++;
        if (enforced.length > 0) {
          applied.push(...appliedNotifications(leagueName, enforced));
        }
      } catch (err) {
        failedLeagues++;
        console.error(`${JOB_NAME}: league ${league.id} failed:`, err);
      }
    }

    const pushes = [...warnings, ...applied];
    if (pushes.length > 0) {
      deferWork(
        notifyTeamsBulk(supabaseAdmin, 'commissioner', pushes),
        `${JOB_NAME} cron push`,
      );
    }

    await recordHeartbeat(
      supabaseAdmin,
      JOB_NAME,
      failedLeagues > 0 ? 'error' : 'ok',
      failedLeagues > 0 ? `${failedLeagues} league(s) failed` : undefined,
    );

    return jsonResponse({
      checked: leagues?.length ?? 0,
      warned: warnedLeagues,
      enforced: enforcedLeagues,
      failed: failedLeagues,
    });
  } catch (error) {
    return handleError(error, JOB_NAME);
  }
});
