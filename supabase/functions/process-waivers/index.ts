import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { notifyTeams } from './push.ts';

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

Deno.serve(async (req: Request) => {
  const cronSecret = Deno.env.get('CRON_SECRET');
  if (cronSecret) {
    const authHeader = req.headers.get('Authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  const now = new Date();
  const todayDow = now.getDay();
  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  // Step A: Process Standard Waiver Claims (expired waiver periods)
  try {
    const { data: expiredWaivers, error: ewErr } = await supabase
      .from('league_waivers').select('id, league_id, player_id')
      .lte('on_waivers_until', now.toISOString());
    if (ewErr) throw ewErr;

    for (const waiver of expiredWaivers ?? []) {
      const { data: league } = await supabase
        .from('leagues').select('waiver_type, waiver_period_days')
        .eq('id', waiver.league_id).single();

      if (!league || league.waiver_type !== 'standard') {
        await supabase.from('league_waivers').delete().eq('id', waiver.id);
        continue;
      }

      const { data: claims } = await supabase
        .from('waiver_claims').select('*')
        .eq('league_id', waiver.league_id).eq('player_id', waiver.player_id)
        .eq('status', 'pending')
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true });

      let awarded = false;

      for (const claim of claims ?? []) {
        try {
          const rosterOk = await checkAndProcessClaim(claim, waiver.league_id, league.waiver_period_days);
          if (rosterOk) {
            awarded = true;
            await bumpWaiverPriority(waiver.league_id, claim.team_id);

            // Notify winner
            try {
              const { data: pd } = await supabase.from('players').select('name').eq('id', claim.player_id).single();
              await notifyTeams(supabase, [claim.team_id], 'waivers',
                'Waiver Claim Won!',
                `You claimed ${pd?.name ?? 'a player'} off waivers.`,
                { screen: 'roster' }
              );
            } catch (_) {}

            await supabase.from('waiver_claims')
              .update({ status: 'failed', processed_at: now.toISOString() })
              .eq('league_id', waiver.league_id).eq('player_id', waiver.player_id)
              .eq('status', 'pending').neq('id', claim.id);

            // Notify losers
            const failedClaims = (claims ?? []).filter(c => c.id !== claim.id);
            for (const fc of failedClaims) {
              try {
                await notifyTeams(supabase, [fc.team_id], 'waivers',
                  'Waiver Claim Lost',
                  'Your waiver claim was not awarded.',
                  { screen: 'free-agents' }
                );
              } catch (_) {}
            }

            processed++;
            break;
          }
        } catch (err: any) {
          errors.push(`claim ${claim.id}: ${err.message}`);
          await supabase.from('waiver_claims')
            .update({ status: 'failed', processed_at: now.toISOString() })
            .eq('id', claim.id);
          failed++;
        }
      }

      await supabase.from('league_waivers').delete().eq('id', waiver.id);
    }
  } catch (err: any) {
    errors.push(`Step A error: ${err.message}`);
  }

  // Step B: Process FAAB Claims (weekly cycle)
  try {
    const { data: faabLeagues, error: flErr } = await supabase
      .from('leagues').select('id, waiver_day_of_week, waiver_period_days')
      .eq('waiver_type', 'faab');
    if (flErr) throw flErr;

    for (const league of faabLeagues ?? []) {
      if (league.waiver_day_of_week !== todayDow) continue;

      const { data: claims } = await supabase
        .from('waiver_claims').select('*')
        .eq('league_id', league.id).eq('status', 'pending')
        .order('bid_amount', { ascending: false })
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true });

      if (!claims || claims.length === 0) continue;

      const byPlayer = new Map<string, typeof claims>();
      for (const claim of claims) {
        const existing = byPlayer.get(claim.player_id) ?? [];
        existing.push(claim);
        byPlayer.set(claim.player_id, existing);
      }

      const awardedPlayers = new Set<string>();

      for (const [playerId, playerClaims] of byPlayer) {
        let awarded = false;

        for (const claim of playerClaims) {
          if (awardedPlayers.has(playerId)) {
            await supabase.from('waiver_claims')
              .update({ status: 'failed', processed_at: now.toISOString() })
              .eq('id', claim.id);

            try {
              await notifyTeams(supabase, [claim.team_id], 'waivers',
                'FAAB Bid Lost',
                'Your bid was not the highest.',
                { screen: 'free-agents' }
              );
            } catch (_) {}
            failed++;
            continue;
          }

          try {
            const rosterOk = await checkAndProcessClaim(claim, league.id, league.waiver_period_days);
            if (rosterOk) {
              awarded = true;
              awardedPlayers.add(playerId);

              await supabase.rpc('', {}).catch(() => {});
              const { data: wp } = await supabase
                .from('waiver_priority').select('faab_remaining')
                .eq('league_id', league.id).eq('team_id', claim.team_id).single();

              if (wp) {
                await supabase.from('waiver_priority')
                  .update({ faab_remaining: Math.max(0, (wp.faab_remaining ?? 0) - claim.bid_amount) })
                  .eq('league_id', league.id).eq('team_id', claim.team_id);
              }

              // Notify winner
              try {
                const { data: pd } = await supabase.from('players').select('name').eq('id', claim.player_id).single();
                await notifyTeams(supabase, [claim.team_id], 'waivers',
                  'FAAB Bid Won!',
                  `You won ${pd?.name ?? 'a player'} for $${claim.bid_amount}.`,
                  { screen: 'roster' }
                );
              } catch (_) {}

              processed++;
            }
          } catch (err: any) {
            errors.push(`FAAB claim ${claim.id}: ${err.message}`);
            await supabase.from('waiver_claims')
              .update({ status: 'failed', processed_at: now.toISOString() })
              .eq('id', claim.id);
            failed++;
          }
        }

        if (awarded) {
          await supabase.from('waiver_claims')
            .update({ status: 'failed', processed_at: now.toISOString() })
            .eq('league_id', league.id).eq('player_id', playerId).eq('status', 'pending');
        }
      }
    }
  } catch (err: any) {
    errors.push(`Step B error: ${err.message}`);
  }

  // Step C: Cleanup expired league_waivers with no pending claims
  try {
    const { data: staleWaivers } = await supabase
      .from('league_waivers').select('id')
      .lte('on_waivers_until', now.toISOString());
    for (const w of staleWaivers ?? []) {
      await supabase.from('league_waivers').delete().eq('id', w.id);
    }
  } catch (err: any) {
    errors.push(`Cleanup error: ${err.message}`);
  }

  return new Response(
    JSON.stringify({ ok: true, processed, failed, errors }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
});

async function checkAndProcessClaim(claim: any, leagueId: string, waiverPeriodDays: number): Promise<boolean> {
  const now = new Date();

  const { data: existing } = await supabase
    .from('league_players').select('id')
    .eq('league_id', leagueId).eq('player_id', claim.player_id).limit(1);
  if (existing && existing.length > 0) return false;

  const [allRes, irRes, leagueRes] = await Promise.all([
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id),
    supabase.from('league_players').select('id', { count: 'exact', head: true })
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('roster_slot', 'IR'),
    supabase.from('leagues').select('roster_size').eq('id', leagueId).single(),
  ]);

  const activeCount = (allRes.count ?? 0) - (irRes.count ?? 0);
  const maxSize = leagueRes.data?.roster_size ?? 13;
  const rosterFull = activeCount >= maxSize;

  if (rosterFull && !claim.drop_player_id) return false;

  if (rosterFull && claim.drop_player_id) {
    const { error: delErr } = await supabase.from('league_players').delete()
      .eq('league_id', leagueId).eq('team_id', claim.team_id).eq('player_id', claim.drop_player_id);
    if (delErr) throw delErr;

    if (waiverPeriodDays > 0) {
      const until = new Date();
      until.setDate(until.getDate() + waiverPeriodDays);
      await supabase.from('league_waivers').insert({
        league_id: leagueId, player_id: claim.drop_player_id,
        on_waivers_until: until.toISOString(), dropped_by_team_id: claim.team_id,
      });
    }
  }

  const { data: playerData } = await supabase
    .from('players').select('name, position').eq('id', claim.player_id).single();

  const { error: addErr } = await supabase.from('league_players').insert({
    league_id: leagueId, player_id: claim.player_id, team_id: claim.team_id,
    acquired_via: 'waiver', acquired_at: now.toISOString(),
    position: playerData?.position ?? 'UTIL',
  });
  if (addErr) throw addErr;

  let notes = `Claimed ${playerData?.name ?? 'Unknown'} off waivers`;
  if (claim.bid_amount > 0) notes += ` ($${claim.bid_amount})`;

  if (claim.drop_player_id) {
    const { data: dropData } = await supabase.from('players').select('name').eq('id', claim.drop_player_id).single();
    notes += ` (dropped ${dropData?.name ?? 'Unknown'})`;
  }

  const { data: txn } = await supabase
    .from('league_transactions').insert({ league_id: leagueId, type: 'waiver', notes })
    .select('id').single();

  if (txn) {
    const items: any[] = [
      { transaction_id: txn.id, player_id: claim.player_id, team_to_id: claim.team_id },
    ];
    if (claim.drop_player_id) {
      items.push({ transaction_id: txn.id, player_id: claim.drop_player_id, team_from_id: claim.team_id });
    }
    await supabase.from('league_transaction_items').insert(items);
  }

  await supabase.from('waiver_claims')
    .update({ status: 'successful', processed_at: now.toISOString() })
    .eq('id', claim.id);

  return true;
}

async function bumpWaiverPriority(leagueId: string, winningTeamId: string) {
  const { data: allPriorities } = await supabase
    .from('waiver_priority').select('team_id, priority')
    .eq('league_id', leagueId).order('priority', { ascending: true });

  if (!allPriorities || allPriorities.length === 0) return;

  const winnerPriority = allPriorities.find(p => p.team_id === winningTeamId)?.priority;
  if (winnerPriority == null) return;

  for (const p of allPriorities) {
    if (p.team_id === winningTeamId) {
      await supabase.from('waiver_priority')
        .update({ priority: allPriorities.length })
        .eq('league_id', leagueId).eq('team_id', p.team_id);
    } else if (p.priority > winnerPriority) {
      await supabase.from('waiver_priority')
        .update({ priority: p.priority - 1 })
        .eq('league_id', leagueId).eq('team_id', p.team_id);
    }
  }
}
