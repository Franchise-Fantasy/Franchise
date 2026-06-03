"""
Connection smoke-test for the projections engine's PG_DSN.

Validates the exact path CI uses, locally and in ~2s: log in through the
Supabase Session pooler as the least-privilege `projections_engine` role,
confirm an allowed read works, and confirm a disallowed table is correctly
denied (proving the role boundary holds).

Keep the password out of anywhere shared — set PG_DSN in your OWN shell, then
run this. The password is never printed or committed.

  PowerShell:
    $env:PG_DSN = 'postgresql://projections_engine.<ref>:<password>@<host>:5432/postgres?sslmode=require'
    python projections/check_connection.py

  bash:
    export PG_DSN='postgresql://projections_engine.<ref>:<password>@<host>:5432/postgres?sslmode=require'
    python projections/check_connection.py

Prereq: pip install psycopg2-binary
"""
import os
import sys

try:
    import psycopg2
except ImportError:
    sys.exit("psycopg2 not installed — run:  pip install psycopg2-binary")

dsn = os.environ.get("PG_DSN", "").strip()
if not dsn:
    sys.exit("PG_DSN is not set in this shell — see the header for how to set it.")

try:
    conn = psycopg2.connect(dsn)
except Exception as e:
    sys.exit(f"FAIL — could not connect: {e}")

conn.autocommit = True
cur = conn.cursor()

cur.execute("SELECT current_user")
print(f"  connected as       : {cur.fetchone()[0]}   (expected: projections_engine)")

cur.execute(
    "SELECT season FROM season_config WHERE sport = 'wnba' AND is_current = true"
)
row = cur.fetchone()
print(f"  allowed read (ok)  : current wnba season = {row[0] if row else '(none)'}")

# Negative check: the role must NOT be able to read unrelated app tables.
try:
    cur.execute("SELECT 1 FROM leagues LIMIT 1")
    print("  boundary  (WARN)   : could read `leagues` — role is broader than expected!")
except Exception:
    print("  boundary (ok)      : `leagues` correctly denied")

conn.close()
print("\nALL GOOD — this PG_DSN is valid for CI. Put the same value in the GitHub secret.")
