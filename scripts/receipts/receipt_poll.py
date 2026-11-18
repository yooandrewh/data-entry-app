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
from receipt_parse import parse, ledger_lines
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
def process(jpeg, existing):
    """-> (status, result text, ledger lines to post)"""
    lines = ocr(jpeg)
    if not lines: return "failed", "No text found. Retake the photo flat, in good light, whole receipt.", []
    res = parse(lines)
    if not res["vendor"]: return "held", "Only Costco receipts are read so far. Enter this one by hand.", []
    if res["receipt"] in existing: return "done", f"Already in the ledger: {res['receipt']}. Nothing added.", []
    why = []
    for u in res["unknown"]: why.append(f"unknown item #{u['num']} {u['label']} (tell Claude to add it)")
    why += [f"not handled: {u}" for u in res["unhandled"]]
    c = res["check"]
    if not c: why.append("couldn't find the total")
    elif not c["ok"]: why.append(f"total doesn't add up (items+tax {c['items_plus_tax']} vs receipt {c['receipt_total']})")
    if not res["date"]: why.append("couldn't find the date")
    if not res["items"] and not why: why.append("no items found")
    if why: return "held", f"{res['receipt']}: held, " + "; ".join(why), []
    out = ledger_lines(res)
    return "done", f"{res['receipt']}: {len(res['items'])} items added, approve them in Baking > Costs > Ingredient prices.", out
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
        http("/api/receipt-inbox", {"action": "result", "id": p["id"], "status": status, "result": text[:300]})
main()
