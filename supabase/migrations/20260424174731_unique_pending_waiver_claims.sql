-- Prevent a team from having more than one pending waiver claim for the same player.
-- The UI and RPC layers did not enforce this, so users could stack unlimited pending
-- claims. process-waivers handled the mess during processing, but the duplicates
-- still consumed waiver priority/FAAB reasoning and looked broken to users.

-- Step 1: Dedupe any existing pending duplicates. Keep the most recently created
-- pending claim per (league_id, team_id, player_id); mark the older ones cancelled.
with ranked as (
  select
    id,
    row_number() over (
      partition by league_id, team_id, player_id
      order by created_at desc, id desc
    ) as rn
  from public.waiver_claims
  where status = 'pending'
)
update public.waiver_claims wc
set status = 'cancelled'
from ranked r
where wc.id = r.id
  and r.rn > 1;

-- Step 2: Partial unique index — one pending claim per team per player.
-- Non-pending rows (failed, successful, cancelled) are ignored, so historical
-- rows and post-processing rows don't collide with a fresh resubmission.
create unique index if not exists uniq_waiver_claims_pending_team_player
  on public.waiver_claims (league_id, team_id, player_id)
  where status = 'pending';
