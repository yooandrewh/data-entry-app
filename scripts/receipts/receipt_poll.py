#!/usr/bin/env python3
"""Mac side of the app's receipt photo upload. Runs every few minutes (LaunchAgent) and never needs iCloud.
Asks the app for photos waiting in the inbox -> Apple Vision OCR (the same vision_ocr binary as the sales
videos) -> parse (Costco) -> posts UNAPPROVED ledger lines -> reports done / held / failed back to the app.
Rules: a receipt already in the Ledger is not posted again; one with an unknown item number, a coupon line,
a quantity mismatch or a total that does not add up is HELD (nothing posted) with the reason shown in the app.
The photo is processed from memory + one temp file that is deleted at once; the app blanks its copy after the result.
Code comes from ~/.kairos-ledger-code (never printed). Stdlib only. Usage: receipt_poll.py [--dry]"""
import sys, os, json, base64, subprocess, tempfile, urllib.request, urllib.error
from pathlib import Path
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from receipt_parse import parse, ledger_lines, unknown_summary
BASE = os.environ.get("KAIROS_API", "https://data-entry-app-roan.vercel.app")
VISION = Path(os.environ.get("KAIROS_VISION", Path.home()/".kairos-receipts/bin/vision_ocr"))
DRY = "--dry" in sys.argv
def code(): return (Path.home()/".kairos-ledger-code").read_text().strip()
def http(path, body=None, auth=True):
    h = {"Content-Type": "application/json"}
    if auth: h["x-ledger-code"] = code()
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, headers=h)
    return json.load(urllib.request.urlopen(req, timeout=60))
def ocr(jpeg):
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f: f.write(jpeg); p = f.name
    try:
        r = subprocess.run([str(VISION)], input=p + "\n", capture_output=True, text=True, timeout=120)
    finally:
        os.remove(p)
    for ln in r.stdout.splitlines():
        if ln.strip().startswith("{"): return json.loads(ln)["lines"]
    return []
def _names():
    """Ledger item names, so a product name on an Amazon / other receipt can be matched to a ledger item."""
    try: return sorted({r.get("item") for r in http("/api/ledger", auth=False).get("rows", []) if r.get("kind") == "item" and r.get("item")})
    except Exception: return []

def rotate(jpeg, deg):
    """Turn the photo itself with sips (macOS); None when it can't."""
    src = dst = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as f: f.write(jpeg); src = f.name
        dst = src + ".rot.jpg"
        r = subprocess.run(["/usr/bin/sips", "-r", str(deg), src, "--out", dst], capture_output=True, timeout=60)
        return Path(dst).read_bytes() if r.returncode == 0 else None
    except Exception: return None
    finally:
        for x in (src, dst):
            if x and os.path.exists(x): os.remove(x)

def _quality(res):
    c = res["check"]
    return (bool(res["vendor"]), bool(c and c["ok"]), bool(res["date"]), len(res["items"]) + len(res["unknown"]))

def read(jpeg, names):
    """OCR + parse; if that doesn't read as a receipt with a total that checks, try the photo turned 90/180/270 and keep the best."""
    best = None
    for deg in (0, 90, 180, 270):
        img = jpeg if deg == 0 else rotate(jpeg, deg)
        if img is None: continue
        lines = ocr(img)
        if not lines: continue
        res = parse(lines, names)
        if best is None or _quality(res) > _quality(best): best = res
        q = _quality(best)
        if q[0] and q[1] and q[2]: break   # vendor found, total checks, date read: good enough
    return best

def process(jpeg, existing):
    """-> (status, result text, ledger lines to post)"""
    res = read(jpeg, _names())
    if res is None: return "failed", "No text found. Retake the photo flat, in good light, whole receipt.", []
    if not res["vendor"]: return "held", "Couldn't read this as a receipt (no store, date or matching total). Costco, Target and Amazon are read; others only when every item matches a ledger item. Enter this one by hand.", []
    if res["receipt"] in existing: return "done", f"Already in the ledger: {res['receipt']}. Nothing added.", []
    why = []
    unk = unknown_summary(res)
    if unk: why.append("unknown items, add to costco_items.json: " + "; ".join(unk))
    why += [f"not handled: {u}" for u in res["unhandled"]]
    c = res["check"]
    if not c: why.append("couldn't find the total")
    elif not c["ok"]: why.append(f"total doesn't add up (items+tax {c['items_plus_tax']} vs receipt {c['receipt_total']})")
    if not res["date"]: why.append("couldn't find the date (photo cut off?)")
    if not res["items"] and not why: why.append("no items found")
    if why: return "held", f"{res['receipt']}: held, " + "; ".join(why), []
    out = ledger_lines(res)
    note = f" ({c['note']})" if c and c.get("note") else ""
    return "done", f"{res['receipt']}: {len(res['items'])} items added{note}, approve them in Baking > Costs > Ingredient prices.", out
def main():
    if not VISION.exists(): sys.exit(f"vision_ocr not found: {VISION}")
    pend = http("/api/receipt-inbox?pending=1").get("rows", [])
    if not pend: print("nothing waiting"); return
    existing = {r.get("receipt") for r in http("/api/ledger", auth=False).get("rows", [])}
    for p in pend:
        try:
            status, text, lines = process(base64.b64decode(p["data"]), existing)
        except Exception as e:
            status, text, lines = "failed", f"Mac error: {type(e).__name__}", []
        print(p["id"], status, text)
        if DRY: continue
        if lines:
            for i in range(0, len(lines), 80): http("/api/ledger", {"action": "add", "lines": lines[i:i+80]})
            existing.add(lines[0]["receipt"])
        http("/api/receipt-inbox", {"action": "result", "id": p["id"], "status": status, "result": text[:300]})  # the app clips to 300; the full text is in poll.log
if __name__ == "__main__": main()
