-- Historical standings imports (screenshot OCR + manual entry) had no way to
-- record which division a team belonged to in a past season, so a league
-- with two divisions lost that split the moment history was saved — every
-- team was flattened into one undifferentiated list. Mirrors teams.division
-- (1 or 2, nullable — most leagues have no divisions).
alter table team_seasons
  add column division smallint;

comment on column team_seasons.division is
  'Division the team played in that season (1 or 2), matching teams.division. Null if the league had no divisions that season.';
