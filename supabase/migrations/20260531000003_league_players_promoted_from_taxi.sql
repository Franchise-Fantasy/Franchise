-- Track whether a player has been promoted off the taxi squad.
--
-- Once a GM (or the season-rollover auto-promote in advance-season) moves a
-- player from TAXI to an active slot, that player is "promoted" and may not be
-- sent back to the taxi squad. Taxi eligibility was previously experience-only
-- (utils/roster/taxiEligibility.ts), so a still-young promoted player kept
-- showing the taxi action. This flag closes that loophole.
--
-- A drop + re-add naturally resets the player (the league_players row is
-- deleted), so the flag does not need an explicit reset path on drop.

ALTER TABLE public.league_players
  ADD COLUMN IF NOT EXISTS promoted_from_taxi boolean NOT NULL DEFAULT false;
