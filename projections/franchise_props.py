"""
Ingest WNBA player props (sportsbook lines) from Ball Don't Lie into the
Franchise `player_props` table, for the next-game projection's market blend.

For each upcoming game it pulls /wnba/v1/odds/player_props, keeps the
points / rebounds / assists / threes lines, takes the MEDIAN across books,
maps the BDL player id to the Franchise UUID (players.external_id_bdl), and
upserts one row per (player, game_date, stat). Runs in the daily workflow
before franchise_project, as the projections_engine role.

The market line already prices in opponent, pace, injuries and current form,
so blending it in is what makes next_game matchup-specific AND accurate.

Env:
  BDL_API_KEY   GOAT-tier key (the odds endpoints require it)
  PG_DSN        projections_engine connection

Usage: python franchise_props.py --sport wnba --season 2026
"""
import argparse
import os
import statistics
import time

import requests
from psycopg2.extras import execute_values

from franchise_db import get_conn

BDL_BASE = "https://api.balldontlie.io"
BDL_API_KEY = os.environ["BDL_API_KEY"]

# BDL prop_type -> Franchise stat. Combo markets (points_rebounds, PRA) and
# double/triple-double markets are ignored — we blend the individual stat lines.
PROP_TO_STAT = {
    "points": "pts",
    "rebounds": "reb",
    "assists": "ast",
    "threes": "3pm",
}


def bdl_get(path: str, params, retries: int = 6) -> dict:
    url = f"{BDL_BASE}{path}"
    for attempt in range(retries):
        r = requests.get(url, params=params, headers={"Authorization": BDL_API_KEY}, timeout=30)
        if r.status_code == 200:
            return r.json()
        if r.status_code in (429, 500, 502, 503, 504):
            time.sleep(min(2 ** attempt, 30))
            continue
        raise RuntimeError(f"BDL {r.status_code} on {path}: {r.text[:200]}")
    raise RuntimeError(f"BDL exhausted retries on {path}")


def bdl_paginate(path: str, params: dict) -> list:
    out, cursor = [], None
    while True:
        p = dict(params)
        p["per_page"] = 100
        if cursor is not None:
            p["cursor"] = cursor
        body = bdl_get(path, p)
        out.extend(body.get("data", []))
        cursor = body.get("meta", {}).get("next_cursor")
        if not cursor:
            return out


def build_bdl_to_uuid(conn, sport: str) -> dict:
    """external_id_bdl (int) -> player UUID for the sport."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT external_id_bdl, id FROM players WHERE sport = %s AND external_id_bdl IS NOT NULL",
            (sport,),
        )
        return {int(b): u for b, u in cur.fetchall()}


def fetch_upcoming_games(sport: str, season: int) -> list:
    """Scheduled (status='pre') games — their lines are live. {id, date(YYYY-MM-DD)}."""
    out = []
    for g in bdl_paginate(f"/{sport}/v1/games", {"seasons[]": season}):
        if g.get("status") == "pre" and g.get("date"):
            out.append({"id": g["id"], "date": g["date"][:10]})
    return out


def run(sport: str, season: int):
    conn = get_conn()
    try:
        bdl_to_uuid = build_bdl_to_uuid(conn, sport)
        games = fetch_upcoming_games(sport, season)
        print(f"[props] {len(games)} upcoming {sport} games to snapshot")

        # (uuid, game_date, stat) -> [lines across books]
        acc: dict = {}
        for g in games:
            for p in bdl_paginate(f"/{sport}/v1/odds/player_props", {"game_id": g["id"]}):
                stat = PROP_TO_STAT.get(p.get("prop_type"))
                uuid_ = bdl_to_uuid.get(p.get("player_id"))
                line = p.get("line_value")
                if not stat or uuid_ is None or line is None:
                    continue
                acc.setdefault((uuid_, g["date"], stat), []).append(float(line))

        rows = [
            (u, sport, d, s, round(statistics.median(v), 2))
            for (u, d, s), v in acc.items()
        ]
        print(f"[props] {len(rows)} (player, game, stat) median lines")
        if rows:
            with conn.cursor() as cur:
                execute_values(cur, """
                    INSERT INTO player_props (player_id, sport, game_date, stat, line_value)
                    VALUES %s
                    ON CONFLICT (player_id, sport, game_date, stat)
                    DO UPDATE SET line_value = EXCLUDED.line_value, updated_at = now()
                """, rows)
            conn.commit()
        print(f"[props] wrote {len(rows)} prop lines.")
    finally:
        conn.close()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--sport", choices=["nba", "wnba"], default="wnba")
    ap.add_argument("--season", type=int, required=True)
    args = ap.parse_args()
    run(args.sport, args.season)
