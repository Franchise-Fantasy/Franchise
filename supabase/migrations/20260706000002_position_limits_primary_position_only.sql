-- Position limits should count only a player's PRIMARY (first-listed)
-- position, not every position they're eligible to start at. A "PF-C"
-- player is still eligible to START at C (slot eligibility is unchanged),
-- but shouldn't count against a "max 5 C" roster cap unless C is listed
-- first (e.g. "C-PF"). NBA position strings in this app are entered with
-- the primary position first by convention, so `split('-')[0]` is the
-- primary. This mirrors the TS-side change to getLimitMatchKeys in
-- utils/roster/rosterSlotsShared.ts — keep them in sync.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PAIRED LOGIC — keep in sync with getLimitMatchKeys / POSITION_TOKEN_RANGES /
-- POSITION_SPECTRUM in utils/roster/rosterSlotsShared.ts. Returns every limit
-- key a player position counts toward, based on ONLY the primary (first-listed)
-- token, plus its bare-letter parent (G covers PG/SG, F covers SF/PF) so one
-- check handles both NBA (PG/SG/SF/PF/C) and WNBA (G/F/C) limit configs. If you
-- change the spectrum or token ranges on the TS side, change them here too.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.position_limit_match_keys(p_position text)
RETURNS text[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  spectrum text[] := ARRAY['PG', 'SG', 'SF', 'PF', 'C']; -- 1-based: PG=1 .. C=5
  primary_tok text;
  s int;
  e int;
  eligible text[];
  keys text[];
BEGIN
  IF p_position IS NULL OR p_position = '' THEN
    RETURN ARRAY[]::text[];
  END IF;

  primary_tok := split_part(p_position, '-', 1);
  CASE primary_tok
    WHEN 'PG' THEN s := 1; e := 1;
    WHEN 'SG' THEN s := 2; e := 2;
    WHEN 'SF' THEN s := 3; e := 3;
    WHEN 'PF' THEN s := 4; e := 4;
    WHEN 'C'  THEN s := 5; e := 5;
    WHEN 'G'  THEN s := 1; e := 2; -- WNBA bare guard
    WHEN 'F'  THEN s := 3; e := 4; -- WNBA bare forward
    ELSE s := NULL; e := NULL;
  END CASE;

  IF s IS NULL THEN
    RETURN ARRAY[]::text[];
  END IF;

  eligible := spectrum[s:e];
  keys := eligible;
  -- array_append (not `|| 'G'`) — `text[] || text` is ambiguous and Postgres
  -- mis-resolves it to array||array, trying to parse 'G' as an array literal.
  IF 'PG' = ANY(eligible) OR 'SG' = ANY(eligible) THEN keys := array_append(keys, 'G'); END IF;
  IF 'SF' = ANY(eligible) OR 'PF' = ANY(eligible) THEN keys := array_append(keys, 'F'); END IF;
  RETURN keys;
END;
$$;
