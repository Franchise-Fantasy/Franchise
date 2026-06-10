import { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * The set of soft-deleted (archived) league ids.
 *
 * Crons run with the service role and so BYPASS the `leagues` RLS policy that
 * hides archived leagues from clients. Without an explicit check a cron keeps
 * scoring, notifying, advancing seasons, and starting drafts for a league that
 * has been removed from every user's app — sending pushes nobody can act on and
 * churning data nobody can see. Each per-league cron fetches this set once and
 * skips any league in it. Archived leagues are rare, so the set is tiny.
 */
export async function getArchivedLeagueIds(supabase: SupabaseClient): Promise<Set<string>> {
  const { data } = await supabase
    .from('leagues')
    .select('id')
    .not('archived_at', 'is', null);
  return new Set((data ?? []).map((l: { id: string }) => l.id));
}
