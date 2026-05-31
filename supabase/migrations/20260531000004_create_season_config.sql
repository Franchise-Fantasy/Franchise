-- Season metadata (current season + opening-night / regular-season-end /
-- creation-opens dates per sport-season), editable via SQL without an app
-- deploy. The client reads this into an in-memory cache on startup and falls
-- back to the hardcoded constants in constants/LeagueDefaults.ts until the row
-- is read, so an empty or unreachable table is non-fatal.
--
-- Motivation: the exact NBA opening night isn't published until ~mid-August, so
-- the upcoming season's start_date is an estimate that needs correcting without
-- shipping a new binary. Edit the row, the client picks it up on next launch.

create table if not exists public.season_config (
  sport text not null,
  season text not null,
  -- Opening night (fantasy week 1 default) and regular-season end.
  start_date date not null,
  end_date date not null,
  -- Concrete date next-season league creation unlocks. Set on the upcoming
  -- season's row; NULL on seasons that have already opened.
  creation_opens_at date,
  is_current boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (sport, season)
);

-- At most one current season per sport.
create unique index if not exists season_config_one_current_per_sport
  on public.season_config (sport)
  where is_current;

alter table public.season_config enable row level security;

-- Reference data: any authenticated user can read it. Writes are SQL/admin-only
-- (service role bypasses RLS), so no INSERT/UPDATE/DELETE policies are defined.
drop policy if exists "season_config readable by authenticated" on public.season_config;
create policy "season_config readable by authenticated"
  on public.season_config
  for select
  to authenticated
  using (true);

-- Seed from the current hardcoded constants so behaviour is unchanged on day one.
insert into public.season_config (sport, season, start_date, end_date, creation_opens_at, is_current) values
  ('nba',  '2024-25', '2024-10-22', '2025-04-13', null,         false),
  ('nba',  '2025-26', '2025-10-21', '2026-04-12', null,         true),
  ('nba',  '2026-27', '2026-10-20', '2027-04-11', '2026-07-01', false),
  ('wnba', '2025',    '2025-05-16', '2025-09-19', null,         false),
  ('wnba', '2026',    '2026-05-15', '2026-09-13', null,         true),
  ('wnba', '2027',    '2027-05-15', '2027-09-12', '2026-11-01', false)
on conflict (sport, season) do nothing;
