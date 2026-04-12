-- Enforce that every team has a valid tricode (2-4 chars, uppercase A-Z 0-9).
--
-- Backfills any legacy NULL or invalid tricodes by deriving 3 chars from the
-- team name, then adds a NOT NULL constraint and a check constraint that
-- matches the client-side validation in app/create-team.tsx and
-- app/league-info.tsx.

-- 1. Backfill NULL tricodes from team name (strip non-alphanumerics, take 3 chars, uppercase).
UPDATE teams
SET tricode = UPPER(SUBSTRING(REGEXP_REPLACE(name, '[^A-Za-z0-9]', '', 'g'), 1, 3))
WHERE tricode IS NULL;

-- 2. Fallback for teams whose name derives to <2 chars (e.g. "A!" or "---"):
--    use 'T' + first 2 chars of the id (uuid), uppercased.
UPDATE teams
SET tricode = UPPER('T' || SUBSTRING(id::text, 1, 2))
WHERE tricode IS NULL OR LENGTH(tricode) < 2;

-- 3. Normalize any existing tricodes that don't match the expected format
--    (lowercase, contain punctuation, too long) so the check constraint can be added.
UPDATE teams
SET tricode = UPPER(SUBSTRING(REGEXP_REPLACE(tricode, '[^A-Za-z0-9]', '', 'g'), 1, 4))
WHERE tricode !~ '^[A-Z0-9]{2,4}$';

-- Second pass for anything that normalized to <2 chars.
UPDATE teams
SET tricode = UPPER('T' || SUBSTRING(id::text, 1, 2))
WHERE LENGTH(COALESCE(tricode, '')) < 2;

-- 4. Enforce NOT NULL.
ALTER TABLE teams
  ALTER COLUMN tricode SET NOT NULL;

-- 5. Enforce format with a check constraint matching client validation.
ALTER TABLE teams
  ADD CONSTRAINT teams_tricode_format_check
  CHECK (tricode ~ '^[A-Z0-9]{2,4}$');
