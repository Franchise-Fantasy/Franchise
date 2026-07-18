"""
Seed external_id_nba for NFL players with their NFL.com headshot id.

NFL has no numeric-id headshot CDN like NBA (cdn.nba.com/{PERSON_ID}) or
WNBA (espncdn/{espnId}). The league's own images live on Cloudinary under an
OPAQUE per-player asset id (e.g. "mjwbioajzldkq1vzoz2d"), reachable at:

    https://static.www.nfl.com/image/private/t_headshot_desktop/f_auto/league/{id}

That id isn't derivable from anything stable, so we scrape it once from each
player's NFL.com page (it's the <meta property="og:image"> target) and store it
in players.external_id_nba (a text column). From there the existing pipeline —
sync-headshots mirror -> Storage -> getPlayerHeadshotUrl -> PlayerHeadshotImage —
works with no client changes, exactly like NBA/WNBA.

Seed-and-reseed model (not a live crosswalk): Cloudinary ids rotate with each
season's new team photos, so re-run this at the season boundary. Runs from a
GitHub Actions runner (NFL.com may rate-limit/​block Supabase edge IPs, same
reason sync_nba_ids.py lives here rather than in an edge function).

Dry-run by default (no DB writes). Pass --write to persist matches.

    python3 seed_nfl_headshots.py                 # dry run, whole roster
    python3 seed_nfl_headshots.py --limit 120     # dry run, first 120 (coverage sample)
    python3 seed_nfl_headshots.py --write          # persist external_id_nba
    python3 seed_nfl_headshots.py --write --force  # also refresh rows that already have one

Idempotent: without --force, only touches rows where external_id_nba IS NULL.
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from supabase import create_client

SUPABASE_URL = os.environ.get('SUPABASE_URL') or os.environ.get(
    'EXPO_PUBLIC_SUPABASE_URL', 'https://iuqbossmnsezzgocpcbo.supabase.co'
)
SUPABASE_KEY = os.environ['SB_SECRET_KEY']

PLAYER_URL = 'https://www.nfl.com/players/{slug}/'
# A real headshot is the page's og:image under the t_headshot_desktop transform.
# NFL.com is an SPA that soft-404s (HTTP 200) to a generic-silhouette placeholder
# served under an /image/upload/v<version>/ path instead — requiring the transform
# both extracts the id and rejects that placeholder. Assets live in two Cloudinary
# delivery namespaces (upload | private) and the bare id belongs to exactly one;
# we store just the id and the mirror tries both namespaces (only one resolves).
OG_IMAGE_RE = re.compile(
    r'og:image"\s+content="https://static\.www\.nfl\.com/image/(?:upload|private)/'
    r't_headshot_desktop/league/([a-z0-9]+)"'
)
PLACEHOLDER_ID = 'nvfr7ogywskqrfaiu38m'  # generic silhouette, belt-and-suspenders
GEN_SUFFIXES = {'jr', 'sr', 'ii', 'iii', 'iv', 'v'}
USER_AGENT = (
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 '
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
)
WORKERS = 8
FETCH_TIMEOUT = 15


def _base(name: str) -> str:
    """Accent-stripped, lowercased name for slug building."""
    name = unicodedata.normalize('NFD', name)
    name = ''.join(c for c in name if unicodedata.category(c) != 'Mn')
    return name.lower()


def _hyphenate(s: str) -> str:
    """Every run of non-alphanumerics becomes one hyphen — this is NFL.com's own
    rule: "C.J. Stroud" -> "c-j-stroud", "Aidan O'Connell" -> "aidan-o-connell",
    "Brian Thomas Jr." -> "brian-thomas-jr". (Do NOT pre-strip punctuation/suffixes.)
    """
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')


def _toggle_initials(slug: str) -> str | None:
    """NFL.com is inconsistent on two-initial first names — "A.J. Dillon" is
    "a-j-dillon" but "AJ Barner" is "aj-barner". Flip whichever form we built so
    the other gets tried as a fallback. Returns None if not a two-initial lead.
    """
    m = re.match(r'^([a-z])-([a-z])-(.+)$', slug)
    if m:
        return f'{m.group(1)}{m.group(2)}-{m.group(3)}'   # a-j-dillon -> aj-dillon
    m = re.match(r'^([a-z])([a-z])-(.+)$', slug)
    if m:
        return f'{m.group(1)}-{m.group(2)}-{m.group(3)}'   # aj-barner -> a-j-barner
    return None


def slug_candidates(name: str) -> list[str]:
    """Ordered, deduped NFL.com slug guesses for a name. Suffixes are inconsistent
    too ("brian-thomas-jr" kept, "aaron-jones" dropped), so try keep-suffix first,
    then drop-suffix, each with the initials toggled as a further fallback.
    """
    base = _base(name)
    tokens = base.split()
    has_suffix = bool(tokens) and tokens[-1].strip('.') in GEN_SUFFIXES
    drop_base = ' '.join(tokens[:-1]) if has_suffix else base

    ordered: list[str] = []
    for src in (base, drop_base):
        slug = _hyphenate(src)
        for cand in (slug, _toggle_initials(slug)):
            if cand and cand not in ordered:
                ordered.append(cand)
    return ordered


def is_team_defense(player: dict) -> bool:
    """Team D/ST rows have no personal headshot; skip them."""
    return (player.get('position') or '').upper() in {'DST', 'DEF', 'D/ST'}


def _get(slug: str) -> str | None:
    url = PLAYER_URL.format(slug=slug)
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT) as resp:
            return resp.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return None
        raise
    except (urllib.error.URLError, TimeoutError):
        return None


def fetch_headshot_id(name: str) -> tuple[str, str] | tuple[None, None]:
    """Try each candidate slug; return (cloudinary_id, winning_slug) for the first
    real headshot, or (None, None) if the player isn't on NFL.com's active list.
    """
    for slug in slug_candidates(name):
        html = _get(slug)
        if html is None:
            continue
        m = OG_IMAGE_RE.search(html)
        if m and m.group(1) != PLACEHOLDER_ID:
            return m.group(1), slug
    return None, None


def load_nfl_players(supabase, force: bool, limit: int | None) -> list[dict]:
    # PostgREST caps a single response at 1000 rows, so page through explicitly —
    # the NFL pool is ~1000+ and a silent truncation would skip the tail.
    page = 1000
    rows: list[dict] = []
    start = 0
    while True:
        q = supabase.table('players').select(
            'id, name, pro_team, position, external_id_nba'
        ).eq('sport', 'nfl').order('name').range(start, start + page - 1)
        if not force:
            q = q.is_('external_id_nba', 'null')
        batch = (q.execute().data) or []
        rows.extend(batch)
        if len(batch) < page:
            break
        start += page

    rows = [p for p in rows if not is_team_defense(p)]
    if limit:
        rows = rows[:limit]
    return rows


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true', help='persist matches to DB')
    ap.add_argument('--force', action='store_true',
                    help='also (re)fetch rows that already have an id')
    ap.add_argument('--limit', type=int, default=None,
                    help='only process the first N players (coverage sampling)')
    args = ap.parse_args()

    supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

    players = load_nfl_players(supabase, args.force, args.limit)
    print(f'{len(players)} NFL players to resolve '
          f'({"WRITE" if args.write else "dry run"}'
          f'{", force" if args.force else ""})\n', flush=True)
    if not players:
        print('nothing to do.')
        return

    matched: list[dict] = []
    unmatched: list[dict] = []

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            pool.submit(fetch_headshot_id, p['name']): p for p in players
        }
        done = 0
        for fut in as_completed(futures):
            p = futures[fut]
            cid, slug = fut.result()
            done += 1
            if cid:
                matched.append({**p, 'cid': cid, 'slug': slug})
            else:
                unmatched.append(p)
            if done % 100 == 0:
                print(f'  ...{done}/{len(players)}', flush=True)

    total = len(players)
    print(f'\nmatched {len(matched)}/{total} '
          f'({100 * len(matched) // total}%), {len(unmatched)} unmatched\n',
          flush=True)

    # Flag cloudinary ids shared by multiple players — a duplicate points at a
    # slug collision (two "Josh Allen"s) or NFL.com's generic placeholder image.
    by_cid: dict[str, list[str]] = {}
    for m in matched:
        by_cid.setdefault(m['cid'], []).append(m['name'])
    shared = {cid: names for cid, names in by_cid.items() if len(names) > 1}
    if shared:
        print(f'⚠ {len(shared)} cloudinary id(s) shared by >1 player '
              '(likely placeholder or slug collision):', flush=True)
        for cid, names in list(shared.items())[:15]:
            print(f'  {cid}: {", ".join(names)}')
        print()

    if unmatched:
        print('unmatched (no NFL.com page / no og:image for derived slug):', flush=True)
        for p in sorted(unmatched, key=lambda x: x['name'])[:40]:
            print(f'  - {p["name"]} [{p.get("pro_team") or "FA"}] '
                  f'-> tried {slug_candidates(p["name"])}')
        if len(unmatched) > 40:
            print(f'  ... and {len(unmatched) - 40} more')
        print()

    if not args.write:
        print('dry run — no DB writes. re-run with --write to persist.')
        return

    print('writing external_id_nba...', flush=True)
    for m in matched:
        supabase.table('players').update(
            {'external_id_nba': m['cid']}
        ).eq('id', m['id']).execute()
    print(f'done — updated {len(matched)} rows.')


if __name__ == '__main__':
    sys.exit(main())
