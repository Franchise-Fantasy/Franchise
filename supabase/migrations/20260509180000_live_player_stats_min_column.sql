-- Add a `min` column to live_player_stats so the poll-live-stats function
-- can derive on-court state by comparing minutes between consecutive polls.
--
-- Background: previously the function had no prior-min reference, so it
-- approximated `oncourt = game_status === 2 && currentMin > 0`. That flips
-- true the moment a player records any minute and never flips back — a
-- player who came in for 2 minutes in Q1 still showed the on-court dot in
-- Q4 while sitting on the bench.
--
-- With this column we can derive `oncourt = game_status === 2 && currentMin
-- > prevMin` — a player whose minutes ticked up between two 30s polls is
-- on the floor right now; flat minutes means they're on the bench.

ALTER TABLE public.live_player_stats
  ADD COLUMN IF NOT EXISTS min numeric NOT NULL DEFAULT 0;
