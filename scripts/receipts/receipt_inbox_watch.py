#!/usr/bin/env python3
"""Process new receipt photos from the iCloud 'Kairos receipts' folder. Never writes to the Sheet.
Usage: python3 receipt_inbox_watch.py [inbox_dir]   (default: iCloud Drive/Kairos receipts)
Same process as kairos_inbox_watch.py (sales videos): iCloud inbox -> download placeholders ->
Apple Vision OCR (the same compiled ~/Downloads/kairos_videos_raw/vision_ocr binary, all local) ->
parse -> proposed ledger lines + receipt_summary.md. Originals move to <inbox>/done/.
Review the summary, add any UNKNOWN item numbers to costco_items.json, then run
push_receipts_to_ledger.py (dry run) and again with --write."""
import sys, os, json, subprocess, shutil, datetime
from pathlib import Path
HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
from receipt_parse import parse, ledger_lines
INBOX = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home()/"Library/Mobile Documents/com~apple~CloudDocs/Kairos receipts"
WORK = Path(os.environ.get("KAIROS_RECEIPTS_WORK", Path.home()/"Downloads/kairos_videos_raw/receipts"))
VISION = Path.home()/"Downloads/kairos_videos_raw/vision_ocr"
IMG = {".jpg", ".jpeg", ".png", ".heic", ".heif"}
def run(*a, **k): return subprocess.run(a, capture_output=True, text=True, **k)

def ocr(path):
    r = subprocess.run([str(VISION)], input=str(path) + "\n", capture_output=True, text=True)
    for ln in r.stdout.splitlines():
        if ln.strip().startswith("{"): return json.loads(ln)["lines"]
    return []

def main():
    INBOX.mkdir(parents=True, exist_ok=True)
    WORK.mkdir(parents=True, exist_ok=True)
    if not VISION.exists(): sys.exit(f"vision_ocr not found: {VISION} (build: swiftc -O vision_ocr.swift -o vision_ocr)")
    for ph in INBOX.glob(".*.icloud"): run("brctl", "download", str(ph))   # iCloud placeholders
    imgs = sorted(p for p in INBOX.iterdir() if p.suffix.lower() in IMG)
    if not imgs: print("nothing new"); return
    (INBOX/"done").mkdir(exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    out = [f"# Receipt inbox run {datetime.datetime.now():%Y-%m-%d %H:%M}\n"]
    proposals = []
    for n, p in enumerate(imgs, 1):
        src = p
        if p.suffix.lower() in (".heic", ".heif"):
            src = WORK/f"{stamp}_{n}.png"
            if run("sips", "-s", "format", "png", str(p), "--out", str(src)).returncode: out.append(f"- FAILED `{p.name}`: could not convert HEIC\n"); continue
        lines = ocr(src)
        (WORK/f"{stamp}_{n}_ocr.json").write_text(json.dumps(lines))
        if not lines: out.append(f"- FAILED `{p.name}`: no text found (blurry or cropped?); left in the inbox\n"); continue
        res = parse(lines)
        if not res["vendor"]:
            out.append(f"- `{p.name}`: vendor not recognized (only Costco is parsed so far). OCR text saved to `{stamp}_{n}_ocr.json`; enter this one by hand.\n")
        else:
            c = res["check"]
            flag = "total matches" if c and c["ok"] else ("TOTAL DOES NOT MATCH" if c else "no total found")
            out.append(f"## `{p.name}` -> {res['receipt']}\n- {len(res['items'])} known items, {len(res['unknown'])} UNKNOWN, tax {res['tax']}, {flag}"
                       + (f" (items+tax {c['items_plus_tax']} vs receipt {c['receipt_total']})" if c else "") + "\n")
            for i in res["items"]: out.append(f"  - {i['item']}  {i['size']:g} {i['unit']}  ${i['price']:.2f}  (#{i['num']} {i['label']})\n")
            for u in res["unknown"]: out.append(f"  - UNKNOWN #{u['num']} {u['label']} ${u['price']:.2f} -> add to costco_items.json\n")
            for u in res["unhandled"]: out.append(f"  - NOT HANDLED (coupon/discount?): {u}\n")
            proposals.append({"file": p.name, "receipt": res["receipt"], "date": res["date"], "vendor": res["vendor"],
                              "complete": not res["unknown"] and not res["unhandled"] and bool(res["check"] and res["check"]["ok"]),
                              "unknown": res["unknown"], "lines": ledger_lines(res)})
        shutil.move(str(p), INBOX/"done"/p.name)
    (WORK/"proposed.json").write_text(json.dumps(proposals, indent=1))
    (WORK/"receipt_summary.md").write_text("".join(out))
    print("".join(out)[:3000]); print(f"\nproposed lines: {WORK/'proposed.json'}")
main()
