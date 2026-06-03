"""
Resolve whether a projection run should fire today, and for which season.

Reads season_config (sport='wnba') and prints either the integer target season
to stdout (run should proceed) or 'SKIP' (out of phase). Used by the GitHub
Actions workflows to keep the daily ROS job and the offseason snapshot job from
ever running at the same time:

  ros    -> fires only while today is within [start_date, end_date] of the
            current season.
  season -> fires only during the offseason/preseason, targeting the next
            season whose opening night (start_date) is still in the future.

Usage: python resolve_phase.py <ros|season>
"""
import os
import sys
from datetime import date

import psycopg2

HORIZON = sys.argv[1] if len(sys.argv) > 1 else "ros"
SPORT = "wnba"


def main():
    today = date.today()
    # .strip() — a hand-pasted secret often carries a trailing newline, which
    # psycopg2 folds into the last DSN value (invalid sslmode value: "require\n").
    conn = psycopg2.connect(os.environ["PG_DSN"].strip())
    try:
        cur = conn.cursor()
        if HORIZON == "ros":
            cur.execute(
                """SELECT season, start_date, end_date FROM season_config
                   WHERE sport = %s AND is_current = true LIMIT 1""",
                (SPORT,),
            )
            row = cur.fetchone()
            if row and row[1] and row[2] and row[1] <= today <= row[2]:
                print(int(str(row[0])[:4]))
                return
        else:  # season snapshot — next season not yet opened
            cur.execute(
                """SELECT season FROM season_config
                   WHERE sport = %s AND start_date > %s
                   ORDER BY start_date ASC LIMIT 1""",
                (SPORT, today),
            )
            row = cur.fetchone()
            if row:
                print(int(str(row[0])[:4]))
                return
        print("SKIP")
    finally:
        conn.close()


if __name__ == "__main__":
    main()
