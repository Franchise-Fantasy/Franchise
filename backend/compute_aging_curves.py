"""
Compute NBA aging curves using the delta method.

Fetches season totals from api.server.nbaapi.com (free, no auth) for all
players from 2003-present, computes per-position aging curves, and exports
a JSON file for the client app.

Usage:
    python compute_aging_curves.py              # full run (resumes from cache)
    python compute_aging_curves.py --stats-only # skip fetching, recompute from cache
"""

import json
import statistics
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

# -- Config -------------------------------------------------------------------

FIRST_SEASON = 2003              # Earliest season with data in the API
CURRENT_SEASON = 2026            # Current NBA season year
MIN_SEASON = 2004                # Only use seasons from 2004+ for curves
MIN_GAMES = 50                   # Drop player-seasons under 50 games
MIN_MPG = 20                     # Drop player-seasons under 20 min/game
MIN_BUCKET_SIZE = 30             # Require 30+ delta pairs per age bucket
SMOOTHING_WINDOW = 3             # Rolling average window for final curves
CACHE_FILE = Path(__file__).parent / ".aging_curve_cache.json"
OUTPUT_FILE = Path(__file__).parent / ".." / "constants" / "agingCurves.json"
API_BASE = "https://api.server.nbaapi.com/api"
PAGE_SIZE = 100

# Fantasy scoring weights (mirrors DEFAULT_SCORING in constants/LeagueDefaults.ts)
# These are applied to PER-GAME averages (totals / games_played)
SCORING_WEIGHTS = {
    "PTS": 1,
    "REB": 1.2,
    "AST": 1.5,
    "STL": 3,
    "BLK": 3,
    "TOV": -1,
    "FG3M": 1,
    "FGM": 2,
    "FGA": -1,
    "FTM": 1,
    "FTA": -1,
    "PF": -1,
}

# Map API position codes to our app positions
POSITION_MAP = {
    "PG": "PG",
    "SG": "SG",
    "SF": "SF",
    "PF": "PF",
    "C":  "C",
    "G":  "G",
    "F":  "F",
}


def normalize_position(raw: str) -> str:
    if not raw:
        return "G"
    # API returns positions like "PG", "SF", "PG-SG", "C-PF"
    primary = raw.split("-")[0].strip().upper()
    return POSITION_MAP.get(primary, "G")


# -- Data Fetching ------------------------------------------------------------

def api_fetch(endpoint: str, params: dict) -> dict:
    """Fetch JSON from the free NBA stats API via curl."""
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    url = f"{API_BASE}/{endpoint}?{qs}"

    for attempt in range(3):
        result = subprocess.run(
            ["curl", "-s", "--max-time", "30", url],
            capture_output=True, encoding="utf-8", errors="replace",
        )
        body = (result.stdout or "").strip()
        if body and body.startswith("{"):
            return json.loads(body)

        if attempt < 2:
            wait = 3 * (attempt + 1)
            print(f"    Retry {attempt + 1}: bad response from {endpoint}. "
                  f"Waiting {wait}s...", flush=True)
            time.sleep(wait)

    raise RuntimeError(f"Failed to fetch {endpoint} with params {params}")


def load_cache() -> dict:
    if CACHE_FILE.exists():
        with open(CACHE_FILE, "r") as f:
            return json.load(f)
    return {}


def save_cache(cache: dict):
    with open(CACHE_FILE, "w") as f:
        json.dump(cache, f)


def fetch_all_seasons(cache: dict) -> dict:
    """Fetch season totals for every player, every season from the API.

    Cache is keyed by season year (str). Each value is a list of player
    records for that season.
    """
    for season in range(FIRST_SEASON, CURRENT_SEASON + 1):
        season_key = str(season)
        if season_key in cache:
            print(f"  Season {season}: cached ({len(cache[season_key])} players)",
                  flush=True)
            continue

        print(f"  Season {season}: fetching...", end="", flush=True)
        all_players = []
        page = 1

        while True:
            data = api_fetch("playertotals", {
                "season": season,
                "pageSize": PAGE_SIZE,
                "page": page,
            })

            rows = data.get("data", [])
            all_players.extend(rows)

            pagination = data.get("pagination", {})
            total_pages = pagination.get("pages", 0)

            if page >= total_pages or not rows:
                break
            page += 1

        cache[season_key] = all_players
        save_cache(cache)
        print(f" {len(all_players)} players", flush=True)

    return cache


# -- FPTS Calculation ---------------------------------------------------------

def compute_fpts_per_game(player: dict) -> float:
    """Compute fantasy points per game from season totals."""
    gp = player.get("games", 0)
    if gp == 0:
        return 0.0

    # Map API field names to our scoring weight keys
    field_map = {
        "PTS": "points",
        "REB": "totalRb",
        "AST": "assists",
        "STL": "steals",
        "BLK": "blocks",
        "TOV": "turnovers",
        "FG3M": "threeFg",
        "FGM": "fieldGoals",
        "FGA": "fieldAttempts",
        "FTM": "ft",
        "FTA": "ftAttempts",
        "PF": "personalFouls",
    }

    total_fpts = 0.0
    for stat_key, weight in SCORING_WEIGHTS.items():
        api_field = field_map.get(stat_key, "")
        season_total = player.get(api_field, 0) or 0
        total_fpts += (season_total / gp) * weight

    return round(total_fpts, 2)


# -- Curve Computation --------------------------------------------------------

def build_player_seasons(cache: dict) -> list[dict]:
    """Convert cached season data into a flat list of player-season records."""
    records = []

    for season_key, players in cache.items():
        season = int(season_key)
        if season < MIN_SEASON:
            continue

        for p in players:
            gp = p.get("games", 0)
            if gp < MIN_GAMES:
                continue

            # Filter by minutes per game
            total_min = p.get("minutesPg", 0)
            mpg = total_min / gp if gp > 0 else 0
            if mpg < MIN_MPG:
                continue

            age = p.get("age")
            if not age or age < 18 or age > 42:
                continue

            position = normalize_position(p.get("position", ""))
            fpts = compute_fpts_per_game(p)
            if fpts <= 0:
                continue

            # Per-game stat averages for raw stat line output
            stats_pg = {
                "PTS": round(p.get("points", 0) / gp, 2),
                "REB": round(p.get("totalRb", 0) / gp, 2),
                "AST": round(p.get("assists", 0) / gp, 2),
                "STL": round(p.get("steals", 0) / gp, 2),
                "BLK": round(p.get("blocks", 0) / gp, 2),
                "TOV": round(p.get("turnovers", 0) / gp, 2),
                "FG3M": round(p.get("threeFg", 0) / gp, 2),
                "FGM": round(p.get("fieldGoals", 0) / gp, 2),
                "FGA": round(p.get("fieldAttempts", 0) / gp, 2),
                "FTM": round(p.get("ft", 0) / gp, 2),
                "FTA": round(p.get("ftAttempts", 0) / gp, 2),
                "PF": round(p.get("personalFouls", 0) / gp, 2),
            }

            records.append({
                "player_id": p.get("playerId", ""),
                "name": p.get("playerName", ""),
                "position": position,
                "season": season,
                "age": int(age),
                "fpts": fpts,
                "stats": stats_pg,
            })

    print(f"Built {len(records)} qualifying player-seasons", flush=True)
    return records


STAT_KEYS = ["PTS", "REB", "AST", "STL", "BLK", "TOV", "FG3M", "FGM", "FGA", "FTM", "FTA", "PF"]


def compute_stat_lines_by_age(
    records: list[dict], position_filter: str | None = None
) -> dict[str, dict[str, float]]:
    """Compute median per-game stat line at each age.

    Returns {"20": {"PTS": 12.5, "REB": 4.2, ...}, "21": {...}, ...}
    The client applies league scoring weights to get FPTS at each age.
    """
    by_age: dict[int, dict[str, list[float]]] = {}
    for r in records:
        if position_filter and r["position"] != position_filter:
            continue
        stats = r.get("stats")
        if not stats:
            continue
        age = r["age"]
        if age not in by_age:
            by_age[age] = {k: [] for k in STAT_KEYS}
        for k in STAT_KEYS:
            by_age[age][k].append(stats.get(k, 0))

    result = {}
    for age in sorted(by_age.keys()):
        vals = by_age[age]
        # Need enough data points for a meaningful median
        n = len(vals["PTS"])
        if n < MIN_BUCKET_SIZE:
            continue
        result[str(age)] = {
            k: round(statistics.median(vals[k]), 2) for k in STAT_KEYS
        }

    return result


def compute_stat_lines_percentile(
    records: list[dict], pct: float, position_filter: str | None = None
) -> dict[str, dict[str, float]]:
    """Compute a given percentile of per-game stats at each age."""
    by_age: dict[int, dict[str, list[float]]] = {}
    for r in records:
        if position_filter and r["position"] != position_filter:
            continue
        stats = r.get("stats")
        if not stats:
            continue
        age = r["age"]
        if age not in by_age:
            by_age[age] = {k: [] for k in STAT_KEYS}
        for k in STAT_KEYS:
            by_age[age][k].append(stats.get(k, 0))

    result = {}
    for age in sorted(by_age.keys()):
        vals = by_age[age]
        if len(vals["PTS"]) < MIN_BUCKET_SIZE:
            continue
        result[str(age)] = {
            k: round(percentile(vals[k], pct), 2) for k in STAT_KEYS
        }

    return result


def compute_deltas(
    records: list[dict], position_filter: str | None = None
) -> dict[int, list[float]]:
    """Compute year-over-year FPTS ratios for consecutive seasons."""
    by_player: dict[str, list[dict]] = {}
    for r in records:
        if position_filter and r["position"] != position_filter:
            continue
        by_player.setdefault(r["player_id"], []).append(r)

    deltas: dict[int, list[float]] = {}

    for pid, seasons in by_player.items():
        seasons.sort(key=lambda s: s["age"])

        for i in range(len(seasons) - 1):
            s1 = seasons[i]
            s2 = seasons[i + 1]

            if s2["age"] - s1["age"] != 1:
                continue
            if s1["fpts"] < 5:
                continue

            ratio = s2["fpts"] / s1["fpts"]
            ratio = max(0.3, min(3.0, ratio))
            deltas.setdefault(s1["age"], []).append(ratio)

    return deltas


def chain_curve(
    deltas: dict[int, float], age_range: tuple[int, int]
) -> dict[str, float]:
    """Chain median deltas into a normalized curve (peak = 1.0)."""
    min_age, max_age = age_range
    raw = {min_age: 1.0}

    for age in range(min_age, max_age):
        if age in deltas:
            raw[age + 1] = raw[age] * deltas[age]
        else:
            raw[age + 1] = raw.get(age, 1.0)

    peak_val = max(raw.values()) if raw else 1.0
    return {
        str(age): round(raw[age] / peak_val, 4)
        for age in range(min_age, max_age + 1)
        if age in raw
    }


def smooth_curve(
    curve: dict[str, float], window: int = SMOOTHING_WINDOW
) -> dict[str, float]:
    """Apply centered rolling average smoothing."""
    ages = sorted(curve.keys(), key=int)
    values = [curve[a] for a in ages]
    half = window // 2

    smoothed = {}
    for i, age in enumerate(ages):
        start = max(0, i - half)
        end = min(len(values), i + half + 1)
        smoothed[age] = round(statistics.mean(values[start:end]), 4)
    return smoothed


def percentile(data: list[float], p: float) -> float:
    """Compute the p-th percentile (0-100) of a sorted list."""
    sorted_data = sorted(data)
    k = (len(sorted_data) - 1) * (p / 100)
    f = int(k)
    c = f + 1 if f + 1 < len(sorted_data) else f
    return sorted_data[f] + (k - f) * (sorted_data[c] - sorted_data[f])


def compute_fpts_bands(
    records: list[dict], position_filter: str | None = None
) -> tuple[dict[str, float], dict[str, float]]:
    """Compute p25/p75 of normalized FPTS at each age.

    Normalizes each player's FPTS by their career peak so the band
    represents the spread of aging trajectories, not raw production
    differences. Returns curves in the same 0-1 scale as the median curve.
    """
    # Group by player, find each player's peak FPTS
    by_player: dict[str, list[dict]] = {}
    for r in records:
        if position_filter and r["position"] != position_filter:
            continue
        by_player.setdefault(r["player_id"], []).append(r)

    # Collect normalized values at each age
    by_age: dict[int, list[float]] = {}
    for pid, seasons in by_player.items():
        if len(seasons) < 2:
            continue
        peak = max(s["fpts"] for s in seasons)
        if peak <= 0:
            continue
        for s in seasons:
            norm = s["fpts"] / peak
            by_age.setdefault(s["age"], []).append(norm)

    p25 = {}
    p75 = {}
    for age, vals in by_age.items():
        if len(vals) >= MIN_BUCKET_SIZE:
            p25[str(age)] = round(percentile(vals, 25), 4)
            p75[str(age)] = round(percentile(vals, 75), 4)

    return smooth_curve(p25), smooth_curve(p75)


def compute_all_curves(records: list[dict]) -> tuple[dict, dict, dict, dict]:
    """Compute aging curves for all positions + blends.

    Returns (curves, bands_lo, bands_hi, sample_sizes).
    """
    positions = ["PG", "SG", "SF", "PF", "C"]
    age_range = (19, 38)

    curves = {}
    bands_lo = {}
    bands_hi = {}
    sample_sizes = {}

    # ALL positions — median curve from deltas
    all_deltas = compute_deltas(records)
    all_medians = {}
    all_samples = {}
    for age, ratios in all_deltas.items():
        all_samples[str(age)] = len(ratios)
        if len(ratios) >= MIN_BUCKET_SIZE:
            all_medians[age] = statistics.median(ratios)

    curves["ALL"] = smooth_curve(chain_curve(all_medians, age_range))
    sample_sizes["ALL"] = all_samples

    # Stat lines by age (median + IQR) — client applies league scoring
    stat_lines = {}
    stat_lines_p25 = {}
    stat_lines_p75 = {}
    stat_lines["ALL"] = compute_stat_lines_by_age(records)
    stat_lines_p25["ALL"] = compute_stat_lines_percentile(records, 25)
    stat_lines_p75["ALL"] = compute_stat_lines_percentile(records, 75)

    print("\n-- ALL positions --", flush=True)
    for age in sorted(all_medians.keys()):
        n = len(all_deltas[age])
        print(f"  Age {age}->{age+1}: median={all_medians[age]:.4f}, n={n}",
              flush=True)

    # Per-position curves
    for pos in positions:
        pos_deltas = compute_deltas(records, position_filter=pos)
        pos_medians = {}
        pos_samples = {}

        for age, ratios in pos_deltas.items():
            pos_samples[str(age)] = len(ratios)
            if len(ratios) >= MIN_BUCKET_SIZE:
                pos_medians[age] = statistics.median(ratios)
            elif age in all_medians:
                pos_medians[age] = all_medians[age]

        curves[pos] = smooth_curve(chain_curve(pos_medians, age_range))
        stat_lines[pos] = compute_stat_lines_by_age(records, pos)
        stat_lines_p25[pos] = compute_stat_lines_percentile(records, 25, pos)
        stat_lines_p75[pos] = compute_stat_lines_percentile(records, 75, pos)
        sample_sizes[pos] = pos_samples

        n_own = sum(1 for a, r in pos_deltas.items() if len(r) >= MIN_BUCKET_SIZE)
        n_fallback = len(pos_medians) - n_own
        print(f"  {pos}: {n_own} own buckets, {n_fallback} fallback to ALL",
              flush=True)

    # Blended curves
    def blend(a_key: str, b_key: str) -> dict[str, float]:
        all_ages = set(curves[a_key].keys()) | set(curves[b_key].keys())
        blended = {}
        for age in all_ages:
            a_val = curves[a_key].get(age)
            b_val = curves[b_key].get(age)
            if a_val is not None and b_val is not None:
                blended[age] = round((a_val + b_val) / 2, 4)
            elif a_val is not None:
                blended[age] = a_val
            else:
                blended[age] = b_val
        return blended

    curves["G"] = blend("PG", "SG")
    curves["F"] = blend("SF", "PF")

    # Blend stat lines by averaging each stat at each age
    def blend_stats(a_key: str, b_key: str, src: dict) -> dict:
        a_data = src.get(a_key, {})
        b_data = src.get(b_key, {})
        if not a_data or not b_data:
            return {}
        all_ages = set(a_data.keys()) | set(b_data.keys())
        blended = {}
        for age in all_ages:
            a_sl = a_data.get(age)
            b_sl = b_data.get(age)
            if a_sl and b_sl:
                blended[age] = {
                    k: round((a_sl.get(k, 0) + b_sl.get(k, 0)) / 2, 2)
                    for k in STAT_KEYS
                }
            elif a_sl:
                blended[age] = a_sl
            elif b_sl:
                blended[age] = b_sl
        return blended

    stat_lines["G"] = blend_stats("PG", "SG", stat_lines)
    stat_lines["F"] = blend_stats("SF", "PF", stat_lines)
    stat_lines_p25["G"] = blend_stats("PG", "SG", stat_lines_p25)
    stat_lines_p25["F"] = blend_stats("SF", "PF", stat_lines_p25)
    stat_lines_p75["G"] = blend_stats("PG", "SG", stat_lines_p75)
    stat_lines_p75["F"] = blend_stats("SF", "PF", stat_lines_p75)

    for blend_key, (a, b) in [("G", ("PG", "SG")), ("F", ("SF", "PF"))]:
        merged = {}
        for age in set(list(sample_sizes[a].keys()) + list(sample_sizes[b].keys())):
            merged[age] = sample_sizes[a].get(age, 0) + sample_sizes[b].get(age, 0)
        sample_sizes[blend_key] = merged

    return curves, stat_lines, stat_lines_p25, stat_lines_p75, sample_sizes


def find_peak_age(curves: dict) -> int:
    all_curve = curves.get("ALL", {})
    if not all_curve:
        return 27
    return int(max(all_curve.keys(), key=lambda a: all_curve[a]))


# Roster depth tiers: total rostered players league-wide
TIERS = [60, 100, 150, 200]


def compute_replacement_threshold(records: list[dict], tier: int) -> float:
    """Find the FPTS/game of the Nth-best player, averaged across seasons.

    For each season, rank all players by FPTS and take the value at
    position `tier`. Average across seasons for stability.
    """
    by_season: dict[int, list[float]] = {}
    for r in records:
        by_season.setdefault(r["season"], []).append(r["fpts"])

    thresholds = []
    for season, fpts_list in by_season.items():
        fpts_list.sort(reverse=True)
        if len(fpts_list) >= tier:
            thresholds.append(fpts_list[tier - 1])
        elif fpts_list:
            thresholds.append(fpts_list[-1])

    return statistics.median(thresholds) if thresholds else 0


def filter_by_peak(records: list[dict], threshold: float) -> list[dict]:
    """Keep only player-seasons for players whose career peak was above threshold."""
    # Find each player's peak FPTS
    peak_by_player: dict[str, float] = {}
    for r in records:
        pid = r["player_id"]
        if r["fpts"] > peak_by_player.get(pid, 0):
            peak_by_player[pid] = r["fpts"]

    # Filter to players who peaked above threshold
    qualified = {pid for pid, peak in peak_by_player.items() if peak >= threshold}
    return [r for r in records if r["player_id"] in qualified]


# -- Main ---------------------------------------------------------------------

def main():
    stats_only = "--stats-only" in sys.argv

    print("=" * 60, flush=True)
    print("NBA Aging Curve Computation", flush=True)
    print("=" * 60, flush=True)

    cache = load_cache()
    cached_seasons = [k for k in cache.keys() if k.isdigit()]
    print(f"Cache: {len(cached_seasons)} seasons loaded", flush=True)

    if not stats_only:
        print(f"\n-- Fetching seasons {FIRST_SEASON}-{CURRENT_SEASON} --",
              flush=True)
        cache = fetch_all_seasons(cache)
    else:
        print("Skipping fetch (--stats-only mode)", flush=True)

    if not any(k.isdigit() for k in cache):
        print("No data in cache. Run without --stats-only first.", flush=True)
        return

    total_players = sum(
        len(v) for k, v in cache.items() if k.isdigit()
    )
    print(f"\n-- Computing curves from {total_players} player-seasons --",
          flush=True)
    all_records = build_player_seasons(cache)

    if not all_records:
        print("No qualifying player-seasons found.", flush=True)
        return

    # Compute tier-specific curves
    tier_data = {}
    for tier in TIERS:
        threshold = compute_replacement_threshold(all_records, tier)
        filtered = filter_by_peak(all_records, threshold)
        unique_players = len(set(r["player_id"] for r in filtered))
        print(f"\n{'=' * 50}", flush=True)
        print(f"TIER {tier} (replacement={threshold:.1f} FPTS/g, "
              f"{len(filtered)} player-seasons, {unique_players} players)",
              flush=True)

        curves, sl_med, sl_p25, sl_p75, sample_sizes = compute_all_curves(filtered)

        tier_data[str(tier)] = {
            "replacementLevel": round(threshold, 2),
            "playerSeasons": len(filtered),
            "curves": curves,
            "statLines": sl_med,
            "statLinesP25": sl_p25,
            "statLinesP75": sl_p75,
            "sampleSizes": sample_sizes,
        }

    # Also compute one "all rotation players" baseline (no tier filter)
    print(f"\n{'=' * 50}", flush=True)
    print(f"BASELINE (all rotation players, {len(all_records)} player-seasons)",
          flush=True)
    base_curves, base_sl, base_p25, base_p75, base_samples = compute_all_curves(all_records)
    peak_age = find_peak_age(base_curves)

    output = {
        "generated": date.today().isoformat(),
        "peakAge": peak_age,
        "minSeason": MIN_SEASON,
        "maxSeason": CURRENT_SEASON,
        "minGames": MIN_GAMES,
        "minMpg": MIN_MPG,
        "tiers": tier_data,
        "baseline": {
            "curves": base_curves,
            "statLines": base_sl,
            "statLinesP25": base_p25,
            "statLinesP75": base_p75,
            "sampleSizes": base_samples,
        },
        "scoringWeights": {
            "PTS": 1, "REB": 1.2, "AST": 1.5, "STL": 3, "BLK": 3,
            "TO": -1, "3PM": 1, "FGM": 2, "FGA": -1,
            "FTM": 1, "FTA": -1, "PF": -1,
        },
    }

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_FILE, "w") as f:
        json.dump(output, f, indent=2)

    print(f"\n-- Results --", flush=True)
    print(f"Peak age: {peak_age}", flush=True)
    print(f"Tiers: {TIERS}", flush=True)
    print(f"Output: {OUTPUT_FILE.resolve()}", flush=True)

    # Print comparison across tiers (using default scoring to preview)
    print(f"\nMedian PTS/g at peak ages by tier:", flush=True)
    print(f"{'Tier':>6} {'Repl':>6} {'Age25':>7} {'Age27':>7} {'Age30':>7} {'Age33':>7}",
          flush=True)
    for tier in TIERS:
        td = tier_data[str(tier)]
        sl = td["statLines"].get("ALL", {})
        def pts(age): return sl.get(str(age), {}).get("PTS", 0)
        print(f"{tier:>6} {td['replacementLevel']:>6.1f} "
              f"{pts(25):>7.1f} {pts(27):>7.1f} "
              f"{pts(30):>7.1f} {pts(33):>7.1f}", flush=True)


if __name__ == "__main__":
    main()
