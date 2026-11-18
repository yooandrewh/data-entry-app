#!/usr/bin/env python3
"""Daily snapshot of the app's Sheet data, read through the app's own open GET endpoints (no keys needed).
Writes ~/.kairos-backups/YYYY-MM-DD/<endpoint>.json, checks each file parses and is non-empty, keeps the newest 30 days.
Run by hand or from the LaunchAgent in com.kairos.backup.plist. Stays quiet when fine; exits 1 and logs if any endpoint failed."""
import json, os, shutil, sys, urllib.request, datetime as D

BASE = 'https://data-entry-app-roan.vercel.app/api/'
ENDPOINTS = ['entries', 'sales', 'ledger', 'pantry', 'bakes', 'storage', 'store-sales', 'store-stats']
ROOT = os.path.expanduser('~/.kairos-backups')
KEEP_DAYS = 30

def main():
    day = D.date.today().isoformat()
    out = os.path.join(ROOT, day); os.makedirs(out, exist_ok=True)
    bad = []
    for e in ENDPOINTS:
        try:
            req = urllib.request.Request(BASE + e, headers={'User-Agent': 'kairos-backup'})
            raw = urllib.request.urlopen(req, timeout=60).read()
            data = json.loads(raw)
            if not isinstance(data, (dict, list)): raise ValueError('unexpected shape')
            tmp = os.path.join(out, e + '.json.tmp')
            with open(tmp, 'wb') as f: f.write(raw)
            os.replace(tmp, os.path.join(out, e + '.json'))
        except Exception as ex:
            bad.append(f'{e}: {ex}')
    # Prune old snapshot folders (only dated folders directly under ROOT).
    cutoff = (D.date.today() - D.timedelta(days=KEEP_DAYS)).isoformat()
    for d in os.listdir(ROOT):
        p = os.path.join(ROOT, d)
        if os.path.isdir(p) and len(d) == 10 and d[4] == '-' and d < cutoff and not os.path.islink(p):
            shutil.rmtree(p)
    if bad:
        print(D.datetime.now().isoformat(timespec='seconds'), 'FAILED', '; '.join(bad)); sys.exit(1)
    print(D.datetime.now().isoformat(timespec='seconds'), 'ok', day, len(ENDPOINTS), 'files')

if __name__ == '__main__':
    main()
