-- NFL positions in position_limit_match_keys. NFL tokens (QB/RB/WR/TE/K/DST)
-- are DISJOINT categories, not a spectrum — a player counts only toward the
-- limit key of their primary token, with no between-positions expansion and
-- no bare-letter parents. Mirrors the DISJOINT_POSITION_TOKENS branch added
-- to getLimitMatchKeys on the TS side in the same change.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PAIRED LOGIC — keep in sync with getLimitMatchKeys / POSITION_TOKEN_RANGES /
-- POSITION_SPECTRUM / DISJOINT_POSITION_TOKENS in
-- utils/roster/rosterSlotsShared.ts. Returns every limit key a player position
-- counts toward, based on ONLY the primary (first-listed) token: NFL tokens
-- return themselves; basketball tokens return their spectrum span plus its
-- bare-letter parent (G covers PG/SG, F covers SF/PF) so one check handles
-- NBA (PG/SG/SF/PF/C), WNBA (G/F/C), and NFL (QB/RB/WR/TE/K/DST) limit
-- configs. If you change the token sets on the TS side, change them here too —
-- gated by __tests__/mutations/roster-moves/position-limits.test.ts.
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

  -- Disjoint NFL tokens count only toward their own limit key.
  IF primary_tok IN ('QB', 'RB', 'WR', 'TE', 'K', 'DST') THEN
    RETURN ARRAY[primary_tok];
  END IF;

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
