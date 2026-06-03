# Projections engine

Python Bayesian projection engine, vendored into the app repo so it runs from
GitHub Actions against the live Franchise Supabase DB. **CI-only** — none of
this ships in the React Native bundle.

## Files

| File | Role |
|------|------|
| `franchise_project.py` | **Entry point.** Orchestrates a run and writes to `player_projections`. |
| `franchise_db.py` | Franchise Supabase data adapter (reads `player_games` / `game_schedule` / `players`, writes `player_projections`). |
| `project.py` | Upstream engine — hierarchical Negative-Binomial model (ROS). Pure model functions reused as-is. |
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
- **Per-game context (ROS):** home/away and opponent ARE used. They're derived
  from the immutable `player_games.matchup` (`'vs XXX'`=home, `'@XXX'`=away)
  joined to `game_schedule` — trade-safe, never from the mutable
  `players.pro_team`. So `is_home`/`is_b2b` effects are learned and each
  training observation is de-biased for opponent strength
  (`compute_opp_factors` reconstructs "stats allowed" by summing the box scores
  of players who faced each team, since Franchise has no team box-score table).
  The projection itself uses a neutral opponent + half-home, which is correct
  for a rest-of-season line (an average remaining slate). Still deferred:
  archetype clustering and Vegas-props (`next_game`) blending.

## Run locally

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
export PG_DSN="postgresql://...see Connection string below..."

# In-season rest-of-season (daily):
./venv/bin/python franchise_project.py --sport wnba --season 2026 --horizon ros

# Pre-season / draft snapshot (scheduled through the offseason):
./venv/bin/python franchise_project.py --sport wnba --season 2027 --horizon season
```

## Connection string (least-privilege)

The engine runs as the dedicated **`projections_engine`** Postgres role created
by migration `20260603000001_projections_engine_role.sql`. That role can only
`SELECT` the four tables it reads (`player_games`, `players`, `game_schedule`,
`season_config`) and `INSERT`/`UPDATE` `player_projections` — nothing else, and
no `DELETE`/DDL. RLS stays on; the role has its own permissive policies.

One-time setup:

1. Set a password (out of band — never commit it):
   ```sql
   ALTER ROLE projections_engine WITH LOGIN PASSWORD '<generated-strong-secret>';
   ```
2. Build `PG_DSN` from the Supabase **Session pooler** string
   (Dashboard → Project Settings → Database → Connection string → "Session"),
   swapping in the role + password. GitHub Actions runners are IPv4, so use the
   pooler host (the direct `db.<ref>.supabase.co` host is IPv6-only). The pooler
   username is role-qualified with the project ref:
   ```
   postgresql://projections_engine.<project-ref>:<password>@<region>.pooler.supabase.com:5432/postgres
   ```
3. Store that as the GitHub `PG_DSN` repo secret
   (Settings → Secrets and variables → Actions → New repository secret).

On the very first run, confirm the role authenticates through the pooler (custom
roles are supported by Supavisor, but verify in the workflow logs). If auth
fails, double-check the `projections_engine.<ref>` username format and that the
password was set with `LOGIN`.
