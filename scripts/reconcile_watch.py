#!/usr/bin/python3
"""Run reconcile.py after every new inventory count or delivery entry, then push the result to the phone.

Every 5 minutes (LaunchAgent com.kairos.reconcile-watch): GET /api/entries, find delivery / inventory entries not seen
before (ids in ~/.kairos-reconcile/seen.json; the first run only records what exists, so there is no flood), and if there
are any, run scripts/reconcile.py (read-only) and POST a one-line summary to /api/notify (event "reconcile", needs the
ledger code in ~/.kairos-ledger-code; the ntfy topic stays on the server). The full report is saved to
~/.kairos-reconcile/last.txt.

Counts win (Andrew, 2026-11-09 and 2026-11-18): a physical count outranks sales. When implied sales (count - deliveries)
and the Sales tab differ by more than 5%, the push says the sales are what to redo, never the count. Questions about gaps
still happen in the Claude chat; this only tells Andrew it is time.
"""
import json, re, subprocess, sys, urllib.request, fcntl
from datetime import datetime
from pathlib import Path

BASE = "https://data-entry-app-roan.vercel.app"
HOME = Path.home() / ".kairos-reconcile"
SEEN, LAST, LOCK, LOG = HOME / "seen.json", HOME / "last.txt", HOME / "run.lock", HOME / "run.log"
HERE = Path(__file__).resolve().parent
KINDS = ("delivery", "inventory", "goodwill", "transfer")


def log(m):
    with open(LOG, "a") as f:
        f.write(f"{datetime.now().isoformat(timespec='seconds')} {m}\n")


def get(path):
    req = urllib.request.Request(BASE + path, headers={"User-Agent": "kairos-reconcile-watch"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def summarise(report):
    """One line per location from its latest window: reconcile.py prints that window as a table (header line, then a
    'product ...' row); older windows are one condensed line each, so they are ignored."""
    lines = report.splitlines()
    seen, parts = set(), []
    for i, ln in enumerate(lines):
        m = re.match(r"^(La Mirada|Stanton): .*? -> .*?\s+(\[.*?\]\s+)?=> ", ln)
        if not m or i + 1 >= len(lines) or not lines[i + 1].lstrip().startswith("product") or m.group(1) in seen:
            continue
        loc, bad = m.group(1), []
        seen.add(loc)
        for row in lines[i + 2:]:
            if not row.strip():
                break
            if row.rstrip().endswith("RE-OCR"):
                bad.append(row.strip().split("  ")[0].strip())
        parts.append(f"{loc}: " + (f"sales off for {', '.join(bad)} - counts win, redo the sales OCR" if bad else "matches sales"))
    return "; ".join(parts) or "No new window to check."


def main():
    HOME.mkdir(parents=True, exist_ok=True)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0
    try:
        e = get("/api/entries")
        e = e.get("entries") or e.get("rows") or []
    except Exception as ex:
        log(f"entries: {type(ex).__name__}")
        return 1
    ids = {str(x.get("notionId")) for x in e if x.get("type") in KINDS and not x.get("taggedForDeletion") and x.get("notionId")}
    first = not SEEN.exists()
    try:
        seen = set(json.loads(SEEN.read_text())) if not first else set()
    except Exception:
        seen, first = set(), True
    new = ids - seen
    if first:
        SEEN.write_text(json.dumps(sorted(ids)))
        log(f"first run: recorded {len(ids)} entries, nothing sent")
        return 0
    if not new:
        return 0
    inv_or_del = [x for x in e if str(x.get("notionId")) in new and x.get("type") in ("delivery", "inventory")]
    if not inv_or_del:  # only goodwill / transfers: record, no run
        SEEN.write_text(json.dumps(sorted(ids)))
        return 0
    r = subprocess.run(["/usr/bin/python3", "-I", str(HERE / "reconcile.py")], capture_output=True, text=True, timeout=300)
    report = r.stdout + (("\n" + r.stderr) if r.stderr else "")
    LAST.write_text(report)
    if r.returncode not in (0, 2):
        log(f"reconcile.py exit {r.returncode}; will retry")
        return 1
    line = summarise(report)
    code = (Path.home() / ".kairos-ledger-code").read_text().strip()
    try:
        req = urllib.request.Request(BASE + "/api/notify", data=json.dumps({"event": "reconcile", "detail": line}).encode(),
                                     headers={"x-ledger-code": code, "Content-Type": "application/json", "User-Agent": "kairos-reconcile-watch"})
        urllib.request.urlopen(req, timeout=30).read()
    except Exception as ex:
        log(f"notify: not sent ({type(ex).__name__})")
    SEEN.write_text(json.dumps(sorted(ids)))
    log(f"{len(new)} new entr(ies); {line}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
