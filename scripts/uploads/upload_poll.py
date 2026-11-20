#!/usr/bin/env python3
"""Mac side of the app's direct uploads (phone -> Vercel Blob -> this Mac). Run by a LaunchAgent every 5 minutes.

For each file waiting in the inbox: download to ~/.kairos-uploads/tmp, check the byte count, move into
~/.kairos-uploads/archive/<kind>/, and only then ask the app to delete the blob.
  video   -> also hardlinked (or copied) into ~/.kairos-uploads/videos/ (the queue the OCR pipeline reads by hand).
             The OCR pipeline is NOT run here.
  receipt -> OCR + parse + UNAPPROVED ledger lines, reusing process() from scripts/receipts/receipt_poll.py.
             Held / failed receipts keep their archive copy; the reason goes to the log.
Then a best-effort rsync of every archived file to the other Mac (andrews-macbook-air), retrying missed ones.

Every path touched is under ~/.kairos-uploads or ~/.kairos-receipts (macOS blocks background reads of
Downloads / iCloud). The ledger code is read from ~/.kairos-ledger-code and never printed or logged.
Stdlib only. Usage: upload_poll.py [--dry-run]
Exit codes: 0 = ok / nothing waiting / endpoint not deployed yet (404) / another run holds the lock;
            1 = could not reach or read the API, missing ledger code, or at least one file failed (retried next run).
"""
import sys, os, re, json, subprocess, urllib.request, urllib.error, fcntl, time, uuid
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
RECEIPTS_DIR = HERE.parent / "receipts"
BASE = os.environ.get("KAIROS_API", "https://data-entry-app-roan.vercel.app")
HOME = Path(os.environ.get("KAIROS_UPLOADS_HOME", Path.home() / ".kairos-uploads"))
AIR_HOST = os.environ.get("KAIROS_AIR_HOST", "andrews-macbook-air")
AIR_DIR = "~/kairos-uploads"
KINDS = ("video", "receipt")
MAX_PER_RUN = 10
MAX_REMOVE = 20  # API limit per remove call
CHUNK = 1 << 20

TMP = HOME / "tmp"
ARCHIVE = HOME / "archive"
VIDEOS = HOME / "videos"
LOG = HOME / "poll.log"
STATE = HOME / "air_synced.json"
LOCK = HOME / "poll.lock"
OCR_LOCK = HOME / "ocr.lock"
OCR_DIR = Path(os.environ.get("KAIROS_OCR_DIR", Path.home() / "kairos-ocr"))
OCR_PY = os.environ.get("KAIROS_OCR_PY", "/opt/homebrew/bin/python3")
OCR_PATH = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"


# ---------- pure helpers (unit-tested) ----------
def sanitise(name, fallback="unnamed"):
    """Keep only a safe base file name: no path parts, no control characters, no leading dots."""
    name = str(name or "").replace("\\", "/").split("/")[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip().lstrip(".").strip()
    if len(name) > 150:
        stem, dot, ext = name.rpartition(".")
        if dot and 0 < len(ext) <= 10:
            name = stem[:150 - len(ext) - 1] + "." + ext
        else:
            name = name[:150]
    return name or fallback


def unique_path(directory, name):
    """directory/name, or directory/stem-2.ext, -3 ... if taken. Never overwrites."""
    directory = Path(directory)
    p = directory / name
    if not p.exists():
        return p
    stem, dot, ext = name.rpartition(".")
    if not dot or not stem:
        stem, ext = name, ""
    else:
        ext = "." + ext
    n = 2
    while (directory / f"{stem}-{n}{ext}").exists():
        n += 1
    return directory / f"{stem}-{n}{ext}"


def size_ok(path, expected):
    """True only when expected is a real int and the file on disk has exactly that many bytes."""
    if isinstance(expected, bool) or not isinstance(expected, int) or expected < 0:
        return False
    try:
        return Path(path).stat().st_size == expected
    except OSError:
        return False


def existing_copy(directory, name, size):
    """An already-archived copy (name, name-2, ...) with the same byte count: makes a retry idempotent."""
    directory = Path(directory)
    stem, dot, ext = name.rpartition(".")
    if not dot or not stem:
        stem, ext = name, ""
    else:
        ext = "." + ext
    cands = [directory / name] + [directory / f"{stem}-{n}{ext}" for n in range(2, 12)]
    for c in cands:
        if c.is_file() and size_ok(c, size):
            return c
    return None


def air_key(kind, name):
    return f"{kind}/{name}"


def archive_keys(archive_dir):
    """All archived files as 'kind/name' keys (ignores hidden and partial files)."""
    out = []
    for kind in KINDS:
        d = Path(archive_dir) / kind
        if d.is_dir():
            for f in sorted(d.iterdir()):
                if f.is_file() and not f.name.startswith(".") and not f.name.endswith(".part"):
                    out.append(air_key(kind, f.name))
    return out


def air_missing(keys, synced):
    """Keys in the archive that the Air has not been sent yet (in archive order)."""
    done = set(synced)
    return [k for k in keys if k not in done]


def load_synced(path):
    try:
        data = json.loads(Path(path).read_text())
        return [k for k in data.get("synced", []) if isinstance(k, str)]
    except Exception:
        return []


def save_synced(path, synced):
    path = Path(path)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps({"synced": sorted(set(synced))}, indent=1))
    os.replace(tmp, path)


# ---------- io ----------
def log(msg, quiet=False):
    line = f"{datetime.now().isoformat(timespec='seconds')} {msg}"
    try:
        with open(LOG, "a") as f:
            f.write(line + "\n")
    except OSError:
        pass
    if not quiet:
        print(msg)


def ledger_code():
    return (Path.home() / ".kairos-ledger-code").read_text().strip()


def api(path, body=None):
    h = {"x-ledger-code": ledger_code(), "User-Agent": "kairos-upload-poll"}
    data = None
    if body is not None:
        h["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers=h)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


COLLECTED = {"video": 0, "receipt": 0}
RECEIPT_RESULTS = {}   # status -> count, for the push ("1 receipt held: enter it by hand")


def notify(event, **fields):
    """Best-effort phone push through api/notify.js (the ntfy topic stays on the server). Never raises."""
    try:
        api("/api/notify", dict(fields, event=event))
    except Exception as e:
        log(f"notify {event}: not sent ({type(e).__name__})", quiet=True)


def download(url, dest, size):
    """Stream url to dest (a tmp path). Returns True when the byte count equals size."""
    if not str(url).startswith("https://"):
        raise ValueError("download url is not https")
    req = urllib.request.Request(url, headers={"User-Agent": "kairos-upload-poll"})
    with urllib.request.urlopen(req, timeout=60) as r, open(dest, "wb") as f:
        while True:
            b = r.read(CHUNK)
            if not b:
                break
            f.write(b)
    return size_ok(dest, size)


def link_or_copy(src, dst):
    try:
        os.link(src, dst)
    except OSError:
        import shutil
        shutil.copy2(src, dst)


def clean_tmp():
    cutoff = time.time() - 86400
    for f in TMP.glob("*.part"):
        try:
            if f.stat().st_mtime < cutoff:
                f.unlink()
        except OSError:
            pass


# ---------- receipts (reuses scripts/receipts/receipt_poll.py) ----------
_ledger_existing = None


def handle_receipt(path, name):
    """OCR + parse + post unapproved ledger lines. Returns (status, text). Raises on transient errors."""
    global _ledger_existing
    sys.path.insert(0, str(RECEIPTS_DIR))
    import receipt_poll as rp
    if not rp.VISION.exists():
        raise RuntimeError(f"vision_ocr not found: {rp.VISION}")
    if _ledger_existing is None:
        _ledger_existing = {r.get("receipt") for r in rp.http("/api/ledger", auth=False).get("rows", [])}
    status, text, lines = rp.process(Path(path).read_bytes(), _ledger_existing)
    if lines:
        for i in range(0, len(lines), 80):
            rp.http("/api/ledger", {"action": "add", "lines": lines[i:i + 80]})
        _ledger_existing.add(lines[0]["receipt"])
    return status, text


# ---------- per file ----------
def process_file(f, dry):
    """Returns True when the file is fully handled (blob removed or dry), False when left for the next run."""
    kind, pathname = f.get("kind"), str(f.get("pathname", ""))
    if kind not in KINDS or not pathname.startswith(f"inbox/{kind}/"):
        log(f"skip {pathname!r}: unknown kind")
        return False
    name = sanitise(f.get("name") or pathname.rsplit("/", 1)[-1])
    size = f.get("size")
    dest_dir = ARCHIVE / kind
    have = existing_copy(dest_dir, name, size)
    if dry:
        print(f"[dry-run] {kind} {name} ({size} bytes): would "
              + ("reuse archived copy" if have else "download")
              + (", link into videos/" if kind == "video" else ", OCR + post unapproved ledger lines")
              + ", rsync to Air, then remove the blob")
        return True
    dest_dir.mkdir(parents=True, exist_ok=True)
    if have:
        final = have
        log(f"{kind} {name}: already archived as {final.name}")
    else:
        tmp = TMP / (uuid.uuid4().hex + ".part")
        try:
            ok = download(f.get("url"), tmp, size)
        except Exception as e:
            tmp.unlink(missing_ok=True)
            log(f"{kind} {name}: download failed ({type(e).__name__}), will retry")
            return False
        if not ok:
            tmp.unlink(missing_ok=True)
            log(f"{kind} {name}: size mismatch (expected {size}), will retry")
            return False
        final = unique_path(dest_dir, name)
        os.replace(tmp, final)
        if not size_ok(final, size):
            log(f"{kind} {name}: archive copy failed size check, will retry")
            return False
        log(f"{kind} {name}: archived as {kind}/{final.name} ({size} bytes)")
    if kind == "video":
        VIDEOS.mkdir(parents=True, exist_ok=True)
        q = VIDEOS / final.name
        if not q.exists():
            try:
                link_or_copy(final, q)
                log(f"video {final.name}: queued in videos/")
            except OSError as e:
                log(f"video {final.name}: could not queue ({type(e).__name__}), will retry")
                return False
    else:
        try:
            status, text = handle_receipt(final, final.name)
        except Exception as e:
            log(f"receipt {final.name}: Mac error {type(e).__name__}, will retry")
            return False
        log(f"receipt {final.name}: {status}: {text}")
        RECEIPT_RESULTS[str(status)] = RECEIPT_RESULTS.get(str(status), 0) + 1
    try:
        r = api("/api/uploads", {"action": "remove", "pathnames": [pathname]})
        log(f"{kind} {final.name}: removed from inbox ({r.get('removed')})")
        COLLECTED[kind] += 1
    except Exception as e:
        log(f"{kind} {final.name}: remove failed ({type(e).__name__}), will retry")
        return False
    return True


# ---------- Air sync ----------
def sync_air(dry):
    """Best effort: send archived files the Air does not have yet. Returns number sent."""
    synced = load_synced(STATE)
    missing = air_missing(archive_keys(ARCHIVE), synced)
    if not missing:
        return 0
    if dry:
        print(f"[dry-run] air: {len(missing)} archived file(s) not yet copied")
        return 0
    ssh = "ssh -o BatchMode=yes -o ConnectTimeout=8"
    try:
        r = subprocess.run(ssh.split() + [AIR_HOST, f"mkdir -p {AIR_DIR}/video {AIR_DIR}/receipt"],
                           capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            raise RuntimeError("ssh failed")
    except Exception:
        log(f"air: skipped ({len(missing)} waiting)")
        return 0
    sent = 0
    for key in missing[:MAX_PER_RUN]:
        kind, name = key.split("/", 1)
        try:
            r = subprocess.run(["rsync", "-a", "--partial", "-e", ssh, str(ARCHIVE / kind / name),
                                f"{AIR_HOST}:{AIR_DIR}/{kind}/"], capture_output=True, text=True, timeout=1800)
            ok = r.returncode == 0
        except Exception:
            ok = False
        if not ok:
            log(f"air: {key} failed, will retry")
            break
        synced.append(key)
        save_synced(STATE, synced)
        sent += 1
        log(f"air: copied {key}")
    return sent


# ---------- sales video OCR (reuses ~/kairos-ocr/kairos_inbox_watch.py; never writes to the Sheet) ----------
def queued_videos():
    return [f for f in VIDEOS.glob("*") if f.is_file() and f.suffix.lower() in (".mov", ".mp4", ".m4v")]


def start_ocr():
    """Start the OCR run in its own process group (it outlives this poll). No-op if nothing is queued or one is running."""
    if not queued_videos() or not (OCR_DIR / "kairos_inbox_watch.py").exists():
        return False
    subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--ocr"], start_new_session=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return True


def ocr_headline():
    """One short line from inbox_summary.md: how many videos it read and whether any need a manual split."""
    try:
        t = (OCR_DIR / "inbox_summary.md").read_text()
    except OSError:
        return ""
    h = re.search(r"^Headline: (.+)$", t, re.M)   # written by kairos_inbox_watch.py: pushed, or why it stopped
    if h:
        return h.group(1).strip()[:180]
    n = len(re.findall(r"^- `", t, re.M))
    bad = len(re.findall(r"needs a manual|MIXED|failed|error", t, re.I))
    return f"{n} video(s) read" + (", some need a look." if bad else ".")


def run_ocr():
    """The --ocr mode: frames -> Apple Vision -> parse with KAIROS_NO_PUSH=1. The watcher moves queued videos to videos/done/
    and writes ~/kairos-ocr/inbox_summary.md for Andrew to review before running the push scripts with --write."""
    lock = open(OCR_LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return 0
    # KAIROS_NO_PUSH only stops parse_kairos.py's own auto-push; the watcher now runs the dry runs itself and pushes
    # only when every check passes (see its docstring). It needs a readable service-account key (not ~/Downloads).
    env = dict(os.environ, PATH=OCR_PATH, KAIROS_NO_PUSH="1")
    log(f"ocr: starting on {len(queued_videos())} queued video(s)", quiet=True)
    try:
        r = subprocess.run([OCR_PY, str(OCR_DIR / "kairos_inbox_watch.py"), str(VIDEOS)], cwd=str(OCR_DIR),
                           env=env, capture_output=True, text=True, timeout=45 * 60)   # a run takes minutes; a hang must not hold the OCR lock for hours (2026-11-20)
        log(f"ocr: finished (exit {r.returncode}); summary at {OCR_DIR / 'inbox_summary.md'}", quiet=True)
        if r.returncode:
            log("ocr: " + (r.stderr or r.stdout or "")[-300:].replace("\n", " "), quiet=True)
            notify("ocr", detail="OCR run failed, nothing pushed. See ~/.kairos-uploads/poll.log.")
        else:
            notify("ocr", detail=ocr_headline())
        return r.returncode
    except Exception as e:
        log(f"ocr: failed ({type(e).__name__})", quiet=True)
        notify("ocr", detail="OCR run hung or crashed and was stopped; the next run retries. See ~/.kairos-uploads/poll.log.")
        return 1


# ---------- main ----------
def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    dry = "--dry-run" in argv
    if "--ocr" in argv:
        HOME.mkdir(parents=True, exist_ok=True)
        return run_ocr()
    for d in (TMP, ARCHIVE / "video", ARCHIVE / "receipt", VIDEOS):
        d.mkdir(parents=True, exist_ok=True)
    lock = open(LOCK, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        print("busy: another run is in progress")
        return 0
    clean_tmp()
    try:
        files = api("/api/uploads").get("files", [])
    except urllib.error.HTTPError as e:
        if e.code == 404:
            print("uploads endpoint not deployed yet (HTTP 404), nothing to do")
            return 0
        print(f"could not list uploads: HTTP {e.code}")
        return 1
    except FileNotFoundError:
        print("ledger code file ~/.kairos-ledger-code not found")
        return 1
    except Exception as e:
        print(f"could not list uploads: {type(e).__name__}")
        return 1
    files = sorted((f for f in files if isinstance(f, dict)), key=lambda f: str(f.get("uploadedAt", "")))
    batch = files[:MAX_PER_RUN]
    failed = 0
    for f in batch:
        try:
            if not process_file(f, dry):
                failed += 1
        except Exception as e:
            failed += 1
            log(f"{f.get('pathname')}: unexpected {type(e).__name__}, will retry")
    if not dry and (COLLECTED["video"] or COLLECTED["receipt"]):
        bad = {k: v for k, v in RECEIPT_RESULTS.items() if k != "done"}
        detail = ""
        if RECEIPT_RESULTS:
            ok = RECEIPT_RESULTS.get("done", 0)
            detail = (f"{ok} receipt{'s' if ok != 1 else ''} read into the ledger." if ok else "") + \
                     "".join(f" {v} {k}: enter by hand or send a clearer photo." for k, v in bad.items())
        notify("upload", videos=COLLECTED["video"], receipts=COLLECTED["receipt"], detail=detail.strip())
    sent = sync_air(dry)
    if not dry and start_ocr():
        print("sales video OCR started in the background")
    if not files and not sent:
        print("nothing waiting")
    else:
        extra = f", {len(files) - len(batch)} more next run" if len(files) > len(batch) else ""
        print(f"{len(batch) - failed} of {len(batch)} file(s) done, {failed} left for next run, air copied {sent}{extra}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
