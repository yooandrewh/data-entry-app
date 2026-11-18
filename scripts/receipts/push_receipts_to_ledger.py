#!/usr/bin/env python3
"""Push proposed receipt lines (from receipt_inbox_watch.py) to the app's Ledger as UNAPPROVED lines.
Dry run by default; --write posts. Skips a receipt whose id is already in the Ledger, and a receipt that is
not complete (unknown item numbers, unhandled discounts, or total mismatch) unless --allow-partial.
Ledger code comes from ~/.kairos-ledger-code (never printed). Stdlib only."""
import sys, os, json, urllib.request
from pathlib import Path
API = os.environ.get("KAIROS_API", "https://data-entry-app-roan.vercel.app") + "/api/ledger"
WORK = Path(os.environ.get("KAIROS_RECEIPTS_WORK", Path.home()/"Downloads/kairos_videos_raw/receipts"))
WRITE, PARTIAL = "--write" in sys.argv, "--allow-partial" in sys.argv
def call(body=None):
    code = (Path.home()/".kairos-ledger-code").read_text().strip() if body else ""
    req = urllib.request.Request(API, data=json.dumps(body).encode() if body else None,
                                 headers={"Content-Type": "application/json", "x-ledger-code": code})
    return json.load(urllib.request.urlopen(req, timeout=30))
def main():
    props = json.load(open(WORK/"proposed.json"))
    if not props: print("nothing proposed"); return
    existing = {r.get("receipt") for r in call().get("rows", [])}
    for p in props:
        tag = f"{p['receipt']}  ({len(p['lines'])} lines)"
        if p["receipt"] in existing: print(f"SKIP already in ledger: {tag}"); continue
        if not p["complete"] and not PARTIAL: print(f"HOLD incomplete (fix costco_items.json or enter by hand): {tag}"); continue
        print(("WRITE " if WRITE else "DRY   ") + tag)
        for l in p["lines"]: print(f"   {l['kind']:4} {l.get('item',''):18} {l.get('amt','')!s:>8} {l.get('unit','')} ${l['price']:.2f}")
        if WRITE:
            for i in range(0, len(p["lines"]), 80):
                print("   ->", call({"action": "add", "lines": p["lines"][i:i+80]}))
    if not WRITE: print("\ndry run: nothing written. Re-run with --write to post (lines stay unapproved).")
main()
