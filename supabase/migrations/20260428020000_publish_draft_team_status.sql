-- Publish draft_team_status to the realtime publication so every team in the
-- draft room can react to autopick toggles in real time. The "AUTOPICK" label
-- on each pick card is fed by this stream — without it, only the team that
-- toggled the switch sees their own change.

ALTER PUBLICATION supabase_realtime ADD TABLE public.draft_team_status;
