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

def parse(lines, names=None):
    """names: ledger item names (for matching products on Amazon and unknown-vendor receipts)."""
    rs = rows(orient(lines))
    text = "\n".join(rs)
    low = text.lower()
    res = {"vendor": None, "date": None, "receipt": None, "items": [], "unknown": [], "unhandled": [],
           "tax": None, "total": None, "check": None, "rows": rs, "fees": []}
    if "costco" not in low and re.search(r"\btarget\b", low): return parse_target(rs, text, res)
    if "costco" not in low and re.search(r"order summary|order #\s*\d{3}-\d{7}-\d{7}|amazon", low) and re.search(r"order #\s*\d{3}-", low): return parse_amazon(rs, text, res, names)
    if "costco" not in low: return parse_generic(rs, text, res, names)
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

# ---- Product -> ledger item for receipts that print a product name (Amazon, other stores) ----
AMAZON_ITEMS = {k: v for k, v in json.load(open(Path(__file__).with_name("amazon_items.json"))).items() if not k.startswith("_")}
_UNITS = [(r"fl\.?\s*oz|fluid ounces?", 29.5735, "ml"), (r"lbs?\b|pounds?", 453.592, "g"), (r"oz\b|ounces?", 28.3495, "g"), (r"kg\b|kilograms?", 1000, "g"),
          (r"ml\b|milliliters?", 1, "ml"), (r"gal(?:lons?)?\b", 3785.41, "ml"), (r"liters?\b|litres?\b|\bl\b", 1000, "ml"), (r"g\b|grams?", 1, "g"),
          (r"ct\b|count\b|pcs\b|pieces\b", 1, "g")]   # a count is stored as "g" and shown in pieces, like the app's other counted items
def parse_size(label):
    """First plain size in a product name ('2 lb', '16 oz', '4 fl oz', '100 ct') -> (amount, unit); None when absent or a multipack ('2 x 16 oz')."""
    t = label.lower()
    if re.search(r"\d\s*(?:x|pack|ct\s*of)\s*\d|\d+\s*pack\b|pack of \d", t): return None
    for pat, mult, unit in _UNITS:
        m = re.search(r"(\d+(?:\.\d+)?)\s*-?\s*(?:" + pat + ")", t)
        if m: return round(float(m.group(1)) * mult, 1), unit
    return None
_ALIAS = {"cacao": "cocoa"}
def guess_item(label, names):
    """Ledger item whose words all appear in the product name (longest name wins, must be unique) + the size printed in it."""
    if not names: return None
    words = set(re.findall(r"[a-z]+", " ".join(_ALIAS.get(w, w) for w in re.findall(r"[a-z]+", label.lower()))))
    hits = []
    for n in set(names):
        ws = re.findall(r"[a-z]+", n.lower())
        if ws and all(w in words or w + "s" in words or (w.endswith("s") and w[:-1] in words) for w in ws): hits.append((len(ws), n))
    if not hits: return None
    top = max(h[0] for h in hits); best = [n for k, n in hits if k == top]
    sz = parse_size(label)
    if len(best) != 1 or not sz: return None
    return {"item": best[0], "size": sz[0], "unit": sz[1], "what": "auto-matched from the product name: check item and size"}
def match_product(label, names):
    low = label.lower()
    for k, v in AMAZON_ITEMS.items():
        if k in low: return v
    return guess_item(label, names)

def _fill(res):
    if res["total"] is not None:
        got = round(sum(i["price"] for i in res["items"]) + sum(u["price"] for u in res["unknown"]) + sum(f["price"] for f in res["fees"]) + (res["tax"] or 0), 2)
        res["check"] = {"items_plus_tax": got, "receipt_total": res["total"], "ok": abs(got - res["total"]) < 0.015}
    return res

MONTHS = {m: i + 1 for i, m in enumerate("january february march april may june july august september october november december".split())}
def _date(text):
    m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", text)
    if m: return f"{m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    m = re.search(r"([A-Za-z]{3,9})\.? (\d{1,2}), (\d{4})", text)
    if m and m.group(1).lower() in MONTHS: return f"{m.group(3)}-{MONTHS[m.group(1).lower()]:02d}-{int(m.group(2)):02d}"
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", text)
    return m.group(0) if m else None

def parse_amazon(rs, text, res, names):
    """Amazon order summary (screenshot or page): title row after 'Arriving/Delivered', price row after 'Sold by', then Subtotal /
    Shipping / Subscribe & Save and other '-$x' lines (negative fees) / tax / Grand Total."""
    res["vendor"] = "Amazon"; res["date"] = _date(text)
    m = re.search(r"Order #\s*([\d-]{15,})", text)
    res["receipt"] = "Amazon " + (m.group(1) if m else (res["date"] or ""))
    title = None; sold = False; qty = 1; items = []
    for r in rs:
        r = r.strip()
        if re.match(r"(?i)^(arriving|delivered|shipped|arrived|now arriving|out for delivery|preparing)\b", r): title, sold = "", False; items_open = True; continue
        if title == "" and not re.match(r"(?i)^(sold by|supplied by|\$)", r): title = r; continue
        if title and re.match(r"(?i)^sold by", r): sold = True; continue
        mq = re.match(r"(?i)^qty:?\s*(\d+)$", r)
        if mq and title: qty = int(mq.group(1)); continue
        mp = re.match(r"^\$(\d{1,4}(?:,\d{3})*\.\d{2})$", r)
        if mp and title and sold:
            items.append({"label": title, "price": float(mp.group(1).replace(",", "")), "n": qty}); title, sold, qty = None, False, 1; continue
        m = re.search(r"(?i)shipping\s*&\s*handling:?\s*\$(\d+\.\d{2})", r)
        if m and float(m.group(1)) > 0: res["fees"].append({"price": float(m.group(1)), "note": "Amazon shipping"})
        m = re.search(r"(?i)([A-Za-z&' ]{3,40}?):\s*-\s*\$(\d+\.\d{2})", r)
        if m: lab = "Subscribe & Save" if re.search(r"(?i)subscribe", m.group(1)) else m.group(1).strip()[-40:]; res["fees"].append({"price": -float(m.group(2)), "note": "Amazon " + lab}); continue
        m = re.search(r"(?i)\btax\b.*?\$(\d+\.\d{2})", r)
        if m and res["tax"] is None and not re.search(r"(?i)before tax", r): res["tax"] = float(m.group(1))
        m = re.search(r"(?i)grand total:?\s*\$(\d{1,5}(?:,\d{3})*\.\d{2})", r)
        if m and res["total"] is None: res["total"] = float(m.group(1).replace(",", ""))
    for it in items:
        v = match_product(it["label"], names)
        for _ in range(it["n"]):
            if v: res["items"].append({"num": "", "label": it["label"], "price": it["price"], **v})
            else: res["unknown"].append({"num": "", "label": it["label"][:60], "price": it["price"]})
    if not items: res["unhandled"].append("no items found in the order")
    return _fill(res)

def parse_generic(rs, text, res, names):
    """Any other store: vendor = first text row, rows ending in a price are items (matched to ledger names), tax and total rows. Held unless the total adds up."""
    top = next((r for r in rs[:6] if re.search(r"[A-Za-z]{3,}", r) and not re.search(r"\d{3}[-\s]\d{3,4}|\d{5}", r)), None)
    res["date"] = _date(text)
    if not top or not res["date"] or not re.search(r"(?i)\btotal\b", text): return res   # not recognisably a receipt
    res["vendor"] = re.sub(r"[^A-Za-z0-9&' ]", "", top).strip().title()[:30]
    res["receipt"] = f"{res['vendor']} {res['date']}"
    for r in rs:
        r = r.strip()
        m = re.match(r"(?i)^(?:sales\s+)?tax\b.*?\$?(\d{1,4}\.\d{2})$", r)
        if m and res["tax"] is None: res["tax"] = float(m.group(1)); continue
        m = re.match(r"(?i)^\**\s*(?:grand\s+)?total\b.*?\$?(\d{1,5}\.\d{2})$", r)
        if m and res["total"] is None: res["total"] = float(m.group(1)); continue
        if re.match(r"(?i)^(sub\s*total|change|cash|visa|mastercard|amex|debit|credit|balance|tendered|payment|card)", r): continue
        m = re.match(r"^(?:\d+\s*[x@]\s*)?([A-Za-z].{2,60}?)\s+\$?(\d{1,4}\.\d{2})\s*[A-Z]?$", r)
        if m:
            v = guess_item(m.group(1), names)
            if v: res["items"].append({"num": "", "label": m.group(1), "price": float(m.group(2)), **v})
            else: res["unknown"].append({"num": "", "label": m.group(1)[:60], "price": float(m.group(2))})
    return _fill(res)

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
                    "note": (f"item #{i['num']} {i['label']}" if i.get("num") else f"{i['label']}" + (" (auto-matched: check)" if "auto-matched" in i.get("what", "") else ""))[:200]})
    for f in res.get("fees", []):
        out.append({"receipt": res["receipt"], "date": res["date"], "vendor": res["vendor"], "kind": "fee",
                    "price": f["price"], "note": f["note"]})
    if res["tax"]:
        out.append({"receipt": res["receipt"], "date": res["date"], "vendor": res["vendor"], "kind": "tax",
                    "price": res["tax"], "note": "receipt tax"})
    return out
