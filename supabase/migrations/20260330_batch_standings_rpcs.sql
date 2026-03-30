-- Batch update matchup scores in one round-trip instead of N individual UPDATEs
create or replace function batch_update_matchup_scores(
  p_updates jsonb
) returns void
language plpgsql security definer as $$
begin
  update league_matchups lm
  set home_score = (u.val->>'home_score')::numeric,
      away_score = (u.val->>'away_score')::numeric
  from jsonb_array_elements(p_updates) as u(val)
  where lm.id = (u.val->>'id')::uuid;
end;
$$;

-- Batch update team points_for / points_against in one round-trip
create or replace function batch_update_team_standings(
  p_updates jsonb
) returns void
language plpgsql security definer as $$
begin
  update teams t
  set points_for     = (u.val->>'points_for')::numeric,
      points_against = (u.val->>'points_against')::numeric
  from jsonb_array_elements(p_updates) as u(val)
  where t.id = (u.val->>'id')::uuid;
end;
$$;
