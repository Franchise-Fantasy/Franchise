import { supabase } from '@/lib/supabase';

/**
 * The weekly-acquisition-limit window.
 *
 * The window is the league's OWN fantasy week, read from league_schedule —
 * Mon–Sun for basketball, Tue–Mon for NFL. The old inline copies of this math
 * anchored on the calendar Monday (`date_trunc('week')`), which is right for a
 * Sunday-ending basketball week but off by a day for NFL: an add made on Monday
 * — while that fantasy week's Monday-night game is still being played — was
 * billed to the NEXT week's allowance.
 *
 * Falls back to the Monday anchor when no schedule row covers today (a league
 * created before its schedule is generated, or the offseason).
 *
 * The authoritative gate is `roster_add_drop` (same window, server-side); these
 * helpers drive the FA list's "3 of 5 adds used" pill and its pre-add check, so
 * the number a GM sees matches the rule that will actually be applied.
 */
export async function leagueWeekStart(leagueId: string, todayStr: string): Promise<string> {
  const { data } = await supabase
    .from('league_schedule')
    .select('start_date')
    .eq('league_id', leagueId)
    .lte('start_date', todayStr)
    .gte('end_date', todayStr)
    .maybeSingle();

  if (data?.start_date) return data.start_date as string;

  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun; UTC to match DB timestamps
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + mondayOffset),
  );
  return monday.toISOString().split('T')[0];
}

/** Free-agent adds this team has made inside the current fantasy week. Counts
 *  only transactions that actually added a player (an item with a destination
 *  team) — pure drops and trades don't consume the allowance. */
export async function countWeeklyAdds(
  leagueId: string,
  teamId: string,
  todayStr: string,
): Promise<number> {
  const weekStart = await leagueWeekStart(leagueId, todayStr);

  const { count, error } = await supabase
    .from('league_transactions')
    .select('id, league_transaction_items!inner(team_to_id)', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .eq('team_id', teamId)
    .eq('type', 'waiver')
    .not('league_transaction_items.team_to_id', 'is', null)
    .gte('created_at', weekStart + 'T00:00:00');
  if (error) throw error;
  return count ?? 0;
}
