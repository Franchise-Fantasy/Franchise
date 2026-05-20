-- Add 'lottery_revealing' to the offseason_step CHECK constraint.
-- start-lottery has been writing this intermediate state ("watch the reveal"
-- ceremony in progress) but the constraint was never updated to allow it,
-- so every dynasty lottery silently failed to advance the state. The home
-- hero's "Watch the Reveal" CTA, lottery-room's late-joiner reveal logic,
-- and create-rookie-draft's offseason_step gate all depend on this value.

ALTER TABLE leagues DROP CONSTRAINT IF EXISTS leagues_offseason_step_check;
ALTER TABLE leagues ADD CONSTRAINT leagues_offseason_step_check
  CHECK (
    offseason_step IS NULL OR offseason_step = ANY (ARRAY[
      'lottery_pending'::text,
      'lottery_scheduled'::text,
      'lottery_revealing'::text,
      'lottery_complete'::text,
      'rookie_draft_pending'::text,
      'rookie_draft_complete'::text,
      'keeper_pending'::text,
      'ready_for_new_season'::text
    ])
  );
