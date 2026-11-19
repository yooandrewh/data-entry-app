#!/usr/bin/env python3
"""Receipt parser checks. Run: python3 scripts/receipts/tests/run.py  (stdlib only, no network, no OCR).
Fixtures in tests/fixtures are OCR lines ([{"t","x","y"}]) of real receipts (personal numbers blanked) plus one synthetic Costco receipt."""
import sys, json, copy
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import receipt_parse as P

FAILS = []
def check(name, cond, detail=""):
    print(("ok   " if cond else "FAIL ") + name + ("" if cond else f"  {detail}"))
    if not cond: FAILS.append(name)
def load(n): return json.load(open(HERE / "fixtures" / f"{n}.json"))["lines"]
def turn(lines, k):   # rotate normalised coordinates like a sideways photo
    f = P._TURNS[k]
    return [dict(l, x=f(l["x"], l["y"])[0], y=f(l["x"], l["y"])[1]) for l in lines]

# (An upside-down photo OCRs as garbage, so the 180 turn is the poller's job: it retries with the image rotated.)
# ---- Costco Yorba Linda: sideways, tilted, TOTAL misread, no date on the photo ----
for n in ("costco_yorba_linda_sideways", "costco_yorba_linda_rot90", "costco_yorba_linda_rot270"):
    r = P.parse(load(n))
    check(f"{n}: vendor Costco", r["vendor"] == "Costco", r["vendor"])
    check(f"{n}: receipt id", r["receipt"] == "Costco Yorba Linda", r["receipt"])
    check(f"{n}: 23 known items", len(r["items"]) == 23, len(r["items"]))
    check(f"{n}: unknown = milk, blueberry, vanilla bean, sour cream", sorted(u["label"] for u in r["unknown"]).count("KS BLUEBERRY") == 10 and len(r["unknown"]) == 15, r["unknown"])
    check(f"{n}: 3 coupons kept as negative fees", sorted(f["price"] for f in r["fees"]) == [-4.0, -4.0, -3.0], r["fees"])
    check(f"{n}: total from subtotal+tax checks", r["check"] and r["check"]["ok"] and r["total"] == 417.32 and "subtotal" in r["check"].get("note", ""), r["check"])
    check(f"{n}: date unreadable -> None (photo cut off)", r["date"] is None, r["date"])
    check(f"{n}: unknown list names numbers and prices", "#815544 KS BLUEBERRY 9.59 x10" in P.unknown_summary(r), P.unknown_summary(r))
# same photo with every coordinate turned by hand
for k in (1, 2, 3):
    r = P.parse(turn(load("costco_yorba_linda_sideways"), k))
    check(f"yorba coordinates turned {k}: still reads", r["vendor"] == "Costco" and len(r["items"]) == 23 and r["check"] and r["check"]["ok"], (r["vendor"], len(r["items"]), r["check"]))

# ---- Target and Amazon samples (must not be mistaken for Costco) ----
r = P.parse(load("target_anaheim_hills"))
check("target: vendor / date / id", r["vendor"] == "Target" and r["date"] == "2026-11-18" and r["receipt"].startswith("Target Anaheim Hills 2026-11-18"), (r["vendor"], r["date"], r["receipt"]))
check("target: 35 items, none unknown, discount + bag fee kept", len(r["items"]) == 35 and not r["unknown"] and sorted(f["price"] for f in r["fees"]) == [-4.11, 0.2], (len(r["items"]), r["fees"]))
check("target: total checks (78.24)", r["check"] and r["check"]["ok"] and r["total"] == 78.24, r["check"])
r = P.parse(load("amazon_order_cacao_butter"), ["Cocoa Butter"])
check("amazon: vendor / date / id", r["vendor"] == "Amazon" and r["date"] == "2026-11-18" and r["receipt"] == "Amazon 113-0000000-0000000", (r["vendor"], r["date"], r["receipt"]))
check("amazon: 1 item, Subscribe & Save as a negative fee, total 45.89", len(r["items"]) == 1 and [f["price"] for f in r["fees"]] == [-5.1] and r["check"] and r["check"]["ok"] and r["total"] == 45.89, (len(r["items"]), r["fees"], r["check"]))

# ---- Synthetic Costco Westminster receipt (stands in for the 2026-11-12 one, which has no saved photo) ----
def rowsfrom(texts):
    out = []
    for i, t in enumerate(texts):
        y = 0.05 + i * 0.02
        if isinstance(t, tuple): out += [{"t": t[0], "x": 0.2, "y": y}, {"t": t[1], "x": 0.8, "y": y}]
        else: out.append({"t": t, "x": 0.3, "y": y})
    return out
WEST = ["COSTCO", "WHOLESALE", "Westminster #1234", "11/12/2026 14:03",
        "3 @ 4.99", ("E 1752247 CORNSTARCH", "14.97"), ("F 1593426 KS KOSHER SALT", "2.99"), ("801465 CH LT BRN SUGR", "22.89"),
        ("E 0000355123 / 801465", "3.00-"), "2 @ 7.29 737675 CH POWDERED SUGR 14.58",
        ("SUBTOTAL", "52.43"), ("TAX", "0.00"), ("**** TOTAL", "52.43")]
r = P.parse(rowsfrom(WEST))
check("westminster: vendor / date / id", r["vendor"] == "Costco" and r["date"] == "2026-11-12" and r["receipt"] == "Costco Westminster 2026-11-12", (r["vendor"], r["date"], r["receipt"]))
check("westminster: 7 items (flags, qty lines incl. a wrapped one), none unknown", len(r["items"]) == 7 and not r["unknown"], (len(r["items"]), r["unknown"]))
check("westminster: coupon is a -3.00 fee, total checks", [f["price"] for f in r["fees"]] == [-3.0] and r["check"]["ok"] and "note" not in r["check"], (r["fees"], r["check"]))
bad = [x if not (isinstance(x, tuple) and x[0] == "**** TOTAL") else ("**** TOTAL", "5Z.4B") for x in WEST]
r = P.parse(rowsfrom(bad))
check("westminster, TOTAL unreadable: accepted via subtotal+tax", r["check"] and r["check"]["ok"] and r["total"] == 52.43 and r["check"].get("note"), r["check"])
bad2 = [x if not (isinstance(x, tuple) and x[0] == "SUBTOTAL") else ("SUBTOTAL", "60.00") for x in bad]
r = P.parse(rowsfrom(bad2))
check("westminster, TOTAL unreadable and items do not add up to subtotal: not accepted", not (r["check"] and r["check"]["ok"]), r["check"])
unk = [x if not (isinstance(x, tuple) and "SALT" in x[0]) else ("F 9999999 MYSTERY ITEM", "2.99") for x in WEST]
r = P.parse(rowsfrom(unk))
check("unknown item number is listed with name and price", P.unknown_summary(r) == ["#9999999 MYSTERY ITEM 2.99"], P.unknown_summary(r))

# ---- vendor detection must not loosen too far ----
other = rowsfrom(["Smart Foods Wholesale", "Sunset Blvd", "11/12/2026", ("FLOUR 50LB", "20.00"), ("TOTAL", "20.00")])
check("'wholesale' alone (no warehouse # or member line) is not Costco", P.parse(other)["vendor"] != "Costco", P.parse(other)["vendor"])
check("COST + WHOLESALE is Costco", P.is_costco("cost\nwholesale\nyorba linda"))
check("WHOLESALE + #445 is Costco", P.is_costco("wholesale\nyorba linda #445"))
check("Target text is not Costco", not P.is_costco("target\nanaheim hills\n11/18/2026"))

print(f"\n{len(FAILS)} failed" if FAILS else "\nall passed")
sys.exit(1 if FAILS else 0)
