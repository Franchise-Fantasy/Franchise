"""
One-time seed of players.draft_round / draft_number for NBA from BDL.

Feeds the rookie slot-prior projections (projections/rookie_priors.py):
measured on our own 2019-2025 rookie classes, draft slot has a clean monotone
relationship with rookie fantasy production (picks 1-3 median 30.4 fpg vs
round 2's 10.6). sync-players keeps the columns current for players it ingests
going forward; this script backfills everyone already in the table.

Only fills NULLs — a draft pick is immutable history, so a non-null slot is
never overwritten (same one-way contract as sync-players' backfill).
NBA-only: BDL's WNBA player objects carry no draft fields (a WNBA seed would
be a small manual annual job), and NFL slots have no consumer yet.

Env:  BDL_API_KEY (ALL-STAR tier suffices), SB_SECRET_KEY
Usage:
  python seed_nba_draft_slots.py --dry-run
  python seed_nba_draft_slots.py
"""
import argparse
import os
import time

import requests
from supabase import create_client

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

sb = create_client(SUPABASE_URL, SB_SECRET_KEY)


def fetch_targets():
    """NBA players with a BDL id and no draft_number yet."""
    rows, offset = [], 0
    while True:
        res = (
            sb.table("players")
            .select("id, external_id_bdl")
            .eq("sport", "nba")
            .not_.is_("external_id_bdl", "null")
            .is_("draft_number", "null")
            .range(offset, offset + 999)
            .execute()
        )
        rows.extend(res.data)
        if len(res.data) < 1000:
            return rows
        offset += 1000


def fetch_slots(bdl_ids):
    """bdl_id -> (round, number) from /v1/players, batched 100/request at the
    60/min NBA budget (~1.1s pacing)."""
    out = {}
    ids = list(bdl_ids)
    for i in range(0, len(ids), 100):
        batch = ids[i:i + 100]
        params = [("player_ids[]", str(x)) for x in batch] + [("per_page", "100")]
        for attempt in range(5):
            r = requests.get("https://api.balldontlie.io/v1/players",
                             params=params,
                             headers={"Authorization": BDL_API_KEY}, timeout=60)
            if r.status_code == 429:
                time.sleep(15 * (2 ** attempt))
                continue
            r.raise_for_status()
            break
        else:
            raise RuntimeError("BDL kept 429ing")
        for p in r.json()["data"]:
            rnd, num = p.get("draft_round"), p.get("draft_number")
            if isinstance(num, int) and 1 <= num <= 300:
                out[p["id"]] = (rnd if isinstance(rnd, int) else None, num)
        time.sleep(1.1)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    targets = fetch_targets()
    print(f"NBA players missing draft_number (with BDL id): {len(targets)}")
    slots = fetch_slots([t["external_id_bdl"] for t in targets])
    print(f"slots found at BDL: {len(slots)} (rest = undrafted, stay NULL)")

    updated = 0
    for t in targets:
        slot = slots.get(int(t["external_id_bdl"]))
        if slot is None:
            continue
        rnd, num = slot
        if not args.dry_run:
            patch = {"draft_number": num}
            if rnd is not None:
                patch["draft_round"] = rnd
            sb.table("players").update(patch).eq("id", t["id"]).execute()
        updated += 1
        if updated % 200 == 0:
            print(f"  {updated} updated...")
    print(f"Done: {updated} players seeded"
          + (" (dry run — nothing written)" if args.dry_run else ""))


if __name__ == "__main__":
    main()
