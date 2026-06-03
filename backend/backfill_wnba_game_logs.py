"""
One-time backfill of prior-season WNBA per-game box scores into Franchise.

The projections engine reads multi-season game logs from `player_games`, but
Franchise only has WNBA 2026 (the live season). This pulls historical seasons
from Ball Don't Lie (GOAT tier — same source the live pipeline uses) and writes
them into the Franchise schema so the ROS model has stronger priors and the
pre-season snapshot has real history to project from.

Writes three tables, all idempotent (safe to re-run):
  - players         : creates any BDL player not already present (retired
                      players from old seasons), keyed by external_id_bdl.
  - game_schedule   : one row per game (game_id = BDL id as text, tricodes,
                      season = calendar year, status='final').
  - player_games    : one row per player per game, with the SAME `matchup`
                      string the live pipeline writes ('vs XXX' home /
                      '@XXX' away) so the engine's home/opponent derivation and
                      every other consumer behave identically.

This is admin tooling — run it manually with privileged creds, not on a cron.
It is NOT the least-privilege `projections_engine` role (that role only reads
these tables); creating players + writing schedule needs the service key.

Env:
  BDL_API_KEY   GOAT-tier Ball Don't Lie key (WNBA player_stats needs GOAT)
  SB_SECRET_KEY Supabase service-role key

Usage:
  python backfill_wnba_game_logs.py                       # 2020-2025
  python backfill_wnba_game_logs.py --seasons 2024 2025   # subset
  python backfill_wnba_game_logs.py --dry-run             # fetch + report only
"""
import argparse
import os
import time
import uuid
from typing import Iterator, Optional

import requests
from supabase import create_client

# Load the gitignored .env.local at the repo root (one level up from backend/)
# so BDL_API_KEY / SB_SECRET_KEY can live there instead of being exported each
# run. Falls back to plain os.environ if python-dotenv isn't installed.
try:
    from dotenv import load_dotenv

    _ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    load_dotenv(os.path.join(_ROOT, ".env.local"))
    load_dotenv(os.path.join(_ROOT, ".env"))
except ImportError:
    pass

BDL_API_KEY = os.environ["BDL_API_KEY"]
SB_SECRET_KEY = os.environ["SB_SECRET_KEY"]
SUPABASE_URL = "https://iuqbossmnsezzgocpcbo.supabase.co"
BDL_BASE = "https://api.balldontlie.io"

DEFAULT_SEASONS = [2020, 2021, 2022, 2023, 2024, 2025]
PAGE_SIZE = 100
BATCH = 500
RATE_PER_SEC = 500 / 60  # GOAT = 600/min; pace at 500 for headroom

sb = create_client(SUPABASE_URL, SB_SECRET_KEY)


# ── BDL client (token-bucket rate limit + retry, ported from the engine) ──────

class RateLimiter:
    def __init__(self, rate_per_sec: float, capacity: int = 30):
        self.rate = rate_per_sec
        self.capacity = capacity
        self.tokens = capacity
        self.last = time.monotonic()

    def acquire(self):
        now = time.monotonic()
        self.tokens = min(self.capacity, self.tokens + (now - self.last) * self.rate)
        self.last = now
        if self.tokens < 1:
            time.sleep((1 - self.tokens) / self.rate)
            self.tokens = 0
        else:
            self.tokens -= 1


limiter = RateLimiter(RATE_PER_SEC)


def bdl_get(path: str, params: dict, retries: int = 7) -> dict:
    limiter.acquire()
    url = f"{BDL_BASE}{path}"
    for attempt in range(retries):
        r = requests.get(url, params=params, headers={"Authorization": BDL_API_KEY}, timeout=30)
        if r.status_code == 429:
            time.sleep(15 * (2 ** attempt))
            continue
        if r.status_code >= 500:
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"BDL failed {path} after {retries} retries")


def paginate(path: str, params: dict) -> Iterator[dict]:
    params = {**params, "per_page": PAGE_SIZE}
    cursor = None
    while True:
        if cursor is not None:
            params["cursor"] = cursor
        resp = bdl_get(path, params)
        for row in resp.get("data", []):
            yield row
        cursor = resp.get("meta", {}).get("next_cursor")
        if not cursor:
            return


# ── helpers ───────────────────────────────────────────────────────────────────

def parse_minutes(raw) -> int:
    if raw is None or raw == "":
        return 0
    s = str(raw)
    if ":" in s:
        m, sec = s.split(":")
        return round(int(m) + int(sec) / 60)
    try:
        return round(float(s))
    except ValueError:
        return 0


def _dd_td(pts, reb, ast, stl, blk):
    n = sum(1 for v in (pts, reb, ast, stl, blk) if (v or 0) >= 10)
    return n >= 2, n >= 3


def build_bdl_to_uuid() -> dict:
    """external_id_bdl (int) -> player UUID, for sport='wnba'."""
    lookup, offset = {}, 0
    while True:
        res = (
            sb.table("players")
            .select("id, external_id_bdl")
            .eq("sport", "wnba")
            .range(offset, offset + 999)
            .execute()
        )
        for row in res.data:
            if row["external_id_bdl"] is not None:
                lookup[int(row["external_id_bdl"])] = row["id"]
        if len(res.data) < 1000:
            return lookup
        offset += 1000


# ── per-season backfill ─────────────────────────────────────────────────────

def fetch_games(year: int) -> dict:
    """bdl_game_id -> game meta. Also upserts game_schedule rows."""
    meta, rows = {}, []
    for g in paginate("/wnba/v1/games", {"seasons[]": year}):
        gid = str(g["id"])
        home, away = g["home_team"], g["visitor_team"]
        # BDL's WNBA games endpoint uses home_score/away_score (NOT
        # *_team_score) and status 'post' for finished games — and returns NULL
        # scores even when final, so scores get backfilled from box-score sums
        # separately. NBA-style "Final" + present scores are also accepted.
        hs, aws = g.get("home_score"), g.get("away_score")
        is_final = g.get("status") in ("post", "Final") or (hs is not None and aws is not None)
        meta[g["id"]] = {
            "game_id": gid,
            "date": (g.get("date") or "")[:10],
            "home_id": home["id"], "away_id": away["id"],
            "home_tri": home["abbreviation"], "away_tri": away["abbreviation"],
            "postseason": bool(g.get("postseason", False)),
        }
        rows.append({
            "game_id": gid, "sport": "wnba", "season": str(year),
            "game_date": meta[g["id"]]["date"],
            "home_team": home["abbreviation"], "away_team": away["abbreviation"],
            "home_score": hs, "away_score": aws,
            "game_time_utc": g.get("datetime"),
            "status": "final" if is_final else "scheduled",
        })
    return meta, rows


def fetch_box_scores(year: int) -> list:
    return list(paginate("/wnba/v1/player_stats", {"seasons[]": year}))


def ensure_players(stats: list, bdl_to_uuid: dict, dry_run: bool) -> int:
    """Create any BDL player missing from `players`. Mutates bdl_to_uuid."""
    new_rows, seen = [], set()
    for s in stats:
        p = s.get("player") or {}
        pid = p.get("id")
        if pid is None or pid in bdl_to_uuid or pid in seen:
            continue
        seen.add(pid)
        name = f"{p.get('first_name', '').strip()} {p.get('last_name', '').strip()}".strip()
        if not name:
            continue
        new_rows.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "sport": "wnba",
            "position": p.get("position") or None,
            "pro_team": (s.get("team") or {}).get("abbreviation"),
            "external_id_bdl": pid,
            "status": "active",
        })
    if new_rows and not dry_run:
        for i in range(0, len(new_rows), BATCH):
            sb.table("players").insert(new_rows[i:i + BATCH]).execute()
    for r in new_rows:
        bdl_to_uuid[r["external_id_bdl"]] = r["id"]
    return len(new_rows)


def build_player_games(stats: list, meta: dict, bdl_to_uuid: dict) -> tuple:
    rows, skipped, postseason = [], 0, 0
    for s in stats:
        p = s.get("player") or {}
        g = meta.get((s.get("game") or {}).get("id"))
        uuid_ = bdl_to_uuid.get(p.get("id"))
        if g is None or uuid_ is None:
            skipped += 1
            continue
        # Match the live pipeline: player_games is regular-season only
        # (poll-live-stats writes status===3 && !postseason).
        if g["postseason"]:
            postseason += 1
            continue
        is_home = (s.get("team") or {}).get("id") == g["home_id"]
        matchup = f"vs {g['away_tri']}" if is_home else f"@{g['home_tri']}"
        pts = s.get("pts") or 0
        reb = s.get("reb") or 0
        ast = s.get("ast") or 0
        stl = s.get("stl") or 0
        blk = s.get("blk") or 0
        dd, td = _dd_td(pts, reb, ast, stl, blk)
        rows.append({
            "player_id": uuid_, "game_id": g["game_id"], "game_date": g["date"],
            "matchup": matchup, "sport": "wnba",
            "min": parse_minutes(s.get("min")),
            "pts": pts, "reb": reb, "ast": ast, "stl": stl, "blk": blk,
            "tov": s.get("turnover") or 0,
            "fgm": s.get("fgm") or 0, "fga": s.get("fga") or 0,
            "3pm": s.get("fg3m") or 0, "3pa": s.get("fg3a") or 0,
            "ftm": s.get("ftm") or 0, "fta": s.get("fta") or 0,
            "pf": s.get("pf") or 0,
            "double_double": dd, "triple_double": td,
        })
    return rows, skipped, postseason


def backfill_season(year: int, bdl_to_uuid: dict, dry_run: bool):
    print(f"\n=== WNBA {year} ===")
    meta, sched_rows = fetch_games(year)
    print(f"  games: {len(sched_rows)}")
    if sched_rows and not dry_run:
        for i in range(0, len(sched_rows), BATCH):
            sb.table("game_schedule").upsert(
                sched_rows[i:i + BATCH], on_conflict="sport,game_id"
            ).execute()

    stats = fetch_box_scores(year)
    print(f"  box-score rows: {len(stats)}")
    created = ensure_players(stats, bdl_to_uuid, dry_run)
    print(f"  players created: {created}")

    pg_rows, skipped, postseason = build_player_games(stats, meta, bdl_to_uuid)
    print(f"  player_games: {len(pg_rows)} (excluded {postseason} postseason, "
          f"{skipped} unmappable)")
    if pg_rows and not dry_run:
        for i in range(0, len(pg_rows), BATCH):
            sb.table("player_games").upsert(
                pg_rows[i:i + BATCH], on_conflict="player_id,game_id"
            ).execute()
            print(f"    upserted {min(i + BATCH, len(pg_rows))}/{len(pg_rows)}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_SEASONS)
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch from BDL and report counts without writing")
    args = ap.parse_args()

    print("Building BDL id -> player UUID map (wnba)...")
    bdl_to_uuid = build_bdl_to_uuid()
    print(f"  {len(bdl_to_uuid)} existing players mapped")

    for yr in args.seasons:
        backfill_season(yr, bdl_to_uuid, args.dry_run)

    print("\nDone." + (" (dry run — nothing written)" if args.dry_run else ""))
