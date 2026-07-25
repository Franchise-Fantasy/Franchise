import { createClient } from "@supabase/supabase-js";

export async function syncSupabase(boards) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set");
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  for (const board of boards) {
    const rows = board.players.map((p) => ({
      player_slug: p.slug,
      draft_year: board.draftYear,
      full_name: p.name,
      position: p.position,
      school: p.school,
      team: p.team ?? null,
      display_rank: p.displayRank,
      consensus_score: p.consensusScore,
      source_ranks: p.sourceRanks,
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertErr } = await supabase
      .from("prospect_rankings")
      .upsert(rows, { onConflict: "player_slug,draft_year" });
    if (upsertErr) throw new Error(`prospect_rankings upsert: ${upsertErr.message}`);

    const history = board.players.map((p) => ({
      player_slug: p.slug,
      draft_year: board.draftYear,
      display_rank: p.displayRank,
      consensus_score: p.consensusScore,
    }));
    const { error: histErr } = await supabase
      .from("rank_history")
      .upsert(history, { onConflict: "player_slug,draft_year,scraped_on" });
    if (histErr) throw new Error(`rank_history upsert: ${histErr.message}`);

    // Players who dropped off every source's board for this year keep their
    // last row in prospect_rankings but stop getting history; the app can
    // filter on updated_at if it ever wants to hide stale entries.
    console.log(`  Supabase: ${rows.length} players synced for ${board.draftYear}`);
  }
}
