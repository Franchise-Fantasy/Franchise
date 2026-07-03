import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * Floor a computed fantasy `season_start_date` at the pro season's opening
 * night. The import functions default the start to "today / next Monday",
 * which is right for a mid-season import but wrong for one executed before
 * tipoff (e.g. importing in July for an October NBA season) — the league
 * would begin with months of gameless weeks. Reads the opening night from
 * `season_config`; an unknown (sport, season) row leaves the input unchanged.
 * Mirrors the client-side floor in utils/league/seasonStart.ts.
 */
export async function floorAtSeasonOpening(
  supabase: SupabaseClient,
  sport: string,
  season: string,
  startDate: string, // YYYY-MM-DD
): Promise<string> {
  const { data } = await supabase
    .from('season_config')
    .select('start_date')
    .eq('sport', sport)
    .eq('season', season)
    .maybeSingle();
  const opening = (data as { start_date: string } | null)?.start_date;
  return opening && opening > startDate ? opening : startDate;
}
