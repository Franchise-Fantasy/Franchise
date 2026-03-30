-- Atomic trade execution: all player transfers, lineup snapshots, draft pick
-- transfers, pick swaps, trade block cleanup, transaction logging, and proposal
-- completion happen inside a single transaction. If any step fails, everything
-- rolls back — no half-executed trades.

create or replace function execute_trade_transfers(
  p_league_id       uuid,
  p_proposal_id     uuid,
  p_proposed_by     uuid,
  p_timestamp       timestamptz,
  p_today           date,
  p_week_start      date,       -- nullable: current week start for pre-trade snapshots
  p_player_moves    jsonb,      -- array of { player_id, from_team_id, to_team_id, target_slot, pre_trade_slot }
  p_pick_moves      jsonb,      -- array of { draft_pick_id, from_team_id, to_team_id, protection_threshold? }
  p_pick_swaps      jsonb,      -- array of { season, round, beneficiary_team_id, counterparty_team_id }
  p_notes           text
) returns uuid
language plpgsql security definer as $$
declare
  v_move     jsonb;
  v_pid      uuid;
  v_from     uuid;
  v_to       uuid;
  v_slot     text;
  v_pre_slot text;
  v_snap_dt  date;
  v_pick     jsonb;
  v_swap     jsonb;
  v_txn_id   uuid;
  v_prot     int;
begin
  -- 1. Transfer players
  for v_move in select * from jsonb_array_elements(p_player_moves)
  loop
    v_pid  := (v_move->>'player_id')::uuid;
    v_from := (v_move->>'from_team_id')::uuid;
    v_to   := (v_move->>'to_team_id')::uuid;
    v_slot := coalesce(v_move->>'target_slot', 'BE');
    v_pre_slot := coalesce(v_move->>'pre_trade_slot', 'BE');

    -- Move the player
    update league_players
    set team_id = v_to,
        acquired_via = 'trade',
        acquired_at = p_timestamp,
        roster_slot = v_slot
    where league_id = p_league_id
      and player_id = v_pid
      and team_id = v_from;

    if not found then
      raise exception 'Player % is no longer on team %. Trade cannot be completed.', v_pid, v_from;
    end if;

    -- Snapshot outgoing player's pre-trade slot at week start (if mid-week)
    if p_week_start is not null then
      v_snap_dt := case when p_week_start = p_today
                        then p_today - 1
                        else p_week_start end;
      insert into daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
      values (p_league_id, v_from, v_pid, v_snap_dt, v_pre_slot)
      on conflict (team_id, player_id, lineup_date) do nothing;
    end if;

    -- Mark DROPPED on old team
    insert into daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
    values (p_league_id, v_from, v_pid, p_today, 'DROPPED')
    on conflict (team_id, player_id, lineup_date) do update set roster_slot = 'DROPPED';

    -- Remove future lineup entries on old team
    delete from daily_lineups
    where league_id = p_league_id
      and team_id = v_from
      and player_id = v_pid
      and lineup_date > p_today;

    -- Upsert lineup entry on receiving team
    insert into daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
    values (p_league_id, v_to, v_pid, p_today, v_slot)
    on conflict (team_id, player_id, lineup_date) do update set roster_slot = excluded.roster_slot;
  end loop;

  -- 2. Clear trade block status for all traded players
  update league_players
  set on_trade_block = false,
      trade_block_note = null,
      trade_block_interest = '[]'::jsonb
  where league_id = p_league_id
    and player_id in (
      select (j->>'player_id')::uuid
      from jsonb_array_elements(p_player_moves) j
    );

  -- 3. Transfer draft picks
  for v_pick in select * from jsonb_array_elements(p_pick_moves)
  loop
    v_prot := (v_pick->>'protection_threshold')::int;

    update draft_picks
    set current_team_id = (v_pick->>'to_team_id')::uuid,
        protection_threshold = coalesce(v_prot, protection_threshold),
        protection_owner_id = case when v_prot is not null
                                   then (v_pick->>'from_team_id')::uuid
                                   else protection_owner_id end
    where id = (v_pick->>'draft_pick_id')::uuid;
  end loop;

  -- 4. Insert pick swaps
  if jsonb_array_length(coalesce(p_pick_swaps, '[]'::jsonb)) > 0 then
    insert into pick_swaps (league_id, season, round, beneficiary_team_id, counterparty_team_id, created_by_proposal_id)
    select p_league_id,
           j->>'season',
           (j->>'round')::int,
           (j->>'beneficiary_team_id')::uuid,
           (j->>'counterparty_team_id')::uuid,
           p_proposal_id
    from jsonb_array_elements(p_pick_swaps) j;
  end if;

  -- 5. Create transaction record
  insert into league_transactions (league_id, type, notes, team_id)
  values (p_league_id, 'trade', p_notes, p_proposed_by)
  returning id into v_txn_id;

  -- 6. Create transaction items (players + picks)
  insert into league_transaction_items (transaction_id, player_id, draft_pick_id, team_from_id, team_to_id)
  select v_txn_id,
         (j->>'player_id')::uuid,
         null,
         (j->>'from_team_id')::uuid,
         (j->>'to_team_id')::uuid
  from jsonb_array_elements(p_player_moves) j;

  insert into league_transaction_items (transaction_id, player_id, draft_pick_id, team_from_id, team_to_id)
  select v_txn_id,
         null,
         (j->>'draft_pick_id')::uuid,
         (j->>'from_team_id')::uuid,
         (j->>'to_team_id')::uuid
  from jsonb_array_elements(p_pick_moves) j;

  -- 7. Mark proposal as completed
  update trade_proposals
  set status = 'completed',
      completed_at = p_timestamp,
      transaction_id = v_txn_id
  where id = p_proposal_id;

  return v_txn_id;
end;
$$;
