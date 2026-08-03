"""
One-time backfill of prior-season NBA per-game box scores into Franchise.

The NBA sibling of backfill_wnba_game_logs.py. Franchise retains only the live
NBA season in `player_games` (2025-26), which starves the projections engine:
a held-out backtest (2026-08-02) measured the jump from ONE training season to
TWO at -0.34 per-game fantasy RMSE — roughly double the gain of every model
change shipped in franchise-v1.4 — with the curve flattening after ~3 seasons.
This pulls the missing history from Ball Don't Lie so the season snapshot has
real priors instead of a single year.

No tier upgrade is needed: /v1/stats serves box scores back to at least 2005 on
the ALL-STAR key we already hold (verified 2026-08-02). It is rate limited to
60 req/min, hence the ~1.1s pacing — an NBA season costs ~7 minutes.

Divergences from the WNBA script (BDL is NOT symmetric across sports — these
are the traps):
  - endpoints are /v1/stats and /v1/teams, not /wnba/v1/player_stats
  - the game object uses home_team_score / visitor_team_score, where WNBA uses
    home_score / away_score
  - /v1/stats embeds the FULL game object (both team ids, both scores, date,
    status, postseason), so `game_schedule` is built from the same stream and
    costs zero extra requests — only a one-off /v1/teams call is needed to turn
    team ids into tricodes
  - `season` in game_schedule is the NBA label 'YYYY-YY' (season_windows
    .season_label), never the bare start year — the app pins
    .eq('season', getCurrentSeason(sport))
  - pre-2019 seasons express DNPs as all-null rows; rows with no `min` are
    skipped rather than written as zeros

Writes three tables, all idempotent (safe to re-run, resumable per season):
  - players       : creates any BDL player not already present (retired players
                    from old seasons), keyed by (sport, external_id_bdl).
                    Also fills draft_year, which the experience curve reads.
  - game_schedule : one row per regular-season game.
  - player_games  : one row per player per game, with the SAME `matchup` string
                    the live pipeline writes ('vs XXX' home / '@XXX' away) so
                    the engine's home/opponent derivation is unchanged.

Postseason is excluded at the API (postseason=false), matching the live
pipeline (poll-live-stats writes status===3 && !postseason) and the engine's
regular-season-only season windows.

This is admin tooling — run it manually with privileged creds, not on a cron.
It is NOT the least-privilege `projections_engine` role (that role only reads
these tables); creating players + writing schedule needs the service key.

Env:
  BDL_API_KEY   Ball Don't Lie key (ALL-STAR is sufficient for /v1/stats)
  SB_SECRET_KEY Supabase service-role key

Usage:
  python backfill_nba_game_logs.py --dry-run           # fetch + report only
  python backfill_nba_game_logs.py                     # 2019-2024
  python backfill_nba_game_logs.py --seasons 2023 2024 # subset
"""
import argparse
import os
import time
import uuid
from typing import Iterator

import requests
from supabase import create_client

# Load the gitignored .env.local at the repo root (one level up from backend/).
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

# BDL season year N == the N/N+1 NBA season (2019 -> '2019-20'). 2025-26 is
# already in Franchise from the live pipeline, so the backfill stops at 2024.
DEFAULT_SEASONS = [2019, 2020, 2021, 2022, 2023, 2024]
PAGE_SIZE = 100
BATCH = 500
RATE_PER_SEC = 55 / 60  # ALL-STAR = 60/min; pace at 55 for headroom

# Retired players must NOT land in the free-agent pool. The live NBA roster is
# maintained by sync-players, which sets status='active' and a real pro_team;
# backfilled players are historical records only.
BACKFILL_STATUS = "retired"

sb = create_client(SUPABASE_URL, SB_SECRET_KEY)


def season_label(start_year: int) -> str:
    """'2019-20' — mirrors projections/season_windows.season_label('nba', y)."""
    return f"{start_year}-{(start_year + 1) % 100:02d}"


# ── BDL client (token-bucket rate limit + retry) ─────────────────────────────

class RateLimiter:
    def __init__(self, rate_per_sec: float, capacity: int = 10):
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
    """GET with rate limiting and retries.

    429 backoff starts at 15s because the NBA budget is a 60-request-per-MINUTE
    window — a 3s retry can't outlast it. TRANSPORT errors (read timeout, SSL
    handshake timeout, connection reset) are retried too: a full backfill is
    ~2,500 requests over ~45 minutes, so a transient blip is a certainty, not
    an edge case, and an unretried one killed the first 2024-25 run outright.
    """
    limiter.acquire()
    url = f"{BDL_BASE}{path}"
    for attempt in range(retries):
        try:
            r = requests.get(url, params=params,
                             headers={"Authorization": BDL_API_KEY}, timeout=60)
        except requests.RequestException as exc:
            wait = 2 ** attempt
            print(f"    ! network error ({type(exc).__name__}), "
                  f"retry {attempt + 1}/{retries} in {wait}s")
            time.sleep(wait)
            continue
        if r.status_code == 429:
            time.sleep(15 * (2 ** attempt))
            continue
        if r.status_code >= 500:
            time.sleep(2 ** attempt)
            continue
        r.raise_for_status()
        return r.json()
    raise RuntimeError(f"BDL failed {path} after {retries} retries")


def paginate_pages(path: str, params: dict) -> Iterator[list]:
    """Yield one PAGE (list of rows) at a time, so callers can flush to the DB
    incrementally instead of holding a whole season in memory."""
    params = {**params, "per_page": PAGE_SIZE}
    cursor = None
    while True:
        if cursor is not None:
            params["cursor"] = cursor
        resp = bdl_get(path, params)
        yield resp.get("data", [])
        cursor = resp.get("meta", {}).get("next_cursor")
        if not cursor:
            return


def paginate(path: str, params: dict) -> Iterator[dict]:
    for page in paginate_pages(path, params):
        for row in page:
            yield row


# ── helpers ──────────────────────────────────────────────────────────────────

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
    """external_id_bdl (int) -> player UUID, for sport='nba'."""
    lookup, offset = {}, 0
    while True:
        res = (
            sb.table("players")
            .select("id, external_id_bdl")
            .eq("sport", "nba")
            .range(offset, offset + 999)
            .execute()
        )
        for row in res.data:
            if row["external_id_bdl"] is not None:
                lookup[int(row["external_id_bdl"])] = row["id"]
        if len(res.data) < 1000:
            return lookup
        offset += 1000


def build_name_to_uuid() -> dict:
    """normalized name -> uuid, for NBA players who have NO external_id_bdl yet.

    Prevents creating a DUPLICATE row for someone already in `players` under a
    different id source. Deliberately narrow: prospects are excluded (a draft
    prospect sharing a name with a 2019 pro is a different person), and any
    name held by more than one row is dropped as ambiguous rather than guessed.
    Only ever adopts rows whose external_id_bdl is NULL, so it cannot overwrite
    a correct id — the failure mode that bit sync_nba_ids.py.
    """
    rows, offset = [], 0
    while True:
        res = (
            sb.table("players")
            .select("id, name, status, external_id_bdl")
            .eq("sport", "nba")
            .is_("external_id_bdl", "null")
            .range(offset, offset + 999)
            .execute()
        )
        rows.extend(res.data)
        if len(res.data) < 1000:
            break
        offset += 1000
    counts, lookup = {}, {}
    for r in rows:
        if r.get("status") == "prospect":
            continue
        key = " ".join((r.get("name") or "").split()).lower()
        if not key:
            continue
        counts[key] = counts.get(key, 0) + 1
        lookup[key] = r["id"]
    return {k: v for k, v in lookup.items() if counts[k] == 1}


def fetch_team_tricodes() -> dict:
    """BDL team id -> tricode. /v1/stats' embedded game carries only team IDs.

    Keyed by ID on purpose: BDL returns 45 teams including defunct franchises,
    and 'WAS' is held by both the Wizards (30) and the 1946-51 Capitols (42).
    """
    return {t["id"]: t["abbreviation"] for t in paginate("/v1/teams", {})}


# ── per-season backfill ──────────────────────────────────────────────────────

# Rows buffered before each DB flush. A season is ~40k rows / ~400 requests
# over ~7 minutes; flushing every ~5k bounds memory and — more importantly —
# makes progress durable, so a network failure 300 pages in doesn't discard
# everything fetched so far. Every write is an idempotent upsert, so the
# re-run after a failure simply overwrites what landed.
CHUNK_ROWS = 5000


def build_schedule(stats: list, year: int, tricodes: dict) -> tuple:
    """(game_id -> meta, game_schedule rows) derived from the stats stream.

    Every played game has box scores, so this needs no /v1/games pagination.
    """
    meta, rows = {}, {}
    for s in stats:
        g = s.get("game") or {}
        gid = g.get("id")
        if gid is None or gid in meta:
            continue
        home_tri = tricodes.get(g.get("home_team_id"))
        away_tri = tricodes.get(g.get("visitor_team_id"))
        if not home_tri or not away_tri:
            continue
        date = (g.get("date") or "")[:10]
        meta[gid] = {
            "game_id": str(gid), "date": date,
            "home_id": g.get("home_team_id"),
            "home_tri": home_tri, "away_tri": away_tri,
        }
        rows[gid] = {
            "game_id": str(gid), "sport": "nba", "season": season_label(year),
            "game_date": date, "home_team": home_tri, "away_team": away_tri,
            "home_score": g.get("home_team_score"),
            "away_score": g.get("visitor_team_score"),
            "game_time_utc": g.get("datetime"),
            "status": "final" if g.get("status") in ("Final", "post") else "scheduled",
        }
    return meta, list(rows.values())


def ensure_players(stats: list, bdl_to_uuid: dict, name_to_uuid: dict,
                   dry_run: bool) -> tuple:
    """Resolve every BDL player to a Franchise UUID, creating rows as needed.
    Mutates bdl_to_uuid (and consumes name_to_uuid). Returns (created, adopted).

    Created rows are marked BACKFILL_STATUS (not 'active') and carry NO
    pro_team: these are historical records, and a retired player appearing in a
    live free-agent pool or search would be a visible bug. A name match against
    an id-less existing row is ADOPTED instead of duplicated.
    """
    new_rows, adopted, seen = [], [], set()
    for s in stats:
        p = s.get("player") or {}
        pid = p.get("id")
        if pid is None or pid in bdl_to_uuid or pid in seen:
            continue
        seen.add(pid)
        name = f"{p.get('first_name', '').strip()} {p.get('last_name', '').strip()}".strip()
        if not name:
            continue
        draft_year = p.get("draft_year")
        existing = name_to_uuid.pop(" ".join(name.split()).lower(), None)
        if existing:
            adopted.append({"id": existing, "external_id_bdl": pid})
            bdl_to_uuid[pid] = existing
            continue
        new_rows.append({
            "id": str(uuid.uuid4()),
            "name": name,
            "sport": "nba",
            "position": p.get("position") or None,
            "external_id_bdl": pid,
            "draft_year": int(draft_year) if draft_year else None,
            "status": BACKFILL_STATUS,
        })
    if not dry_run:
        for i in range(0, len(new_rows), BATCH):
            sb.table("players").insert(new_rows[i:i + BATCH]).execute()
        for a in adopted:
            sb.table("players").update(
                {"external_id_bdl": a["external_id_bdl"]}).eq("id", a["id"]).execute()
    for r in new_rows:
        bdl_to_uuid[r["external_id_bdl"]] = r["id"]
    return len(new_rows), len(adopted)


def build_player_games(stats: list, meta: dict, bdl_to_uuid: dict) -> tuple:
    rows, skipped, dnp = [], 0, 0
    for s in stats:
        p = s.get("player") or {}
        g = meta.get((s.get("game") or {}).get("id"))
        uuid_ = bdl_to_uuid.get(p.get("id"))
        if g is None or uuid_ is None:
            skipped += 1
            continue
        # Pre-2019 seasons return all-null rows for DNPs. A missing `min` is
        # the clean signal — writing them as zeros would add hundreds of
        # thousands of rows carrying no information.
        if s.get("min") in (None, ""):
            dnp += 1
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
            "matchup": matchup, "sport": "nba",
            "min": parse_minutes(s.get("min")),
            "pts": pts, "reb": reb, "ast": ast, "stl": stl, "blk": blk,
            "tov": s.get("turnover") or 0,
            "fgm": s.get("fgm") or 0, "fga": s.get("fga") or 0,
            "3pm": s.get("fg3m") or 0, "3pa": s.get("fg3a") or 0,
            "ftm": s.get("ftm") or 0, "fta": s.get("fta") or 0,
            "pf": s.get("pf") or 0,
            "double_double": dd, "triple_double": td,
        })
    return rows, skipped, dnp


def flush_chunk(stats: list, year: int, bdl_to_uuid: dict, name_to_uuid: dict,
                tricodes: dict, dry_run: bool, totals: dict):
    """Resolve players, then write schedule + logs for one buffered chunk.

    Player resolution must run BEFORE build_player_games — that is what puts
    this chunk's new BDL ids into bdl_to_uuid, and a row whose player is
    unresolved is silently dropped as 'unmappable'.
    """
    meta, sched_rows = build_schedule(stats, year, tricodes)
    created, adopted = ensure_players(stats, bdl_to_uuid, name_to_uuid, dry_run)
    pg_rows, skipped, dnp = build_player_games(stats, meta, bdl_to_uuid)

    if not dry_run:
        for i in range(0, len(sched_rows), BATCH):
            sb.table("game_schedule").upsert(
                sched_rows[i:i + BATCH], on_conflict="sport,game_id"
            ).execute()
        for i in range(0, len(pg_rows), BATCH):
            sb.table("player_games").upsert(
                pg_rows[i:i + BATCH], on_conflict="player_id,game_id"
            ).execute()

    # Distinct game ids, not a running sum: a game whose box scores straddle a
    # chunk boundary appears in both chunks and would be double-counted.
    totals["game_ids"].update(r["game_id"] for r in sched_rows)
    totals["created"] += created
    totals["adopted"] += adopted
    totals["logs"] += len(pg_rows)
    totals["dnp"] += dnp
    totals["skipped"] += skipped


def backfill_season(year: int, bdl_to_uuid: dict, name_to_uuid: dict,
                    tricodes: dict, dry_run: bool):
    started = time.monotonic()
    print(f"\n=== NBA {season_label(year)} ===")
    totals = {k: 0 for k in ("created", "adopted", "logs", "dnp", "skipped")}
    totals["game_ids"] = set()
    buf, fetched = [], 0
    for page in paginate_pages("/v1/stats",
                               {"seasons[]": year, "postseason": "false"}):
        buf.extend(page)
        fetched += len(page)
        if len(buf) >= CHUNK_ROWS:
            flush_chunk(buf, year, bdl_to_uuid, name_to_uuid, tricodes,
                        dry_run, totals)
            print(f"    …{fetched} rows fetched, {totals['logs']} logs written "
                  f"({time.monotonic() - started:.0f}s)")
            buf = []
    if buf:
        flush_chunk(buf, year, bdl_to_uuid, name_to_uuid, tricodes, dry_run,
                    totals)

    if fetched == 0:
        print("  no data — skipping")
        return
    print(f"  games {len(totals['game_ids'])} | players created "
          f"{totals['created']} (status={BACKFILL_STATUS}) | "
          f"adopted {totals['adopted']}")
    print(f"  player_games {totals['logs']} "
          f"(skipped {totals['dnp']} DNP, {totals['skipped']} unmappable)")
    print(f"  season done in {time.monotonic() - started:.0f}s")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--seasons", type=int, nargs="+", default=DEFAULT_SEASONS)
    ap.add_argument("--dry-run", action="store_true",
                    help="fetch from BDL and report counts without writing")
    args = ap.parse_args()

    print("Building BDL id -> player UUID map (nba)...")
    bdl_to_uuid = build_bdl_to_uuid()
    print(f"  {len(bdl_to_uuid)} existing players mapped")
    name_to_uuid = build_name_to_uuid()
    print(f"  {len(name_to_uuid)} id-less players adoptable by name")
    tricodes = fetch_team_tricodes()
    print(f"  {len(tricodes)} team tricodes")

    for yr in args.seasons:
        backfill_season(yr, bdl_to_uuid, name_to_uuid, tricodes, args.dry_run)

    print("\nDone." + (" (dry run — nothing written)" if args.dry_run else ""))
