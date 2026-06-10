-- Freeze each team's standing lineup into daily_lineups every slate day.
--
-- WHY: normal active<->bench moves only write daily_lineups for the days the
-- manager touches; a day they never open their lineup gets NO row, so scoring
-- falls back to the player's CURRENT (mutable) roster_slot at compute time.
-- That makes an unset day's score non-deterministic — it silently changes
-- whenever the roster is later edited, and finalize-week freezes whatever the
-- roster happened to be at the 5am-ET rollover. (WNBA 2k26 wk5: an opponent's
-- frozen score was ~114 pts higher than the settled lineup because three
-- now-benched players were momentarily in active slots when finalize ran.)
--
-- FIX: at the start of each slate day, materialize every rostered player's
-- standing slot (the most-recent prior daily_lineups entry — i.e. the lineup
-- "rolled forward" — else their league_players default) into an explicit,
-- immutable row. Then every day has a real row, scoring never falls back to the
-- mutable roster, finalize and the live view always agree, and a past week's
-- score can never drift again.
--
-- Runs at 10:15 UTC: safely after the 5am-ET rollover year-round
-- (09:00 UTC during EDT, 10:00 UTC during EST) and before any game tips.
-- ON CONFLICT DO NOTHING: never clobber a lineup the manager explicitly set for
-- today, and stay idempotent across cron retries. Only fires for leagues whose
-- schedule has a week covering today.

select cron.unschedule('snapshot-daily-lineups')
where exists (select 1 from cron.job where jobname = 'snapshot-daily-lineups');

select cron.schedule(
  'snapshot-daily-lineups',
  '15 10 * * *',
  $$
  insert into public.daily_lineups (league_id, team_id, player_id, lineup_date, roster_slot)
  select lp.league_id, lp.team_id, lp.player_id,
         (now() at time zone 'America/New_York')::date as lineup_date,
         coalesce(
           (select dl.roster_slot
              from public.daily_lineups dl
             where dl.team_id = lp.team_id
               and dl.player_id = lp.player_id
               and dl.lineup_date < (now() at time zone 'America/New_York')::date
               and dl.roster_slot <> 'DROPPED'
             order by dl.lineup_date desc
             limit 1),
           lp.roster_slot
         ) as roster_slot
    from public.league_players lp
   where exists (
           select 1 from public.league_schedule ls
            where ls.league_id = lp.league_id
              and (now() at time zone 'America/New_York')::date between ls.start_date and ls.end_date
         )
  on conflict (team_id, player_id, lineup_date) do nothing;
  $$
);
