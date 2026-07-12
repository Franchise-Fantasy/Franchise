-- SQL mirror of the slate-day helpers in utils/leagueTime.ts.
--
-- The roster RPCs added alongside this migration need "what league day is it"
-- server-side. Taking that date as a client-supplied argument would be both a
-- correctness risk (a stale client clock writes lineup rows on the wrong day)
-- and a SECURITY DEFINER hazard — the drop path does
-- `DELETE FROM daily_lineups WHERE lineup_date > <today>`, so a caller who could
-- choose <today> could aim that DELETE anywhere. Computing it here removes the
-- parameter entirely.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- PAIRED LOGIC (pattern c) — keep in sync with sportSlateDate / getSportToday /
-- nextSlateRollover in utils/leagueTime.ts. Guarded by the parity test in
-- __tests__/mutations/roster-moves/slate-date-parity.test.ts, which feeds the
-- same moments through both sides and asserts equal output. If you change
-- ROLLOVER_HOUR or SPORT_TIMEZONE there, change it here too.
-- ─────────────────────────────────────────────────────────────────────────────

-- The league day rolls over at 05:00 in the sport's TZ, so anything before 5am
-- belongs to the previous slate (a 10pm ET tip that ends past midnight still
-- groups with that night's games). Subtracting 5h from the ET wall clock and
-- truncating to a date expresses exactly that, and `AT TIME ZONE` is DST-aware.
--
-- Every sport in SPORT_TIMEZONE currently maps to America/New_York, so this
-- takes no sport argument. If a sport's TZ ever diverges, add one here and in
-- getSportTimezone together.
CREATE OR REPLACE FUNCTION public.sport_slate_date(p_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT (((p_at AT TIME ZONE 'America/New_York') - interval '5 hours'))::date;
$$;

-- Exact moment of the next 05:00 ET rollover. Used for `pending_transactions.
-- execute_after`, deferred `acquired_at`, and waiver expiry, so every GM sees a
-- queued move land at the same wall-clock instant regardless of their own TZ.
--
-- Building the timestamp as a plain `timestamp` (wall clock) and then applying
-- AT TIME ZONE resolves 05:00 ET to 09:00 UTC in EDT and 10:00 UTC in EST,
-- matching nextSlateRollover's DST probe.
CREATE OR REPLACE FUNCTION public.next_slate_rollover(p_at timestamptz DEFAULT now())
RETURNS timestamptz
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT ((public.sport_slate_date(p_at) + 1)::timestamp + interval '5 hours')
           AT TIME ZONE 'America/New_York';
$$;

-- Pure date math on caller-supplied input; safe for anyone to call, and the
-- roster RPCs (SECURITY DEFINER, owned by postgres) call them internally.
GRANT EXECUTE ON FUNCTION public.sport_slate_date(timestamptz) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.next_slate_rollover(timestamptz) TO anon, authenticated, service_role;
