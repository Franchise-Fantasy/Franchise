-- Preserve the team's name AS IT WAS that season (rebrands / owner changes) so
-- league history can show the era name rather than always the team's *current*
-- name. Nullable — old rows and any row without a snapshot fall back to the
-- live teams.name via the team_id FK.
alter table team_seasons
  add column if not exists team_name text;

comment on column team_seasons.team_name is
  'The team''s display name during that season (preserves rebrands / owner changes). Null falls back to the current teams.name via the team_id FK.';
