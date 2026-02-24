"""
Fetch the NBA official injury report PDF and sync statuses to Supabase.

The NBA publishes injury reports as PDFs at:
  https://ak-static.cms.nba.com/referee/injury/Injury-Report_YYYY-MM-DD_HH_MMAM.pdf

This script downloads the most recent report, parses it with pdfplumber,
and POSTs the injury data to the poll-injuries edge function.

Usage:
    python sync_injuries.py              # one-shot sync
    python sync_injuries.py --loop 2     # sync every 2 hours continuously
"""

import sys
import time
import io
from datetime import datetime, timedelta, timezone

import pdfplumber
import requests

SUPABASE_URL = 'https://iuqbossmnsezzgocpcbo.supabase.co'
EDGE_FN_URL = f'{SUPABASE_URL}/functions/v1/poll-injuries'

PDF_BASE = 'https://ak-static.cms.nba.com/referee/injury/Injury-Report_{date}_{time}.pdf'

VALID_STATUSES = {'Out', 'Questionable', 'Doubtful', 'Probable', 'Day-To-Day', 'Game Time Decision', 'GTD'}

STATUS_MAP = {
    'out': 'OUT',
    'suspended': 'SUSP',
    'doubtful': 'DOUBT',
    'day-to-day': 'DTD',
    'game time decision': 'GTD',
    'gtd': 'GTD',
    'questionable': 'QUES',
}


def build_pdf_urls():
    """Generate candidate PDF URLs for the last few snapshots."""
    now = datetime.now(timezone(timedelta(hours=-5)))  # ET
    urls = []
    for offset_min in range(0, 120, 15):  # try last 2 hours of 15-min snapshots
        t = now - timedelta(minutes=offset_min)
        date_str = t.strftime('%Y-%m-%d')
        hour12 = t.hour % 12 or 12
        ampm = 'AM' if t.hour < 12 else 'PM'
        rounded_min = (t.minute // 15) * 15
        time_str = f'{hour12:02d}_{rounded_min:02d}{ampm}'
        urls.append(PDF_BASE.format(date=date_str, time=time_str))
    return urls


def download_pdf():
    """Download the most recent injury report PDF."""
    urls = build_pdf_urls()
    for url in urls:
        try:
            resp = requests.get(url, timeout=15, headers={
                'Referer': 'https://www.nba.com/',
                'Origin': 'https://www.nba.com',
            })
            if resp.status_code == 200:
                print(f'  Downloaded: {url} ({len(resp.content)} bytes)')
                return resp.content, url
        except requests.RequestException:
            continue
    return None, None


import re

# Pattern: "LastName,FirstName Status Reason..." or "LastNameSuffix,FirstName Status ..."
# Status keywords appear right after the name and are one of our known values.
PLAYER_LINE_RE = re.compile(
    r'([A-Z][a-zA-Z\'\-\.]+(?:(?:Jr|Sr|III|II|IV)\.?)?,\s*[A-Z][a-zA-Z\'\-\.]+)'
    r'\s+'
    r'(Out|Questionable|Doubtful|Probable|Day-To-Day|Available)'
    r'(?:\s|$)',
)


def parse_injuries(pdf_bytes):
    """Extract injury data from the PDF text using regex."""
    injuries = []
    seen = set()
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ''
            for match in PLAYER_LINE_RE.finditer(text):
                raw_name = match.group(1).strip()
                raw_status = match.group(2).strip()

                # Convert "Last,First" to "First Last"
                parts = [p.strip() for p in raw_name.split(',', 1)]
                if len(parts) == 2:
                    last, first = parts
                    # Fix concatenated suffixes: "ButlerIII" -> "Butler III"
                    last = re.sub(r'(Jr|Sr)(\.?)$', r' \1\2', last)
                    last = re.sub(r'(I{2,3}|IV)$', r' \1', last)
                    name = f'{first} {last}'
                else:
                    name = raw_name

                mapped = STATUS_MAP.get(raw_status.lower())
                if not mapped:
                    continue  # skip Available/Probable

                key = name.lower()
                if key in seen:
                    continue
                seen.add(key)

                injuries.append({'player_name': name, 'status': mapped})

    return injuries


def sync_once():
    """Run one sync cycle."""
    print(f'[{datetime.now().strftime("%H:%M:%S")}] Fetching NBA injury report...')
    pdf_bytes, url = download_pdf()
    if not pdf_bytes:
        print('  No injury report PDF found.')
        return

    injuries = parse_injuries(pdf_bytes)
    print(f'  Parsed {len(injuries)} injuries from PDF.')

    if not injuries:
        print('  No injuries to sync.')
        return

    # Post to edge function
    resp = requests.post(EDGE_FN_URL, json={'injuries': injuries}, timeout=15)
    result = resp.json()
    print(f'  Edge function response: {result}')


def main():
    loop_hours = None
    if '--loop' in sys.argv:
        idx = sys.argv.index('--loop')
        loop_hours = float(sys.argv[idx + 1]) if idx + 1 < len(sys.argv) else 2

    if loop_hours:
        print(f'Running injury sync every {loop_hours} hours. Press Ctrl+C to stop.')
        while True:
            try:
                sync_once()
                print(f'  Next sync in {loop_hours} hours.\n')
                time.sleep(loop_hours * 3600)
            except KeyboardInterrupt:
                print('\nStopped.')
                break
    else:
        sync_once()


if __name__ == '__main__':
    main()
