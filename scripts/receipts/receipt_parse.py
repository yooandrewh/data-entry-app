"""Parse OCR lines (from vision_ocr: [{"t","x","y"}]) of a Costco receipt into proposed ledger lines.
Pure functions, stdlib only. Other vendors: not parsed yet (returns vendor None)."""
import re, json
from pathlib import Path

ITEMS = json.load(open(Path(__file__).with_name("costco_items.json")))
ITEMS = {k: v for k, v in ITEMS.items() if not k.startswith("_")}

def rows(lines, tol=0.012):
    """Group OCR fragments that sit on the same printed row, left to right."""
    out, cur, cy = [], [], None
    for l in sorted(lines, key=lambda l: (l["y"], l["x"])):
        if cy is None or abs(l["y"] - cy) <= tol:
            cur.append(l); cy = l["y"] if cy is None else (cy + l["y"]) / 2
        else:
            out.append(cur); cur = [l]; cy = l["y"]
    if cur: out.append(cur)
    return [" ".join(f["t"] for f in sorted(r, key=lambda f: f["x"])).strip() for r in out]

ITEM_RE = re.compile(r"^(?:[A-Z]\s+)?(\d{3,8})\s+(.+?)\s+(\d{1,4}\.\d{2})(?:\s*[A-Z])?$")
DISC_RE = re.compile(r"^\d{3,8}\s*/\s*(\d{3,8})\b.*?(\d{1,4}\.\d{2})\s*-")
MONEY = r"(\d{1,5}\.\d{2})"

def parse(lines):
    rs = rows(lines)
    text = "\n".join(rs)
    low = text.lower()
    res = {"vendor": None, "date": None, "receipt": None, "items": [], "unknown": [], "unhandled": [],
           "tax": None, "total": None, "check": None, "rows": rs}
    if "costco" not in low: return res
    res["vendor"] = "Costco"
    m = re.search(r"WESTMINSTER|FULLERTON|BUENA PARK|LA HABRA|ANAHEIM|TUSTIN|IRVINE|GARDEN GROVE|COSTA MESA", text.upper())
    place = m.group(0).title() if m else ""
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})", text)
    if m: res["date"] = f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
    res["receipt"] = " ".join(x for x in ["Costco", place, res["date"] or ""] if x)
    qty = None   # a "3 @ 4.99" line applies to the next item row, whose printed price is the line total
    for r in rs:
        r = r.strip()
        q = re.match(r"^(\d{1,3})\s*@\s*(\d{1,4}\.\d{2})$", r)
        if q: qty = (int(q.group(1)), float(q.group(2))); continue
        m = ITEM_RE.match(r)
        if m and not re.match(r"(?i)(sub)?total|tax|visa|change", m.group(2)):
            num, label, line = m.group(1), m.group(2), float(m.group(3))
            n, price = 1, line
            if qty:
                if abs(qty[0] * qty[1] - line) < 0.015: n, price = qty
                else: res["unhandled"].append(f"quantity {qty[0]} @ {qty[1]} does not match line total {line} for #{num}")
                qty = None
            it = ITEMS.get(num)
            for _ in range(n):
                if it: res["items"].append({"num": num, "label": label, "price": price, **it})
                else: res["unknown"].append({"num": num, "label": label, "price": price})
            continue
        if DISC_RE.match(r):
            res["unhandled"].append(r); continue
        m = re.match(r"(?i)^tax\b.*?" + MONEY + r"\s*$", r)
        if m and res["tax"] is None: res["tax"] = float(m.group(1)); continue
        m = re.match(r"(?i)^\**\s*total\b.*?" + MONEY + r"\s*$", r)
        if m and res["total"] is None: res["total"] = float(m.group(1)); continue
    if res["total"] is not None:
        got = round(sum(i["price"] for i in res["items"]) + sum(u["price"] for u in res["unknown"]) + (res["tax"] or 0), 2)
        res["check"] = {"items_plus_tax": got, "receipt_total": res["total"], "ok": abs(got - res["total"]) < 0.015}
    return res

def ledger_lines(res):
    """Ledger 'add' lines for the known items (one per package) plus tax. Unapproved."""
    out = []
    for i in res["items"]:
        out.append({"receipt": res["receipt"], "date": res["date"], "vendor": res["vendor"], "kind": "item",
                    "item": i["item"], "amt": i["size"], "unit": i["unit"], "price": i["price"],
                    "note": f"item #{i['num']} {i['label']}"[:200]})
    if res["tax"]:
        out.append({"receipt": res["receipt"], "date": res["date"], "vendor": res["vendor"], "kind": "tax",
                    "price": res["tax"], "note": "receipt tax"})
    return out
