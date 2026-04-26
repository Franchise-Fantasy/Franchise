-- Consolidated trade proposals fetch. Replaces the 4-round-trip pattern in
-- hooks/useTrades.ts (proposals + teams + items + original-counteroffer items
-- + names lookup) with a single RPC returning a fully nested JSONB array.

CREATE OR REPLACE FUNCTION public.get_trade_proposals_for_league(p_league_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
BEGIN
  IF NOT is_league_member(p_league_id) THEN
    RAISE EXCEPTION 'Not a league member';
  END IF;

  WITH base AS (
    SELECT
      tp.id,
      tp.league_id,
      tp.proposed_by_team_id,
      tp.status,
      tp.proposed_at,
      tp.accepted_at,
      tp.review_expires_at,
      tp.completed_at,
      tp.transaction_id,
      tp.notes,
      tp.counteroffer_of
    FROM trade_proposals tp
    WHERE tp.league_id = p_league_id
    ORDER BY tp.proposed_at DESC
    LIMIT 200
  ),
  superseded AS (
    SELECT counteroffer_of AS id
      FROM base
     WHERE counteroffer_of IS NOT NULL
  ),
  visible AS (
    SELECT b.*
      FROM base b
      LEFT JOIN superseded s ON s.id = b.id
     WHERE s.id IS NULL OR b.status <> 'cancelled'
  ),
  proposal_teams AS (
    SELECT
      tpt.proposal_id,
      jsonb_agg(jsonb_build_object(
        'id',               tpt.id,
        'team_id',          tpt.team_id,
        'status',           tpt.status,
        'team_name',        t.name,
        'drop_player_ids',  COALESCE(tpt.drop_player_ids, ARRAY[]::uuid[])
      )) AS teams
    FROM trade_proposal_teams tpt
    JOIN visible v ON v.id = tpt.proposal_id
    LEFT JOIN teams t ON t.id = tpt.team_id
    GROUP BY tpt.proposal_id
  ),
  -- Items for both visible proposals AND any counteroffer-source proposals,
  -- so we can attach `original_items` without a second round trip.
  all_item_proposal_ids AS (
    SELECT id FROM visible
    UNION
    SELECT counteroffer_of FROM visible WHERE counteroffer_of IS NOT NULL
  ),
  enriched_items AS (
    SELECT
      tpi.id,
      tpi.proposal_id,
      tpi.player_id,
      tpi.draft_pick_id,
      tpi.from_team_id,
      tpi.to_team_id,
      tpi.protection_threshold,
      tpi.pick_swap_season,
      tpi.pick_swap_round,
      pl.name     AS player_name,
      pl.position AS player_position,
      pl.pro_team AS player_pro_team,
      dp.season   AS pick_season,
      dp.round    AS pick_round,
      ot.name     AS pick_original_team_name
    FROM trade_proposal_items tpi
    JOIN all_item_proposal_ids ip ON ip.id = tpi.proposal_id
    LEFT JOIN players     pl ON pl.id = tpi.player_id
    LEFT JOIN draft_picks dp ON dp.id = tpi.draft_pick_id
    LEFT JOIN teams       ot ON ot.id = dp.original_team_id
  ),
  proposal_items AS (
    SELECT
      ei.proposal_id,
      jsonb_agg(jsonb_build_object(
        'id',                       ei.id,
        'player_id',                ei.player_id,
        'draft_pick_id',            ei.draft_pick_id,
        'from_team_id',             ei.from_team_id,
        'to_team_id',               ei.to_team_id,
        'player_name',              ei.player_name,
        'player_position',          ei.player_position,
        'player_pro_team',          ei.player_pro_team,
        'pick_season',              ei.pick_season,
        'pick_round',               ei.pick_round,
        'pick_original_team_name',  ei.pick_original_team_name,
        'protection_threshold',     ei.protection_threshold,
        'pick_swap_season',         ei.pick_swap_season,
        'pick_swap_round',          ei.pick_swap_round
      )) AS items
    FROM enriched_items ei
    GROUP BY ei.proposal_id
  )
  SELECT jsonb_agg(jsonb_build_object(
    'id',                    v.id,
    'league_id',             v.league_id,
    'proposed_by_team_id',   v.proposed_by_team_id,
    'status',                v.status,
    'proposed_at',           v.proposed_at,
    'accepted_at',           v.accepted_at,
    'review_expires_at',     v.review_expires_at,
    'completed_at',          v.completed_at,
    'transaction_id',        v.transaction_id,
    'notes',                 v.notes,
    'counteroffer_of',       v.counteroffer_of,
    'teams',                 COALESCE(pt.teams, '[]'::jsonb),
    'items',                 COALESCE(pi.items, '[]'::jsonb),
    'original_items',        CASE WHEN v.counteroffer_of IS NOT NULL
                                  THEN (SELECT items FROM proposal_items WHERE proposal_id = v.counteroffer_of)
                                  ELSE NULL END
  ) ORDER BY v.proposed_at DESC)
  INTO v_result
  FROM visible v
  LEFT JOIN proposal_teams pt ON pt.proposal_id = v.id
  LEFT JOIN proposal_items pi ON pi.proposal_id = v.id;

  RETURN COALESCE(v_result, '[]'::jsonb);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.get_trade_proposals_for_league(uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.get_trade_proposals_for_league(uuid) TO authenticated, service_role;
