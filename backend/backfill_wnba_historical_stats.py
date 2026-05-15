"""
Backfill player_historical_stats for WNBA from basketball-reference.com.

stats.wnba.com playercareerstats is hard-blocked (90s+ timeouts on every
request, even from Supabase). BDL gates WNBA player_stats behind GOAT tier
($40/mo). Basketball-reference publishes a single HTML page with per-game
season averages for the entire league — one fetch, ~230 rows.

Usage:
    python backfill_wnba_historical_stats.py                # 2025 season
    python backfill_wnba_historical_stats.py --season 2024  # specific season

Players are matched by normalized name. Players in our DB without a row in
the b-ref page (rookies who didn't play, undrafted free agents, mid-season
signings filed under a different name) are reported but skipped.
"""

import os
import re
import sys
import unicodedata

import requests
from supabase import create_client

supabase_url = os.environ.get(
    "SUPABASE_URL", "https://iuqbossmnsezzgocpcbo.supabase.co"
)
supabase_key = os.environ.get("SB_SECRET_KEY", "")
if not supabase_key:
    raise ValueError("Set SB_SECRET_KEY env var")

supabase = create_client(supabase_url, supabase_key)

TARGET_SEASON = "2025"
if len(sys.argv) > 2 and sys.argv[1] == "--season":
    TARGET_SEASON = sys.argv[2]
print(f"Targeting WNBA season: {TARGET_SEASON}")

BREF_URL = (
    f"https://www.basketball-reference.com/wnba/years/{TARGET_SEASON}_per_game.html"
)
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
    ),
}


def normalize_name(name: str) -> str:
    """Strip accents, lowercase, drop punctuation. Mirrors the app's
    normalize_name util — names like A'ja Wilson / aja wilson collapse."""
    decomposed = unicodedata.normalize("NFKD", name)
    no_accents = "".join(c for c in decomposed if not unicodedata.combining(c))
    return re.sub(r"[^a-z0-9]", "", no_accents.lower())


def parse_row(row_html: str) -> dict | None:
    """Extract one player's per-game line from a <tr> chunk."""
    name_m = re.search(
        r'data-stat="player"[^>]*>(?:<[^>]+>)*([^<]+)', row_html
    )
    if not name_m:
        return None

    def get(stat: str) -> str | None:
        # Cells are like `<td data-stat="team"><a href="...">PHO</a></td>` —
        # match the *first* text content inside, drilling past any opening tag.
        m = re.search(
            rf'data-stat="{stat}"[^>]*>(?:<[^>]+>)*([^<]*)', row_html
        )
        return m.group(1).strip() if m else None

    def get_num(stat: str) -> float:
        v = get(stat)
        if v is None or v == "":
            return 0.0
        return float(v)

    return {
        "name": name_m.group(1).strip(),
        "team": get("team") or "",
        "g": int(get("g") or 0),
        "mp_per_g": get_num("mp_per_g"),
        "fg_per_g": get_num("fg_per_g"),
        "fga_per_g": get_num("fga_per_g"),
        "fg3_per_g": get_num("fg3_per_g"),
        "fg3a_per_g": get_num("fg3a_per_g"),
        "ft_per_g": get_num("ft_per_g"),
        "fta_per_g": get_num("fta_per_g"),
        "trb_per_g": get_num("trb_per_g"),
        "ast_per_g": get_num("ast_per_g"),
        "stl_per_g": get_num("stl_per_g"),
        "blk_per_g": get_num("blk_per_g"),
        "tov_per_g": get_num("tov_per_g"),
        "pf_per_g": get_num("pf_per_g"),
        "pts_per_g": get_num("pts_per_g"),
    }


print(f"Fetching {BREF_URL} ...")
r = requests.get(BREF_URL, headers=HEADERS, timeout=30)
r.raise_for_status()

table_match = re.search(r'id="per_game".*?</table>', r.text, re.DOTALL)
if not table_match:
    raise RuntimeError("per_game table not found in response")
rows = re.findall(r'<tr [^>]*>.*?</tr>', table_match.group(0), re.DOTALL)

stat_lines: list[dict] = []
for row in rows:
    if 'class="thead"' in row or 'data-stat="player"' not in row:
        continue
    parsed = parse_row(row)
    if parsed and parsed["g"] > 0:
        stat_lines.append(parsed)

# B-ref gives separate rows per team for traded players (and a TOT row).
# Prefer the TOT row for accuracy; fall back to first team row.
by_norm: dict[str, dict] = {}
for line in stat_lines:
    key = normalize_name(line["name"])
    existing = by_norm.get(key)
    if existing is None:
        by_norm[key] = line
    elif line["team"] == "TOT":
        by_norm[key] = line  # TOT supersedes single-team row

print(f"Parsed {len(stat_lines)} stat rows -> {len(by_norm)} unique players (TOT preferred)")

print("Fetching WNBA players from database...")
players_res = (
    supabase.table("players")
    .select("id, name, pro_team")
    .eq("sport", "wnba")
    .execute()
)
players = players_res.data
print(f"Found {len(players)} WNBA players in DB")

records: list[dict] = []
matched = 0
unmatched: list[str] = []

for player in players:
    norm = normalize_name(player["name"])
    line = by_norm.get(norm)
    if not line:
        unmatched.append(player["name"])
        continue

    gp = line["g"]
    avg_pts = line["pts_per_g"]
    avg_reb = line["trb_per_g"]
    avg_ast = line["ast_per_g"]
    avg_stl = line["stl_per_g"]
    avg_blk = line["blk_per_g"]
    avg_tov = line["tov_per_g"]

    records.append({
        "player_id": player["id"],
        "season": TARGET_SEASON,
        "sport": "wnba",
        "games_played": gp,
        "avg_min": line["mp_per_g"],
        "avg_pts": avg_pts,
        "avg_reb": avg_reb,
        "avg_ast": avg_ast,
        "avg_stl": avg_stl,
        "avg_blk": avg_blk,
        "avg_tov": avg_tov,
        "avg_fgm": line["fg_per_g"],
        "avg_fga": line["fga_per_g"],
        "avg_3pm": line["fg3_per_g"],
        "avg_3pa": line["fg3a_per_g"],
        "avg_ftm": line["ft_per_g"],
        "avg_fta": line["fta_per_g"],
        "avg_pf":  line["pf_per_g"],
        "total_pts": round(avg_pts * gp),
        "total_reb": round(avg_reb * gp),
        "total_ast": round(avg_ast * gp),
        "total_stl": round(avg_stl * gp),
        "total_blk": round(avg_blk * gp),
        "total_tov": round(avg_tov * gp),
        # b-ref TOT row's "team" is "TOT"; prefer DB's current pro_team for that.
        "pro_team": (
            line["team"] if line["team"] != "TOT" else (player.get("pro_team") or "")
        ),
    })
    matched += 1

print(f"Matched {matched} of {len(players)} DB players to b-ref rows")
if unmatched:
    print(f"Unmatched ({len(unmatched)}): {', '.join(unmatched[:10])}"
          + (" ..." if len(unmatched) > 10 else ""))

# Bulk upsert in chunks.
BATCH = 200
upserted = 0
for i in range(0, len(records), BATCH):
    chunk = records[i:i + BATCH]
    res = supabase.table("player_historical_stats").upsert(
        chunk, on_conflict="player_id,season"
    ).execute()
    upserted += len(chunk)
    print(f"  upserted {upserted}/{len(records)}")

print(f"\nDone. Upserted {upserted} rows for WNBA {TARGET_SEASON}.")
