DO $$
DECLARE
  v_lid uuid;
BEGIN
  FOR v_lid IN SELECT id FROM leagues WHERE name = 'Draft Test League' LOOP
    DELETE FROM trade_proposal_items WHERE proposal_id IN (SELECT id FROM trade_proposals WHERE league_id = v_lid);
    DELETE FROM trade_proposal_teams WHERE proposal_id IN (SELECT id FROM trade_proposals WHERE league_id = v_lid);
    DELETE FROM trade_proposals WHERE league_id = v_lid;
    DELETE FROM league_matchups WHERE league_id = v_lid;
    DELETE FROM league_schedule WHERE league_id = v_lid;
    DELETE FROM league_transactions WHERE league_id = v_lid;
    DELETE FROM league_players WHERE league_id = v_lid;
    DELETE FROM draft_team_status WHERE draft_id IN (SELECT id FROM drafts WHERE league_id = v_lid);
    DELETE FROM draft_queue WHERE draft_id IN (SELECT id FROM drafts WHERE league_id = v_lid);
    DELETE FROM draft_picks WHERE league_id = v_lid;
    DELETE FROM drafts WHERE league_id = v_lid;
    DELETE FROM league_scoring_settings WHERE league_id = v_lid;
    DELETE FROM league_roster_config WHERE league_id = v_lid;
    DELETE FROM teams WHERE league_id = v_lid;
    DELETE FROM leagues WHERE id = v_lid;
  END LOOP;
END $$;
