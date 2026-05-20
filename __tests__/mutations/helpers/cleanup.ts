import { adminClient } from './clients';
import { TEST_LEAGUE_NAME } from './config';

/**
 * Hard-delete the test league and every child record. Use this if tests leave
 * the league in a corrupt state and you want a fresh bootstrap on next run.
 *
 * Does NOT delete bot auth users — those are reused across runs.
 *
 * Order matters because several tables have NO ACTION FKs to leagues / teams /
 * draft_picks (they don't cascade). The order below is topologically sorted:
 * leaf tables → intermediate tables → teams → leagues. Each delete is awaited
 * and errors are logged loudly so a silent partial-nuke never masquerades as
 * success (prior version swallowed the league-transaction-items FK violation
 * and left the league half-alive).
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

  const { data: transactions } = await admin
    .from('league_transactions')
    .select('id')
    .eq('league_id', leagueId);
  const transactionIds = (transactions ?? []).map((t) => t.id);

  const { data: drafts } = await admin.from('drafts').select('id').eq('league_id', leagueId);
  const draftIds = (drafts ?? []).map((d) => d.id);

  const { data: surveys } = await admin
    .from('commissioner_surveys')
    .select('id')
    .eq('league_id', leagueId);
  const surveyIds = (surveys ?? []).map((s) => s.id);

  const { data: polls } = await admin
    .from('commissioner_polls')
    .select('id')
    .eq('league_id', leagueId);
  const pollIds = (polls ?? []).map((p) => p.id);

  const del = async (label: string, query: any) => {
    const { error } = await query;
    if (error) throw new Error(`nukeTestLeague: ${label} failed: ${error.message}`);
  };

  // 1. Detach the league's own self-references that block teams/draft_picks deletion.
  await del('clear champion_team_id', admin.from('leagues').update({ champion_team_id: null }).eq('id', leagueId));

  // 2. Trade graph (children → parents).
  if (proposalIds.length > 0) {
    await del('trade_proposal_items', admin.from('trade_proposal_items').delete().in('proposal_id', proposalIds));
    await del('trade_proposal_teams', admin.from('trade_proposal_teams').delete().in('proposal_id', proposalIds));
    await del('trade_votes', admin.from('trade_votes').delete().in('proposal_id', proposalIds));
  }
  await del('trade_rumors', admin.from('trade_rumors').delete().eq('league_id', leagueId));
  await del('trade_proposals', admin.from('trade_proposals').delete().eq('league_id', leagueId));

  // 3. Transactions — items first (NO ACTION FK to draft_picks blocks every league nuke without this).
  if (transactionIds.length > 0) {
    await del('league_transaction_items', admin.from('league_transaction_items').delete().in('transaction_id', transactionIds));
  }
  await del('league_transactions', admin.from('league_transactions').delete().eq('league_id', leagueId));
  await del('pending_transactions', admin.from('pending_transactions').delete().eq('league_id', leagueId));

  // 4. Waivers.
  await del('waiver_claims', admin.from('waiver_claims').delete().eq('league_id', leagueId));
  await del('waiver_priority', admin.from('waiver_priority').delete().eq('league_id', leagueId));
  await del('league_waivers', admin.from('league_waivers').delete().eq('league_id', leagueId));

  // 5. Chat / commissioner content.
  if (convIds.length > 0) {
    await del('chat_messages', admin.from('chat_messages').delete().in('conversation_id', convIds));
    await del('chat_members', admin.from('chat_members').delete().in('conversation_id', convIds));
  }
  await del('chat_conversations', admin.from('chat_conversations').delete().eq('league_id', leagueId));
  if (pollIds.length > 0) {
    await del('poll_votes', admin.from('poll_votes').delete().in('poll_id', pollIds));
  }
  await del('commissioner_polls', admin.from('commissioner_polls').delete().eq('league_id', leagueId));
  if (surveyIds.length > 0) {
    await del('survey_responses', admin.from('survey_responses').delete().in('survey_id', surveyIds));
  }
  await del('commissioner_surveys', admin.from('commissioner_surveys').delete().eq('league_id', leagueId));
  await del('commissioner_announcements', admin.from('commissioner_announcements').delete().eq('league_id', leagueId));

  // 6. Schedule / playoffs / standings.
  await del('league_matchups', admin.from('league_matchups').delete().eq('league_id', leagueId));
  await del('league_schedule', admin.from('league_schedule').delete().eq('league_id', leagueId));
  await del('playoff_bracket', admin.from('playoff_bracket').delete().eq('league_id', leagueId));
  await del('playoff_seed_picks', admin.from('playoff_seed_picks').delete().eq('league_id', leagueId));
  await del('week_scores', admin.from('week_scores').delete().eq('league_id', leagueId));
  await del('team_seasons', admin.from('team_seasons').delete().eq('league_id', leagueId));
  await del('league_records', admin.from('league_records').delete().eq('league_id', leagueId));
  await del('lottery_results', admin.from('lottery_results').delete().eq('league_id', leagueId));
  await del('pick_swaps', admin.from('pick_swaps').delete().eq('league_id', leagueId));
  await del('keeper_declarations', admin.from('keeper_declarations').delete().eq('league_id', leagueId));

  // 7. Drafts (children of leagues; draft_picks cascades via league_id).
  if (draftIds.length > 0) {
    await del('draft_team_status', admin.from('draft_team_status').delete().in('draft_id', draftIds));
    await del('draft_queue', admin.from('draft_queue').delete().in('draft_id', draftIds));
  }
  await del('draft_picks', admin.from('draft_picks').delete().eq('league_id', leagueId));
  await del('drafts', admin.from('drafts').delete().eq('league_id', leagueId));

  // 8. Lineups / rosters / config.
  await del('daily_lineups', admin.from('daily_lineups').delete().eq('league_id', leagueId));
  await del('league_players', admin.from('league_players').delete().eq('league_id', leagueId));
  await del('league_roster_config', admin.from('league_roster_config').delete().eq('league_id', leagueId));
  await del('league_scoring_settings', admin.from('league_scoring_settings').delete().eq('league_id', leagueId));
  await del('league_notification_prefs', admin.from('league_notification_prefs').delete().eq('league_id', leagueId));
  await del('league_payments', admin.from('league_payments').delete().eq('league_id', leagueId));
  await del('league_subscriptions', admin.from('league_subscriptions').delete().eq('league_id', leagueId));
  await del('activity_tokens', admin.from('activity_tokens').delete().eq('league_id', leagueId));

  // 9. Teams (after every team_id ref above is gone) and finally the league.
  if (teamIds.length > 0) {
    await del('teams', admin.from('teams').delete().in('id', teamIds));
  }
  await del('leagues', admin.from('leagues').delete().eq('id', leagueId));
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

