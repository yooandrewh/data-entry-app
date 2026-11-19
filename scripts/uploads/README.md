# Upload poller (phone -> Vercel Blob -> Mac)

The app uploads sales videos (`inbox/video/<Store yyyy-MM-dd HHmm>.mov`) and receipt photos (`inbox/receipt/<name>`) to Vercel Blob. `upload_poll.py` runs every 5 minutes on the Mac, saves each file locally, and only then deletes it from Blob. Stdlib only. After new sales videos arrive it starts the sales OCR in the background (`--ocr` mode, own process group, own lock) using `~/kairos-ocr/kairos_inbox_watch.py` with `KAIROS_NO_PUSH=1` and `KAIROS_NO_DRYRUN=1`. Nothing is written to the Sheet: review `~/kairos-ocr/inbox_summary.md`, run the three push scripts without `--write`, then with `--write`.

## Folders (all under your home, so macOS lets a background job use them)
- `~/.kairos-uploads/archive/video` and `archive/receipt`: permanent copies. Never overwritten (`name-2.ext`, `-3` ...).
- `~/.kairos-uploads/videos/`: queue the sales OCR reads (a hardlink of the archive file); the OCR moves processed ones to `videos/done/`.
- `~/.kairos-uploads/tmp/`: downloads in progress (cleaned after a day).
- `~/.kairos-uploads/poll.log`: one line per action. `launchd.log`: LaunchAgent output. `air_synced.json`: files already copied to the Air. `poll.lock`: stops two runs overlapping.
- Receipts reuse `scripts/receipts/receipt_poll.py` (`process()`): Apple Vision (`~/.kairos-receipts/bin/vision_ocr`), parse, unapproved ledger lines. Held or failed receipts keep their archive copy and the reason is in `poll.log`. Approve lines in the app as usual.
- The Air copy goes to `andrews-macbook-air:~/kairos-uploads/<kind>/` with rsync over ssh. If the Air is off, the log says `air: skipped` and the next run catches up.

## Install
```bash
cp scripts/uploads/com.kairos.upload-poll.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kairos.upload-poll.plist
```
Stop it: `launchctl bootout gui/$(id -u)/com.kairos.upload-poll`. Needs `~/.kairos-ledger-code` and, for receipts, `~/.kairos-receipts/bin/vision_ocr`.

## Run by hand
```bash
python3 scripts/uploads/upload_poll.py            # one real pass
python3 scripts/uploads/upload_poll.py --dry-run  # list what it would do, download and delete nothing
```
Prints `nothing waiting` when the inbox is empty. Exit codes: 0 ok / nothing waiting / endpoint not deployed (404) / another run in progress; 1 API unreachable, no ledger code, or a file failed (its blob stays and the next run retries). At most 10 files per run.

## Test
```bash
python3 -I -m unittest discover -s scripts/uploads
```
Covers the name sanitiser, collision renamer, size check, archive-reuse check and Air sync state. Not tested against live data: HEIC photos through `vision_ocr`, and a real Blob download.

## Phone notification
After a run that collected files, and again when the sales OCR finishes, the collector POSTs to `/api/notify` (needs the ledger code; the ntfy topic stays in the Vercel env `NTFY_TOPIC`, same push as entries). Best effort: a failed push is logged and never stops collection.
