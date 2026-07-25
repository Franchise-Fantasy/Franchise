-- Overnight "quiet hours" for slow (async) drafts.
--
-- A slow draft's pick clock runs for hours/days, so without a nightly window a
-- team can land on the clock at 3am and get auto-drafted while everyone sleeps.
-- Quiet hours freeze the clock during a daily wall-clock window (measured in the
-- league's game timezone, ET — the same "league day" reference used by
-- utils/leagueTime.ts and the game-data flows) and resume it when the window
-- closes.
--
-- Implementation reuses the existing commissioner pause machinery: entering the
-- window flips the draft to status='paused' (so the in-flight autodraft/reminder
-- QStash timers no-op and the stalled-draft sweeper ignores it) and snapshots
-- the remaining pick-clock into paused_remaining_ms; exiting re-arms a fresh
-- timer from the snapshot. `pause_reason` distinguishes an automatic quiet-hours
-- freeze from a manual commissioner pause so the manage-draft-quiet-hours cron
-- only auto-resumes the ones it created and never fights a commissioner.

ALTER TABLE public.drafts
  ADD COLUMN IF NOT EXISTS quiet_hours_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quiet_hours_start_min smallint,
  ADD COLUMN IF NOT EXISTS quiet_hours_end_min smallint,
  ADD COLUMN IF NOT EXISTS pause_reason text;

-- Minute-of-day (0-1439, ET wall clock) for each edge of the window; a window
-- with start > end simply wraps past midnight (e.g. 23:00 -> 06:00).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drafts_quiet_hours_range_check'
  ) THEN
    ALTER TABLE public.drafts
      ADD CONSTRAINT drafts_quiet_hours_range_check CHECK (
        (quiet_hours_start_min IS NULL OR quiet_hours_start_min BETWEEN 0 AND 1439)
        AND (quiet_hours_end_min IS NULL OR quiet_hours_end_min BETWEEN 0 AND 1439)
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'drafts_pause_reason_check'
  ) THEN
    ALTER TABLE public.drafts
      ADD CONSTRAINT drafts_pause_reason_check CHECK (
        pause_reason IS NULL OR pause_reason IN ('commissioner', 'quiet_hours')
      );
  END IF;
END $$;

-- Any draft already sitting in the paused state predates quiet hours, so it can
-- only be a manual commissioner pause. Tag it so the cron never auto-resumes it.
UPDATE public.drafts
   SET pause_reason = 'commissioner'
 WHERE status = 'paused' AND pause_reason IS NULL;

COMMENT ON COLUMN public.drafts.quiet_hours_enabled IS
  'Slow drafts only: when true the clock freezes nightly during the quiet_hours window.';
COMMENT ON COLUMN public.drafts.quiet_hours_start_min IS
  'Quiet-hours window start as minute-of-day (0-1439) in ET; window wraps past midnight when start > end.';
COMMENT ON COLUMN public.drafts.quiet_hours_end_min IS
  'Quiet-hours window end as minute-of-day (0-1439) in ET.';
COMMENT ON COLUMN public.drafts.pause_reason IS
  'Why the draft is paused: ''commissioner'' (manual) or ''quiet_hours'' (auto). NULL when running. Lets the quiet-hours cron auto-resume only its own freezes.';

-- Surface the new fields on the draft-room init payload so a member entering an
-- already-frozen room renders the quiet-hours state and the settings UIs
-- hydrate immediately. Mirrors the current definition + four appended fields.
CREATE OR REPLACE FUNCTION public.get_draft_room_init(p_draft_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_draft record;
  v_team record;
  v_is_commissioner boolean;
  v_draft_pick_trading boolean;
  v_autopick boolean;
BEGIN
  -- Fetch the full draft state
  SELECT * INTO v_draft FROM drafts WHERE id = p_draft_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Draft not found';
  END IF;

  -- Fetch user's team in this league
  SELECT id, name, tricode, logo_key
    INTO v_team
    FROM teams
   WHERE league_id = v_draft.league_id
     AND user_id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Not a member of this league';
  END IF;

  -- Commissioner check
  SELECT (created_by = v_uid) INTO v_is_commissioner
    FROM leagues WHERE id = v_draft.league_id;

  -- Draft pick trading setting
  SELECT draft_pick_trading_enabled INTO v_draft_pick_trading
    FROM leagues WHERE id = v_draft.league_id;

  -- Autopick status
  SELECT COALESCE(autopick_on, false) INTO v_autopick
    FROM draft_team_status
   WHERE draft_id = p_draft_id
     AND team_id = v_team.id;

  IF NOT FOUND THEN
    v_autopick := false;
  END IF;

  RETURN jsonb_build_object(
    'draft', jsonb_build_object(
      'id', v_draft.id,
      'league_id', v_draft.league_id,
      'type', v_draft.type,
      'status', v_draft.status,
      'draft_date', v_draft.draft_date,
      'time_limit', v_draft.time_limit,
      'current_pick_time_limit', v_draft.current_pick_time_limit,
      'accelerate_after_round', v_draft.accelerate_after_round,
      'accelerated_time_limit', v_draft.accelerated_time_limit,
      'current_pick_number', v_draft.current_pick_number,
      'current_pick_timestamp', v_draft.current_pick_timestamp,
      'picks_per_round', v_draft.picks_per_round,
      'rounds', v_draft.rounds,
      'season', v_draft.season,
      'paused_at', v_draft.paused_at,
      'paused_remaining_ms', v_draft.paused_remaining_ms,
      'pause_reason', v_draft.pause_reason,
      'quiet_hours_enabled', v_draft.quiet_hours_enabled,
      'quiet_hours_start_min', v_draft.quiet_hours_start_min,
      'quiet_hours_end_min', v_draft.quiet_hours_end_min
    ),
    'team', jsonb_build_object(
      'id', v_team.id,
      'name', v_team.name,
      'tricode', v_team.tricode,
      'logo_key', v_team.logo_key,
      'is_commissioner', v_is_commissioner
    ),
    'draft_pick_trading_enabled', v_draft_pick_trading,
    'autopick_on', v_autopick
  );
END;
$function$;
