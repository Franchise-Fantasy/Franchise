-- Franchise Fantasy prospect rankings schema
-- Run once in the Supabase SQL editor.

-- Current board: one row per player per draft year.
create table if not exists prospect_rankings (
  player_slug text not null,
  draft_year int not null,
  full_name text not null,
  position text,
  school text,
  team text,                          -- actual current NBA team once drafted (updates weekly, tracks trades)
  display_rank int not null,          -- 1..N within draft_year; what the app sorts by
  consensus_score numeric not null,   -- blended cross-source score (internal)
  source_ranks jsonb not null default '{}'::jsonb, -- e.g. {"nbadraft": 3, "tankathon": 5} (internal)
  updated_at timestamptz not null default now(),
  primary key (player_slug, draft_year)
);

-- One snapshot per player per scrape run; powers the riser/faller arrows.
create table if not exists rank_history (
  id bigint generated always as identity primary key,
  player_slug text not null,
  draft_year int not null,
  display_rank int not null,
  consensus_score numeric not null,
  scraped_on date not null default current_date,
  unique (player_slug, draft_year, scraped_on)
);

create index if not exists rank_history_lookup
  on rank_history (player_slug, draft_year, scraped_on desc);

-- What the app reads: current board + movement vs. the previous snapshot.
-- rank_change > 0 means the player rose (show a green ▲), < 0 fell (red ▼),
-- 0 held steady, null means new to the board (show "NEW").
create or replace view prospect_board
with (security_invoker = on) as
select
  r.player_slug,
  r.draft_year,
  r.full_name,
  r.position,
  r.school,
  r.team,
  r.display_rank,
  r.updated_at,
  prev.display_rank - r.display_rank as rank_change
from prospect_rankings r
left join lateral (
  select h.display_rank
  from rank_history h
  where h.player_slug = r.player_slug
    and h.draft_year = r.draft_year
    and h.scraped_on < (
      select max(scraped_on) from rank_history
      where player_slug = r.player_slug and draft_year = r.draft_year
    )
  order by h.scraped_on desc
  limit 1
) prev on true;

-- ESPN athlete id mapping, resolved automatically by roster name-match.
create table if not exists player_ids (
  player_slug text primary key,
  espn_college_id text,
  espn_nba_id text,
  resolved_at timestamptz not null default now()
);

-- Recent game lines pulled from ESPN's public APIs (college gamelogs,
-- Las Vegas Summer League box scores, NBA gamelogs once the season starts).
create table if not exists recent_games (
  id bigint generated always as identity primary key,
  player_slug text not null,
  competition text not null, -- 'college' | 'summer-league' | 'nba'
  game_date date not null,
  opponent text,
  minutes int,
  points int,
  rebounds int,
  assists int,
  steals int,
  blocks int,
  turnovers int,
  fg text,   -- "6-9"
  fg3 text,  -- "1-2"
  ft text,   -- "3-3"
  synced_at timestamptz not null default now(),
  unique (player_slug, competition, game_date)
);

create index if not exists recent_games_lookup
  on recent_games (player_slug, game_date desc);

-- What the app reads for the "Recent games" card section: newest 3 per player
-- across all competitions.
create or replace view player_last_games
with (security_invoker = on) as
select * from (
  select rg.*, row_number() over (partition by player_slug order by game_date desc) as game_no
  from recent_games rg
) g
where game_no <= 3;

-- The app reads with the anon key; only the service role (the weekly job) writes.
alter table prospect_rankings enable row level security;
alter table rank_history enable row level security;
alter table player_ids enable row level security;
alter table recent_games enable row level security;

drop policy if exists "public read player_ids" on player_ids;
create policy "public read player_ids" on player_ids
  for select using (true);

drop policy if exists "public read recent_games" on recent_games;
create policy "public read recent_games" on recent_games
  for select using (true);

drop policy if exists "public read rankings" on prospect_rankings;
create policy "public read rankings" on prospect_rankings
  for select using (true);

drop policy if exists "public read history" on rank_history;
create policy "public read history" on rank_history
  for select using (true);
