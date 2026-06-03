-- Optional "speed up the clock after round N" draft setting.
-- Both columns are NULL when acceleration is disabled (the default). When
-- BOTH are set, picks made in rounds strictly after `accelerate_after_round`
-- use `accelerated_time_limit` seconds instead of `time_limit` — mirrors the
-- real-life convention of tightening the clock once the early rounds are done.
--
-- The effective per-pick limit is computed in supabase/functions/_shared/draftClock.ts
-- and snapshotted into drafts.current_pick_time_limit on every advance, so the
-- client countdown picks up the change for free.

alter table public.drafts
  add column if not exists accelerate_after_round integer,
  add column if not exists accelerated_time_limit integer;

-- Guard rails: a positive round threshold and a sane clock when set.
alter table public.drafts
  drop constraint if exists drafts_accelerate_after_round_positive;
alter table public.drafts
  add constraint drafts_accelerate_after_round_positive
  check (accelerate_after_round is null or accelerate_after_round >= 1);

alter table public.drafts
  drop constraint if exists drafts_accelerated_time_limit_range;
alter table public.drafts
  add constraint drafts_accelerated_time_limit_range
  check (accelerated_time_limit is null or accelerated_time_limit between 5 and 300);

comment on column public.drafts.accelerate_after_round is
  'Rounds after this number use accelerated_time_limit instead of time_limit. NULL = disabled.';
comment on column public.drafts.accelerated_time_limit is
  'Seconds-per-pick once past accelerate_after_round. NULL = disabled.';
