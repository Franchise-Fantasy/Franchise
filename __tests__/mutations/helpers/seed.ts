import { adminClient } from './clients';

export interface ProposalSeed {
  proposalId: string;
  fromTeamId: string;
  toTeamId: string;
  fromPlayerId: string;
  toPlayerId: string;
}

export interface TradeItemSpec {
  fromTeamId: string;
  toTeamId: string;
  playerId?: string;
  draftPickId?: string;
  protectionThreshold?: number;
}

/**
 * Generic accepted-trade factory. Accepts any combination of player and pick
 * items across any number of teams. Creates the proposal, items, and a
 * trade_proposal_teams row (status='accepted') for every participating team.
 */
export async function createAcceptedTrade(opts: {
  leagueId: string;
  proposedByTeamId: string;
  items: TradeItemSpec[];
}): Promise<{ proposalId: string; participantTeamIds: string[] }> {
  const admin = adminClient();
  const now = new Date().toISOString();

  const { data: proposal, error: pErr } = await admin
    .from('trade_proposals')
    .insert({
      league_id: opts.leagueId,
      proposed_by_team_id: opts.proposedByTeamId,
      status: 'accepted',
      accepted_at: now,
    })
    .select('id')
    .single();
  if (pErr || !proposal) throw new Error(`Create proposal failed: ${pErr?.message}`);

  const itemRows = opts.items.map((i) => ({
    proposal_id: proposal.id,
    from_team_id: i.fromTeamId,
    to_team_id: i.toTeamId,
    player_id: i.playerId ?? null,
    draft_pick_id: i.draftPickId ?? null,
    protection_threshold: i.protectionThreshold ?? null,
  }));
  const { error: itemsErr } = await admin.from('trade_proposal_items').insert(itemRows);
  if (itemsErr) throw new Error(`Create proposal items failed: ${itemsErr.message}`);

  const participantSet = new Set<string>();
  for (const i of opts.items) {
    participantSet.add(i.fromTeamId);
    participantSet.add(i.toTeamId);
  }
  const participants = Array.from(participantSet);
  const teamRows = participants.map((tid) => ({
    proposal_id: proposal.id,
    team_id: tid,
    status: 'accepted',
    responded_at: now,
  }));
  const { error: teamsErr } = await admin.from('trade_proposal_teams').insert(teamRows);
  if (teamsErr) throw new Error(`Create proposal teams failed: ${teamsErr.message}`);

  return { proposalId: proposal.id, participantTeamIds: participants };
}

/**
 * 1-for-1 convenience wrapper around createAcceptedTrade.
 */
export async function createAcceptedOneForOneTrade(
  leagueId: string,
  fromTeamId: string,
  toTeamId: string,
  fromPlayerId: string,
  toPlayerId: string,
): Promise<ProposalSeed> {
  const { proposalId } = await createAcceptedTrade({
    leagueId,
    proposedByTeamId: fromTeamId,
    items: [
      { fromTeamId, toTeamId, playerId: fromPlayerId },
      { fromTeamId: toTeamId, toTeamId: fromTeamId, playerId: toPlayerId },
    ],
  });
  return { proposalId, fromTeamId, toTeamId, fromPlayerId, toPlayerId };
}

/**
 * Idempotent seed of draft_picks for the test league — 1 pick per team per
 * (season, round). If any picks already exist for the league, this is a no-op.
 */
export async function ensureDraftPicks(opts: {
  leagueId: string;
  teamIds: string[];
  seasons?: string[];
  rounds?: number;
}): Promise<void> {
  const admin = adminClient();
  const { count } = await admin
    .from('draft_picks')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', opts.leagueId);
  if ((count ?? 0) > 0) return;

  const seasons = opts.seasons ?? ['2027-28', '2028-29'];
  const rounds = opts.rounds ?? 2;
  const rows: any[] = [];
  for (const season of seasons) {
    for (let round = 1; round <= rounds; round++) {
      opts.teamIds.forEach((tid, slotIdx) => {
        rows.push({
          league_id: opts.leagueId,
          season,
          round,
          original_team_id: tid,
          current_team_id: tid,
          slot_number: slotIdx + 1,
        });
      });
    }
  }
  const { error } = await admin.from('draft_picks').insert(rows);
  if (error) throw new Error(`Seed draft picks failed: ${error.message}`);
}

export async function restoreDraftPickOwnership(leagueId: string): Promise<void> {
  const admin = adminClient();
  const { data: picks } = await admin
    .from('draft_picks')
    .select('id, original_team_id, current_team_id')
    .eq('league_id', leagueId)
    .is('player_id', null); // only reset unselected picks
  const toReset = (picks ?? []).filter((p) => p.current_team_id !== p.original_team_id);
  for (const p of toReset) {
    await admin
      .from('draft_picks')
      .update({ current_team_id: p.original_team_id })
      .eq('id', p.id);
  }
}

export async function getPickCurrentOwner(pickId: string): Promise<string | null> {
  const admin = adminClient();
  const { data } = await admin.from('draft_picks').select('current_team_id').eq('id', pickId).single();
  return data?.current_team_id ?? null;
}

export async function setLeagueRosterSize(leagueId: string, size: number): Promise<number> {
  const admin = adminClient();
  const { data: before } = await admin
    .from('leagues')
    .select('roster_size')
    .eq('id', leagueId)
    .single();
  await admin.from('leagues').update({ roster_size: size }).eq('id', leagueId);
  return before!.roster_size;
}

export async function setTeamDrops(
  proposalId: string,
  teamId: string,
  dropPlayerIds: string[],
): Promise<void> {
  const admin = adminClient();
  const { error } = await admin
    .from('trade_proposal_teams')
    .update({ drop_player_ids: dropPlayerIds })
    .eq('proposal_id', proposalId)
    .eq('team_id', teamId);
  if (error) throw new Error(`Set team drops failed: ${error.message}`);
}

export async function getProposalStatus(proposalId: string): Promise<string | null> {
  const admin = adminClient();
  const { data } = await admin.from('trade_proposals').select('status').eq('id', proposalId).single();
  return data?.status ?? null;
}

/**
 * Idempotent: ensure an active initial-type draft exists for the league with
 * picks assigned in the order teams are provided (standard, not snake).
 * Creates draft_picks with contiguous pick_numbers starting at 1, draft_id
 * linked, and draft_team_status rows per team.
 *
 * Returns the draft id + ordered pick metadata.
 */
export async function ensureActiveDraft(opts: {
  leagueId: string;
  season: string;
  teamIdsInPickOrder: string[];
  rounds?: number;
}): Promise<{ draftId: string; picks: { pickNumber: number; teamId: string; pickId: string }[] }> {
  const admin = adminClient();
  const rounds = opts.rounds ?? 2;
  const picksPerRound = opts.teamIdsInPickOrder.length;

  // Look for an existing active draft for this season
  const { data: existing } = await admin
    .from('drafts')
    .select('id')
    .eq('league_id', opts.leagueId)
    .eq('season', opts.season)
    .eq('type', 'initial')
    .maybeSingle();

  let draftId: string;
  if (existing) {
    draftId = existing.id;
    await admin
      .from('drafts')
      .update({ status: 'in_progress', current_pick_number: 1, rounds, picks_per_round: picksPerRound })
      .eq('id', draftId);
  } else {
    const { data: created, error } = await admin
      .from('drafts')
      .insert({
        league_id: opts.leagueId,
        season: opts.season,
        type: 'initial',
        draft_type: 'linear',
        status: 'in_progress',
        current_pick_number: 1,
        rounds,
        picks_per_round: picksPerRound,
        time_limit: 60,
      })
      .select('id')
      .single();
    if (error || !created) throw new Error(`Create draft failed: ${error?.message}`);
    draftId = created.id;
  }

  // Clear any existing picks for this draft so we always re-seed cleanly.
  await admin.from('draft_picks').delete().eq('draft_id', draftId);

  // Create picks in standard order, contiguous pick_numbers starting at 1.
  const rows: any[] = [];
  const pickMeta: { pickNumber: number; teamId: string }[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (let slot = 0; slot < picksPerRound; slot++) {
      const pickNumber = (round - 1) * picksPerRound + slot + 1;
      const teamId = opts.teamIdsInPickOrder[slot];
      rows.push({
        league_id: opts.leagueId,
        draft_id: draftId,
        season: opts.season,
        round,
        pick_number: pickNumber,
        slot_number: slot + 1,
        original_team_id: teamId,
        current_team_id: teamId,
      });
      pickMeta.push({ pickNumber, teamId });
    }
  }
  const { data: inserted, error: pickErr } = await admin
    .from('draft_picks')
    .insert(rows)
    .select('id, pick_number');
  if (pickErr || !inserted) throw new Error(`Seed draft picks failed: ${pickErr?.message}`);
  const pickIdByNumber = new Map(inserted.map((p) => [p.pick_number, p.id]));

  // Ensure draft_team_status rows (idempotent upsert).
  const statusRows = opts.teamIdsInPickOrder.map((tid) => ({
    draft_id: draftId,
    team_id: tid,
    autopick_on: false,
  }));
  await admin
    .from('draft_team_status')
    .upsert(statusRows, { onConflict: 'draft_id,team_id', ignoreDuplicates: true });

  return {
    draftId,
    picks: pickMeta.map(({ pickNumber, teamId }) => ({
      pickNumber,
      teamId,
      pickId: pickIdByNumber.get(pickNumber)!,
    })),
  };
}

/**
 * Reset the draft back to pick 1: unselect every pick's player, drop any
 * players added to rosters via draft picks (acquired_via='draft'), rewind
 * drafts.current_pick_number. Safe to call before each draft test.
 */
export async function resetDraftState(draftId: string, leagueId: string): Promise<void> {
  const admin = adminClient();

  // Remove players added by the draft (preserve canonical roster seed).
  await admin
    .from('league_players')
    .delete()
    .eq('league_id', leagueId)
    .eq('acquired_via', 'draft');

  await admin
    .from('draft_picks')
    .update({ player_id: null, selected_at: null, auto_drafted: false })
    .eq('draft_id', draftId);

  await admin
    .from('drafts')
    .update({ status: 'in_progress', current_pick_number: 1, current_pick_timestamp: null })
    .eq('id', draftId);

  // Wipe any queued picks from previous runs so tests start clean.
  await admin.from('draft_queue').delete().eq('draft_id', draftId);
}

export async function getDraftCurrentPick(draftId: string): Promise<number | null> {
  const admin = adminClient();
  const { data } = await admin.from('drafts').select('current_pick_number').eq('id', draftId).single();
  return data?.current_pick_number ?? null;
}

/**
 * Reset every canonical test player back to its snapshot team (the mapping
 * stored on leagues.lottery_odds.canonical_rosters during bootstrap). Inserts
 * missing players, moves misplaced ones, leaves rows outside the canonical
 * mapping alone (e.g. the watcher's force-added showcase player).
 *
 * Call this in beforeAll of any test file that trades/drops/moves players so
 * it starts from a known state regardless of what prior files did.
 */
/**
 * Read the canonical roster mapping saved at bootstrap time. Use this in
 * test beforeAll to pick test players — NOT `getRosterPlayerIds`, which can
 * return non-canonical extras left over from prior test runs.
 */
export async function getCanonicalRosterPlayerIds(
  leagueId: string,
  teamId: string,
): Promise<string[]> {
  const admin = adminClient();
  const { data: league } = await admin
    .from('leagues')
    .select('lottery_odds')
    .eq('id', leagueId)
    .single();
  const canonical = (league?.lottery_odds as any)?.canonical_rosters as
    | Record<string, string[]>
    | undefined;
  return canonical?.[teamId] ?? [];
}

export async function restoreCanonicalRosters(leagueId: string): Promise<void> {
  const admin = adminClient();
  const { data: league } = await admin
    .from('leagues')
    .select('lottery_odds')
    .eq('id', leagueId)
    .single();
  const canonical = (league?.lottery_odds as any)?.canonical_rosters as
    | Record<string, string[]>
    | undefined;
  if (!canonical) return; // older leagues without snapshot

  // Flatten into a desired mapping: player_id → team_id
  const desired = new Map<string, string>();
  for (const [teamId, playerIds] of Object.entries(canonical)) {
    for (const pid of playerIds) desired.set(pid, teamId);
  }

  const { data: current } = await admin
    .from('league_players')
    .select('player_id, team_id')
    .eq('league_id', leagueId)
    .in('player_id', Array.from(desired.keys()));
  const currentMap = new Map((current ?? []).map((r) => [r.player_id, r.team_id]));

  const missing: string[] = [];
  for (const [pid, teamId] of desired) {
    const cur = currentMap.get(pid);
    if (!cur) {
      missing.push(pid);
    } else if (cur !== teamId) {
      await admin
        .from('league_players')
        .update({ team_id: teamId, roster_slot: 'BE' })
        .eq('league_id', leagueId)
        .eq('player_id', pid);
    }
  }

  if (missing.length > 0) {
    const { data: playerRows } = await admin
      .from('players')
      .select('id, position')
      .in('id', missing);
    const posMap = new Map((playerRows ?? []).map((p) => [p.id, p.position]));
    const now = new Date().toISOString();
    const inserts = missing.map((pid) => ({
      league_id: leagueId,
      team_id: desired.get(pid)!,
      player_id: pid,
      position: posMap.get(pid) ?? 'UTIL',
      roster_slot: 'BE',
      acquired_via: 'test_restore',
      acquired_at: now,
    }));
    const { error } = await admin.from('league_players').insert(inserts);
    if (error) throw new Error(`restoreCanonicalRosters insert failed: ${error.message}`);
  }
}

export async function getRosterPlayerIds(leagueId: string, teamId: string): Promise<string[]> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('league_players')
    .select('player_id')
    .eq('league_id', leagueId)
    .eq('team_id', teamId);
  if (error) throw error;
  return (data ?? []).map((r) => r.player_id);
}

export async function getPlayerOwner(leagueId: string, playerId: string): Promise<string | null> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('league_players')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return data?.team_id ?? null;
}

export async function getPlayerSlot(leagueId: string, playerId: string): Promise<string | null> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('league_players')
    .select('roster_slot')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .maybeSingle();
  if (error) throw error;
  return data?.roster_slot ?? null;
}

/**
 * Find a player NOT currently on any team in the given league — i.e. a free agent.
 * Filters out prospects and players in active games. Returns id + position.
 */
export async function pickFreeAgentPlayer(
  leagueId: string,
): Promise<{ id: string; position: string }> {
  const admin = adminClient();

  const today = new Date().toISOString().slice(0, 10);
  const [{ data: rostered }, { data: live }] = await Promise.all([
    admin.from('league_players').select('player_id').eq('league_id', leagueId),
    admin
      .from('live_player_stats')
      .select('player_id')
      .eq('game_status', 2)
      .eq('game_date', today),
  ]);
  const excluded = new Set<string>([
    ...(rostered ?? []).map((r) => r.player_id),
    ...(live ?? []).map((r) => r.player_id),
  ]);

  // Fetch a pool and pick the first not-excluded player.
  const { data, error } = await admin
    .from('players')
    .select('id, position')
    .eq('is_prospect', false)
    .not('position', 'is', null)
    .not('pro_team', 'is', null)
    .limit(200);
  if (error) throw error;
  const usable = (data ?? []).find((p) => !excluded.has(p.id) && p.position);
  if (!usable) throw new Error('No free-agent players available for test');
  return { id: usable.id, position: usable.position! };
}

/**
 * Insert a waiver claim row directly (mirrors what FreeAgentList does client-side).
 * Works for both standard (no bid) and FAAB (with bid_amount) leagues.
 */
export async function createWaiverClaim(opts: {
  leagueId: string;
  teamId: string;
  playerId: string;
  dropPlayerId?: string | null;
  bidAmount?: number | null;
  priority?: number;
}): Promise<string> {
  const admin = adminClient();
  const { data, error } = await admin
    .from('waiver_claims')
    .insert({
      league_id: opts.leagueId,
      team_id: opts.teamId,
      player_id: opts.playerId,
      drop_player_id: opts.dropPlayerId ?? null,
      bid_amount: opts.bidAmount ?? null,
      priority: opts.priority ?? 1,
      status: 'pending',
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`Create waiver claim failed: ${error?.message}`);
  return data.id;
}
