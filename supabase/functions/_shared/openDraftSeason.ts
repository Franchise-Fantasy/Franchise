/**
 * Nudge `open-draft-season` for a single league.
 *
 * A redraft/keeper league always lands in the dormant `offseason` step, because
 * whether its rookie class has arrived is a date question the gate owns — not
 * something advance-season / finalize-keepers should each re-derive. This asks
 * the gate to look at one league right away, so a league whose gate is already
 * in the past opens immediately instead of waiting for the next daily sweep.
 *
 * Best-effort by design: if it fails, the cron opens the league on its next
 * run. Callers should hand it to `deferWork` rather than await it.
 */
export async function kickOpenDraftSeason(leagueId: string): Promise<void> {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SB_SECRET_KEY') ?? '';
  if (!url || !key) return;

  const res = await fetch(`${url}/functions/v1/open-draft-season`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ league_id: leagueId }),
  });

  if (!res.ok) {
    console.warn(`[open-draft-season] kick for ${leagueId} returned ${res.status}`);
  }
}
