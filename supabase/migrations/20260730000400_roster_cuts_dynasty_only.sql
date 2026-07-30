-- Roster cuts are a dynasty-only mechanism — enforce that at the choke point.
--
-- Every UI surface is gated on league_type = 'dynasty' (the create-league wizard's
-- Roster Cuts section, StepReview's summary row, and the Roster Cuts card on
-- league-info that owns the only editor). arm_roster_cuts_deadline() was not, and
-- `roster_cuts_grace_days` defaults to 14 for every league regardless of type — so
-- a non-dynasty league that somehow completed a rookie draft would have had a
-- deadline armed that its commissioner could neither see nor cancel, and the cron
-- would have cut players in a redraft league.
--
-- Not hypothetical enough to ignore: 4 live non-dynasty leagues carry
-- rookie_draft_rounds > 0. advance-season branches on league_type and never routes
-- them to a rookie draft today, but that's one edit away from being untrue, and an
-- invisible mechanism is the worst kind to leave armed.
--
-- The gate goes in the deadline expression, NOT the UPDATE's WHERE clause — the
-- same statement also advances offseason_step, which must still happen for any
-- league type that completes a rookie draft.
CREATE OR REPLACE FUNCTION public.arm_roster_cuts_deadline(p_league_id uuid)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deadline date;
BEGIN
  UPDATE public.leagues
  SET offseason_step = 'rookie_draft_complete',
      roster_cuts_deadline = CASE
        -- Dynasty only. Keeps the mechanism and the UI that explains it gated on
        -- exactly the same condition, so nothing can ever fire unseen.
        WHEN COALESCE(league_type, 'dynasty') <> 'dynasty' THEN NULL
        -- A date already sitting in the future was set deliberately for THIS
        -- offseason (commissioner override, or a re-published offline draft
        -- re-arming an unchanged class) — never move it.
        WHEN roster_cuts_deadline > public.sport_slate_date() THEN roster_cuts_deadline
        -- Automatic deadlines are off for this league. Clear any leftover past
        -- date so it can't reach the enforcement cron.
        WHEN roster_cuts_grace_days IS NULL THEN NULL
        ELSE public.sport_slate_date() + roster_cuts_grace_days
      END
  WHERE id = p_league_id
  RETURNING roster_cuts_deadline INTO v_deadline;

  RETURN v_deadline;
END;
$$;

REVOKE ALL ON FUNCTION public.arm_roster_cuts_deadline(uuid) FROM public;
REVOKE ALL ON FUNCTION public.arm_roster_cuts_deadline(uuid) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.arm_roster_cuts_deadline(uuid) TO service_role;

-- The ADD COLUMN in 20260730000300 backfilled DEFAULT 14 onto every league. Make
-- the stored value honest for the ones that will never use it: a non-dynasty row
-- reading "14" implies a policy the league does not have and the UI never shows.
-- DEFAULT stays 14 so a dynasty league created by any path still gets the feature.
UPDATE public.leagues
SET roster_cuts_grace_days = NULL
WHERE COALESCE(league_type, 'dynasty') <> 'dynasty'
  AND roster_cuts_grace_days IS NOT NULL;

-- Same reasoning for any deadline already sitting on a non-dynasty league.
UPDATE public.leagues
SET roster_cuts_deadline = NULL
WHERE COALESCE(league_type, 'dynasty') <> 'dynasty'
  AND roster_cuts_deadline IS NOT NULL;
