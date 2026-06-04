# Projections engine

Python Bayesian projection engine, vendored into the app repo so it runs from
GitHub Actions against the live Franchise Supabase DB. **CI-only** — none of
this ships in the React Native bundle.

## Files

| File | Role |
|------|------|
| `franchise_project.py` | **Entry point.** Orchestrates a run and writes to `player_projections`. Horizons: `next_game` (in-season) and `season` (offseason). |
| `franchise_db.py` | Franchise Supabase data adapter (reads `player_games` / `game_schedule` / `players` / `player_archetypes`, writes `player_projections`). |
| `franchise_archetype.py` | K-means role clustering → `player_archetypes` (the model's archetype prior). Port of the source `archetype.py`. |
| `project.py` | Upstream engine — hierarchical Negative-Binomial model (game-by-game). Pure model functions reused as-is. |
| `season_project.py` | Upstream engine — pre-season snapshot model. Pure functions reused as-is. |

`project.py` / `season_project.py` are vendored copies of the standalone
engine (originally `~/Downloads/wnba-engine`). We only import their pure model
functions; all DB access goes through `franchise_db.py`. Keep them in sync with
upstream if the model math changes — the franchise glue doesn't touch the math.

## How it differs from the standalone engine

- **Data source:** the live Franchise tables, not the engine's own BDL ingest.
  The app already syncs WNBA box scores, so there's no duplicate ingestion.
- **Player IDs:** Franchise UUIDs (remapped to integer indices for the model,
  mapped back before writing).
- **Output:** the Franchise `player_projections` table. Fantasy points are NOT
  written — they're league-specific and computed client-side in the app.
- **Per-game context (next_game):** home/away and opponent are derived from the
  immutable `player_games.matchup` (`'vs XXX'`=home, `'@XXX'`=away) joined to
  `game_schedule` — trade-safe, never from the mutable `players.pro_team`. Each
  training observation is de-biased for opponent strength (`compute_opp_factors`
  reconstructs "stats allowed" by summing the box scores of players who faced
  each team, since Franchise has no team box-score table), and the projection is
  tilted toward each player's ACTUAL next matchup via
  `franchise_db.load_upcoming_context` (next opponent + venue + back-to-back).
- **Archetypes:** `franchise_archetype.py` k-means-clusters players into role
  tiers (6 clusters) feeding the model's hierarchical prior — without them the
  shrinkage drags every starter toward the bench average. Still deferred:
  Vegas-props blending.

## Run locally

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
export PG_DSN="postgresql://...see Connection string below..."

# In-season game-by-game (daily) — cluster archetypes first, then project:
./venv/bin/python franchise_archetype.py --sport wnba --season 2026
./venv/bin/python franchise_project.py --sport wnba --season 2026 --horizon next_game

# Pre-season / draft snapshot (scheduled through the offseason):
./venv/bin/python franchise_project.py --sport wnba --season 2027 --horizon season
```

## Connection string (least-privilege)

The engine connects directly as the dedicated **`projections_engine`** role
created by migration `20260603000001_projections_engine_role.sql`. That role can
only `SELECT` the four tables it reads (`player_games`, `players`,
`game_schedule`, `season_config`) and `INSERT`/`UPDATE` `player_projections` —
nothing else, no `DELETE`/DDL. RLS stays on; the role has its own permissive
policies. So if the secret ever leaks, the blast radius is exactly those five
tables — never `postgres`.

GitHub Actions runners are IPv4-only, so use the Supabase **Session pooler** (the
direct `db.<ref>.supabase.co` host is IPv6-only). The shared pooler authenticates
any database role, including this one, via the role-qualified username
`projections_engine.<project-ref>`.

One-time setup:

1. Set a password (out of band — never commit it):
   ```sql
   ALTER ROLE projections_engine WITH LOGIN PASSWORD '<generated-strong-secret>';
   ```
2. Build `PG_DSN` from the **Session pooler** string (Dashboard → Connect →
   Session pooler), swapping in the role + password:
   ```
   postgresql://projections_engine.<project-ref>:<password>@<host>:5432/postgres?sslmode=require
   ```
   ⚠️ **Use the EXACT host from that dialog.** Supabase assigns each project to a
   specific shared-pooler instance (`aws-0-…`, `aws-1-…`, …); hitting the wrong
   one fails with `FATAL (ENOTFOUND) tenant/user … not found` even when the
   username + password are correct. For this project the host is
   **`aws-1-us-east-2.pooler.supabase.com`**. (To identify the right host without
   a password: connect with a bogus one — the correct host replies `password
   authentication failed`, a wrong host replies `tenant/user not found`.)
3. Store that as the GitHub `PG_DSN` repo secret (Settings → Secrets and
   variables → Actions). Paste with **no trailing newline** — `franchise_db` /
   `resolve_phase` also `.strip()` it defensively, since a stray newline folds
   into the last DSN value (`invalid sslmode value: "require\n"`).

Smoke-test the string locally before trusting CI: set `PG_DSN` in your shell and
run `python projections/check_connection.py`.
