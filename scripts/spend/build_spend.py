#!/usr/bin/env python3
"""Builds the rows of the app's Spend tab (Profit page) from the receipts backfill and the Ledger, then pushes them.

Sources (all outside the repo, nothing printed):
  ~/kairos-receipts-backfill/out/transactions.csv  one row per receipt line, with final_category / include_in_business
  ~/kairos-receipts-backfill/out/receipts.csv      one row per receipt, adjusted_grand_total = what was really paid
  the live /api/ledger                             real receipts from 2026-11-01 on (listing-* / seed-* lines are price lists, skipped)

Rows: Date, Vendor, Receipt, Item, Qty, Amount, Category, Note.
Category = ingredient | supplies_equipment | other. Personal-item lines and lines removed by Andrew's red X are left out.
Each receipt also gets one "other" row = adjusted total - the item lines (shipping, tax, fees, credits, refunds, gift cards), so a
receipt's rows always add up to what was paid. The replace is whole-tab (same as the CRM): run it again to refresh.

Usage:  build_spend.py            writes the rows to ~/kairos-receipts-backfill/out/spend_rows.json and prints month totals
        build_spend.py --push     also replaces the Spend tab (code from ~/.kairos-ledger-code)"""
import csv, json, sys, os, collections, urllib.request
from pathlib import Path
OUT = Path.home() / "kairos-receipts-backfill/out"
BASE = os.environ.get("KAIROS_API", "https://data-entry-app-roan.vercel.app")
f = lambda x: float(x) if x not in ("", None) else 0.0
TRUE = ("TRUE", "True", "true", "1")

def zip_rows():
    R = list(csv.DictReader(open(OUT / "receipts.csv")))
    T = list(csv.DictReader(open(OUT / "transactions.csv")))
    by = collections.defaultdict(list)
    for t in T: by[t["source_file"]].append(t)
    rows = []
    for r in R:
        rid = f"{r['vendor']} {r['order_or_invoice_number']}"[:40]
        paid = f(r["adjusted_grand_total"] or r["grand_total_stated"])
        kept = 0.0
        for t in by[r["source_file"]]:
            if t["kind"] != "item" or t["removed"] in TRUE: continue
            amt = f(t["line_net"]) + f(t["tax_allocated"])
            if t["include_in_business"] != "yes":
                paid -= amt            # a personal line is not part of the business cost
                continue
            kept += amt
            rows.append([r["date"], r["vendor"], rid, t["description"][:120], f(t["qty"]) or 1, round(amt, 2), t["final_category"], (t["notes"] or "")[:200]])
        rest = round(paid - kept, 2)
        if abs(rest) >= 0.005:
            rows.append([r["date"], r["vendor"], rid, "Shipping, tax, fees, credits, refunds", 1, rest, "other", ""])
    return rows

SUPPLIES = ("pan liner", "glove", "cambro", "pipette", "piping bag", "squeeze bottle")
def nov_rows():
    """Real receipts dated 2026-11-01 or later that are in the Ledger (the zip stops before them; Chefs' Toys is in the zip)."""
    L = json.load(urllib.request.urlopen(BASE + "/api/ledger", timeout=60))["rows"]
    g = collections.OrderedDict()
    for r in L:
        rc = r["receipt"]
        if r["date"] < "2026-11-01" or rc.startswith(("listing", "amazon-listing", "seed")): continue
        g.setdefault(rc, []).append(r)
    rows = []
    for rc, ls in g.items():
        v, d = ls[0]["vendor"], ls[0]["date"]
        item_total = 0.0
        for r in ls:
            if r["kind"] == "item":
                cat = "supplies_equipment" if any(s in r["item"].lower() for s in SUPPLIES) else "ingredient"
                rows.append([d, v, rc[:40], r["item"][:120], 1, round(r["price"], 2), cat, (r["note"] or "")[:200]])
                item_total += r["price"]
            elif r["kind"] in ("fee", "tax"):
                rows.append([d, v, rc[:40], "Shipping, tax, fees, credits, refunds", 1, round(r["price"], 2), "other", ""])
    return rows

def main():
    rows = zip_rows() + nov_rows()
    rows.sort(key=lambda r: (r[0], r[2]))
    json.dump(rows, open(OUT / "spend_rows.json", "w"))
    m = collections.defaultdict(lambda: collections.defaultdict(float))
    for r in rows: m[r[0][:7]][r[6]] += r[5]
    for k in sorted(m):
        t = sum(m[k].values())
        print(k, {c: round(v) for c, v in m[k].items()}, "total", round(t, 2))
    print(len(rows), "rows")
    if "--push" in sys.argv:
        code = (Path.home() / ".kairos-ledger-code").read_text().strip()
        req = urllib.request.Request(BASE + "/api/spend", data=json.dumps({"action": "replace", "rows": rows}).encode(),
                                     headers={"Content-Type": "application/json", "x-ledger-code": code})
        print(json.load(urllib.request.urlopen(req, timeout=120)))

if __name__ == "__main__": main()
