"""
Backfill total_dd / total_td onto NBA player_historical_stats rows.

player_historical_stats for older NBA seasons was created by
backfill_historical_stats.py, which pulls PER-GAME AVERAGES from nba_api's
PlayerCareerStats — an endpoint that has no double/triple-double counts. So
those rows shipped with total_dd = total_td = 0, and every FPTS/G shown for
that season silently omits the DD/TD scoring bonus (a ~9 FPTS/G miss for a
double-double machine in a 5/10 league).

DD/TD are per-GAME events and can't be derived from season averages, and — unlike
recent seasons — these seasons have no rows in player_games to recompute from
(archive_season_player_stats can't help). But stats.nba.com's
leaguedashplayerstats exposes the season DD2 / TD3 counts directly, in a single
call per season. This fetches those and UPDATEs the existing historical rows in
place (averages untouched — only the two count columns).

DD2 counts games with a double-double INCLUDING triple-doubles, matching how the
app scores them (a triple-double game earns both the DD and TD bonus — same as
the live poll-live-stats double_double flag and ESPN's scoring).

Official stats.nba.com is an allowed data source. Idempotent — safe to re-run.

Env (from repo-root .env.local, same as the other backfills):
  SB_SECRET_KEY   Supabase service-role key

Usage:
  python backfill_nba_historical_ddtd.py                    # 2024-25
  python backfill_nba_historical_ddtd.py --season 2023-24
  python backfill_nba_historical_ddtd.py --dry-run          # fetch + report only
"""
import argparse
import os
import time

from nba_api.stats.endpoints import leaguedashplayerstats
from supabase import create_client

# Load the gitignored .env.local at the repo root (one level up from backend/).
try:
    from dotenv import load_dotenv

    _ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    load_dotenv(os.path.join(_ROOT, ".env.local"))
    load_dotenv(os.path.join(_ROOT, ".env"))
except ImportError:
    pass

SB_SECRET_KEY = os.environ["SB_SECRET_KEY"]
SUPABASE_URL = "https://iuqbossmnsezzgocpcbo.supabase.co"

sb = create_client(SUPABASE_URL, SB_SECRET_KEY)


def fetch_ddtd(season: str) -> dict:
    """nba_id (int) -> (dd2, td3) for the season's regular-season totals."""
    for attempt in range(5):
        try:
            res = leaguedashplayerstats.LeagueDashPlayerStats(
                season=season,
                season_type_all_star="Regular Season",
                per_mode_detailed="Totals",
                timeout=60,
            ).get_dict()
            break
        except Exception as e:  # stats.nba.com throttles/times out intermittently
            if attempt == 4:
                raise
            print(f"  retry {attempt + 1} after error: {e}")
            time.sleep(3 * (attempt + 1))
    rs = res["resultSets"][0]
    h = rs["headers"]
    i_id, i_dd, i_td = h.index("PLAYER_ID"), h.index("DD2"), h.index("TD3")
    out = {}
    for row in rs["rowSet"]:
        out[int(row[i_id])] = (int(row[i_dd] or 0), int(row[i_td] or 0))
    return out


def nba_id_to_uuid() -> dict:
    """external_id_nba (int) -> player UUID, for sport='nba'."""
    lookup, offset = {}, 0
    while True:
        res = (
            sb.table("players")
            .select("id, external_id_nba")
            .eq("sport", "nba")
            .not_.is_("external_id_nba", "null")
            .range(offset, offset + 999)
            .execute()
        )
        for r in res.data:
            lookup[int(r["external_id_nba"])] = r["id"]
        if len(res.data) < 1000:
            return lookup
        offset += 1000


def existing_rows(season: str) -> list:
    """player_id UUIDs that already have an NBA historical row for the season."""
    ids, offset = [], 0
    while True:
        res = (
            sb.table("player_historical_stats")
            .select("player_id")
            .eq("sport", "nba")
            .eq("season", season)
            .range(offset, offset + 999)
            .execute()
        )
        ids.extend(r["player_id"] for r in res.data)
        if len(res.data) < 1000:
            return ids
        offset += 1000


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", default="2024-25")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print(f"=== NBA {args.season} DD/TD backfill ===")
    ddtd = fetch_ddtd(args.season)
    print(f"  leaguedashplayerstats players: {len(ddtd)}")

    uuid_by_nba = nba_id_to_uuid()
    print(f"  players with external_id_nba: {len(uuid_by_nba)}")

    rows = existing_rows(args.season)
    print(f"  existing historical rows: {len(rows)}")

    # Reverse the uuid map so we can look up each historical row's nba id.
    nba_by_uuid = {v: k for k, v in uuid_by_nba.items()}

    updated = matched_dd = unmatched = 0
    for player_uuid in rows:
        nba_id = nba_by_uuid.get(player_uuid)
        counts = ddtd.get(nba_id) if nba_id is not None else None
        if counts is None:
            unmatched += 1
            continue
        dd, td = counts
        if dd > 0 or td > 0:
            matched_dd += 1
        if not args.dry_run:
            (
                sb.table("player_historical_stats")
                .update({"total_dd": dd, "total_td": td})
                .eq("player_id", player_uuid)
                .eq("season", args.season)
                .eq("sport", "nba")
                .execute()
            )
        updated += 1

    print(
        f"\nDone. rows updated: {updated}, with DD/TD>0: {matched_dd}, "
        f"unmatched (no stats.nba.com row): {unmatched}"
        + (" (dry run — nothing written)" if args.dry_run else "")
    )


if __name__ == "__main__":
    main()
