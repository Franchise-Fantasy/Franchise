import { adminClient } from './clients';
import { TEST_LEAGUE_NAME } from './config';

/**
 * Hard-delete the test league and every child record. Use this if tests leave
 * the league in a corrupt state and you want a fresh bootstrap on next run.
 *
 * Does NOT delete bot auth users — those are reused across runs.
 */
export async function nukeTestLeague(): Promise<void> {
  const admin = adminClient();
  const { data: league } = await admin
    .from('leagues')
    .select('id')
    .eq('name', TEST_LEAGUE_NAME)
    .maybeSingle();
  if (!league) return;

  const leagueId = league.id;

  const { data: teams } = await admin.from('teams').select('id').eq('league_id', leagueId);
  const teamIds = (teams ?? []).map((t) => t.id);

  const { data: proposals } = await admin
    .from('trade_proposals')
    .select('id')
    .eq('league_id', leagueId);
  const proposalIds = (proposals ?? []).map((p) => p.id);

  const { data: conversations } = await admin
    .from('chat_conversations')
    .select('id')
    .eq('league_id', leagueId);
  const convIds = (conversations ?? []).map((c) => c.id);

  // Order matters: delete rows that reference the league before deleting the league.
  if (proposalIds.length > 0) {
    await admin.from('trade_proposal_items').delete().in('proposal_id', proposalIds);
    await admin.from('trade_proposal_teams').delete().in('proposal_id', proposalIds);
  }
  await admin.from('trade_proposals').delete().eq('league_id', leagueId);
  if (convIds.length > 0) {
    await admin.from('chat_messages').delete().in('conversation_id', convIds);
    await admin.from('chat_members').delete().in('conversation_id', convIds);
  }
  await admin.from('chat_conversations').delete().eq('league_id', leagueId);
  await admin.from('league_players').delete().eq('league_id', leagueId);
  await admin.from('draft_picks').delete().eq('league_id', leagueId);
  await admin.from('transactions').delete().eq('league_id', leagueId);
  if (teamIds.length > 0) {
    await admin.from('teams').delete().in('id', teamIds);
  }
  await admin.from('leagues').delete().eq('id', leagueId);
}

/**
 * Per-test cleanup: wipe all trade proposals (+children) in the test league,
 * AND any orphaned trade/trade_update chat messages pointing to them. Leaves
 * rosters, teams, chat conversations as-is.
 *
 * Orphan cleanup matters because TradeBubble falls back to "Trade Completed"
 * when the referenced proposal is missing (get_messages_page LEFT JOIN returns
 * null trade_summary). Without this, old test-run chat messages render as
 * broken cards forever.
 */
export async function resetTrades(leagueId: string): Promise<void> {
  const admin = adminClient();
  const { data: proposals } = await admin
    .from('trade_proposals')
    .select('id')
    .eq('league_id', leagueId);
  const ids = (proposals ?? []).map((p) => p.id);

  // Delete any chat messages referencing these proposals (trade cards + trade_update events).
  // Matches either m.content = proposal_id (type='trade') or content JSON contains proposal_id
  // (type='trade_update'). Simplest approach: delete all trade / trade_update messages in
  // the test league's chat conversations — they're all from prior test runs anyway.
  const { data: conversations } = await admin
    .from('chat_conversations')
    .select('id')
    .eq('league_id', leagueId);
  const convIds = (conversations ?? []).map((c) => c.id);
  if (convIds.length > 0) {
    await admin
      .from('chat_messages')
      .delete()
      .in('conversation_id', convIds)
      .in('type', ['trade', 'trade_update']);
  }

  if (ids.length === 0) return;
  await admin.from('trade_proposal_items').delete().in('proposal_id', ids);
  await admin.from('trade_proposal_teams').delete().in('proposal_id', ids);
  await admin.from('trade_proposals').delete().in('id', ids);

  // Restore any draft picks that were moved by executed trades (idempotent:
  // unselected picks only, original_team_id != current_team_id).
  const { data: picks } = await admin
    .from('draft_picks')
    .select('id, original_team_id, current_team_id')
    .eq('league_id', leagueId)
    .is('player_id', null);
  for (const p of picks ?? []) {
    if (p.current_team_id !== p.original_team_id) {
      await admin
        .from('draft_picks')
        .update({ current_team_id: p.original_team_id })
        .eq('id', p.id);
    }
  }
}

/**
 * Ensure a player is on a specific team in the league. If the row exists but
 * points at a different team, update it. If the row is missing (because a
 * prior test dropped them), re-insert. Idempotent.
 */
export async function restorePlayerOwnership(
  leagueId: string,
  playerId: string,
  ownerTeamId: string,
): Promise<void> {
  const admin = adminClient();
  const { data: existing } = await admin
    .from('league_players')
    .select('id, team_id')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (existing) {
    if (existing.team_id !== ownerTeamId) {
      await admin
        .from('league_players')
        .update({ team_id: ownerTeamId, roster_slot: 'BE' })
        .eq('id', existing.id);
    }
    return;
  }

  // Player was dropped entirely — re-insert.
  const { data: player } = await admin
    .from('players')
    .select('position')
    .eq('id', playerId)
    .single();
  if (!player) throw new Error(`Cannot restore player ${playerId}: not in players table`);
  await admin.from('league_players').insert({
    league_id: leagueId,
    team_id: ownerTeamId,
    player_id: playerId,
    position: player.position ?? 'UTIL',
    roster_slot: 'BE',
    acquired_via: 'test_restore',
    acquired_at: new Date().toISOString(),
  });
}

