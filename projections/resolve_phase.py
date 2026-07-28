"""
Resolve whether a projection run should fire today, and for which season.

Reads season_config for the given sport and prints either the INTEGER START
YEAR of the target season to stdout (run should proceed) or 'SKIP' (out of
phase). Used by the GitHub Actions workflows to keep the daily game-by-game
job and the offseason snapshot job from ever running at the same time:

  next_game -> fires only while today is within [start_date, end_date] of the
               current season.
  season    -> fires only for the next season whose opening night (start_date)
               is still in the future — which is every day of the year: the
               snapshot keeps refreshing through the offseason so the draft
               board absorbs injuries/trades, and freezes at the last write
               before opening night.

The start year is the engine's internal season key for every sport (2026 =
WNBA '2026' = NBA '2026-27'); franchise_db formats the sport's canonical label
back at write time. parse_start_year handles both label formats.

SKIP reasons go to stderr so a green-but-skipped job log says WHY (a missing
next-season row in season_config is an annual chore, not business as usual —
see the season-rollover runbook).

Usage: python resolve_phase.py <next_game|season> [sport]   (default: wnba)
"""
import os
import sys
from datetime import date

import psycopg2

from season_windows import parse_start_year

HORIZON = sys.argv[1] if len(sys.argv) > 1 else "next_game"
SPORT = sys.argv[2] if len(sys.argv) > 2 else "wnba"


def main():
    today = date.today()
    # .strip() — a hand-pasted secret often carries a trailing newline, which
    # psycopg2 folds into the last DSN value (invalid sslmode value: "require\n").
    conn = psycopg2.connect(os.environ["PG_DSN"].strip())
    try:
        cur = conn.cursor()
        if HORIZON == "next_game":
            cur.execute(
                """SELECT season, start_date, end_date FROM season_config
                   WHERE sport = %s AND is_current = true LIMIT 1""",
                (SPORT,),
            )
            row = cur.fetchone()
            if row and row[1] and row[2] and row[1] <= today <= row[2]:
                print(parse_start_year(row[0]))
                return
            reason = (f"no is_current season_config row for {SPORT}" if not row
                      else f"today outside {SPORT} {row[0]} window "
                           f"({row[1]}..{row[2]})")
        else:  # season snapshot — next season not yet opened
            cur.execute(
                """SELECT season FROM season_config
                   WHERE sport = %s AND start_date > %s
                   ORDER BY start_date ASC LIMIT 1""",
                (SPORT, today),
            )
            row = cur.fetchone()
            if row:
                print(parse_start_year(row[0]))
                return
            reason = (f"no future season_config row for {SPORT} — the annual "
                      f"next-season insert is due (see season-rollover runbook)")
        print(f"SKIP ({HORIZON}/{SPORT}): {reason}", file=sys.stderr)
        print("SKIP")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
