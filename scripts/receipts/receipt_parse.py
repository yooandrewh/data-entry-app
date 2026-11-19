"""Parse OCR lines (from vision_ocr: [{"t","x","y"}]) of a Costco or Target receipt into proposed ledger lines.
Pure functions, stdlib only. Other vendors: not parsed yet (returns vendor None)."""
import re, json
from pathlib import Path

ITEMS = json.load(open(Path(__file__).with_name("costco_items.json")))
ITEMS = {k: v for k, v in ITEMS.items() if not k.startswith("_")}
TARGET_ITEMS = {k: v for k, v in json.load(open(Path(__file__).with_name("target_items.json"))).items() if not k.startswith("_")}

# A phone photo can reach the OCR sideways or upside down (EXIF rotation is not applied). Try the four turns and keep the one
# whose rows look most like a receipt (item rows and a TOTAL row).
_TURNS = [lambda x, y: (x, y), lambda x, y: (1 - y, x), lambda x, y: (y, 1 - x), lambda x, y: (1 - x, 1 - y)]
def orient(lines):
    best, bs = lines, -1
    for f in _TURNS:
        ls = [dict(l, x=f(l["x"], l["y"])[0], y=f(l["x"], l["y"])[1]) for l in lines]
        rs = rows(ls)
        sc = sum(3 for r in rs if re.search(r"(?i)^\**\s*total\b.*\d+\.\d{2}", r)) + sum(1 for r in rs if re.search(r"\b\d{6,9}\b.*\d+\.\d{2}", r)) + sum(1 for r in rs if re.search(r"(?i)\bsubtotal\b.*\d+\.\d{2}", r))
        if sc > bs: best, bs = ls, sc
    return best

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
    rs = rows(orient(lines))
    text = "\n".join(rs)
    low = text.lower()
    res = {"vendor": None, "date": None, "receipt": None, "items": [], "unknown": [], "unhandled": [],
           "tax": None, "total": None, "check": None, "rows": rs, "fees": []}
    if "costco" not in low and re.search(r"\btarget\b", low): return parse_target(rs, text, res)
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

def parse_target(rs, text, res):
    """Target: rows look like `261050498 GG MILK NF $14.07`, then `3 @ $4.69 ea` (quantity line comes AFTER its item; the item's price is the line total).
    Bag fees and an order-level % discount (`5% off Birthday $4.11 -`) become fee lines (negative for the discount), spread over the items like tax."""
    res["vendor"] = "Target"
    m = re.search(r"(\d{2})/(\d{2})/(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?", text)
    hhmm = ""
    if m:
        res["date"] = f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
        h = int(m.group(4)) % 12 + (12 if (m.group(6) or "").upper() == "PM" else 0)
        hhmm = f"{h:02d}{m.group(5)}"
    else:
        m = re.search(r"(\d{2})/(\d{2})/(\d{4})", text)
        if m: res["date"] = f"{m.group(3)}-{m.group(1)}-{m.group(2)}"
    pm = re.search(r"([A-Z][A-Za-z ]+?)\s*-\s*\(?\d{3}\)?[-\s]\d{3}-\d{4}", text)
    place = pm.group(1).strip() if pm else ""
    res["receipt"] = " ".join(x for x in ["Target", place, res["date"] or "", hhmm] if x)
    cur = None   # last item row, waiting for its optional "N @ price ea" line
    recs = []
    for r in rs:
        r = r.strip()
        q = re.match(r"^(\d{1,3})\s*@\s*\$?(\d{1,4}\.\d{2})\s*ea\.?$", r, re.I)
        if q:
            if cur is None: res["unhandled"].append(f"quantity line without an item: {r}")
            else:
                n, unit = int(q.group(1)), float(q.group(2))
                if abs(n * unit - cur["line"]) < 0.015: cur["n"], cur["price"] = n, unit
                else: res["unhandled"].append(f"quantity {n} @ {unit} does not match line total {cur['line']} for #{cur['num']}")
            cur = None; continue
        m = re.match(r"^(\d{9})\s+(.+?)\s+(?:[A-Z]{1,2}\s+)?\$?(\d{1,4}\.\d{2})$", r)
        if m:
            cur = {"num": m.group(1), "label": m.group(2), "line": float(m.group(3)), "n": 1, "price": float(m.group(3))}
            recs.append(cur); continue
        cur = None
        m = re.match(r"(?i)^bag fee\b.*?\$?(\d{1,4}\.\d{2})$", r)
        if m: res["fees"].append({"price": float(m.group(1)), "note": "Target bag fee"}); continue
        m = re.match(r"^(\d{1,2})%\s*off\b(.*?)\$?(\d{1,4}\.\d{2})\s*-$", r, re.I)
        if m: res["fees"].append({"price": -float(m.group(3)), "note": f"Target {m.group(1)}% off{m.group(2)}".strip()[:100]}); continue
        m = re.match(r"(?i)^(?:no tax|tax)\b.*?\$?(\d{1,4}\.\d{2})$", r)
        if m and res["tax"] is None: res["tax"] = float(m.group(1)); continue
        m = re.match(r"(?i)^\**\s*total\b.*?\$?(\d{1,5}\.\d{2})$", r)
        if m and res["total"] is None: res["total"] = float(m.group(1)); continue
        if re.search(r"\d\.\d{2}\s*-$", r): res["unhandled"].append(r)   # any other discount / coupon line
    for c in recs:
        if c["line"] <= 0: continue   # $0.00 lines (the paper bag) carry nothing to record
        it = TARGET_ITEMS.get(c["num"])
        for _ in range(c["n"]):
            if it: res["items"].append({"num": c["num"], "label": c["label"], "price": c["price"], **it})
            else: res["unknown"].append({"num": c["num"], "label": c["label"], "price": c["price"]})
    if res["total"] is not None:
        got = round(sum(i["price"] for i in res["items"]) + sum(u["price"] for u in res["unknown"]) + sum(f["price"] for f in res["fees"]) + (res["tax"] or 0), 2)
        res["check"] = {"items_plus_tax": got, "receipt_total": res["total"], "ok": abs(got - res["total"]) < 0.015}
    return res

def ledger_lines(res):
    """Ledger 'add' lines for the known items (one per package) plus tax. Unapproved."""
    out = []
    for i in res["items"]:
        out.append({"receipt": res["receipt"], "date": res["date"], "vendor": res["vendor"], "kind": "item",
                    "item": i["item"], "amt": i["size"], "unit": i["unit"], "price": i["price"],
                    "note": f"item #{i['num']} {i['label']}"[:200]})
    for f in res.get("fees", []):
        out.append({"receipt": res["receipt"], "date": res["date"], "vendor": res["vendor"], "kind": "fee",
                    "price": f["price"], "note": f["note"]})
    if res["tax"]:
        out.append({"receipt": res["receipt"], "date": res["date"], "vendor": res["vendor"], "kind": "tax",
                    "price": res["tax"], "note": "receipt tax"})
    return out
