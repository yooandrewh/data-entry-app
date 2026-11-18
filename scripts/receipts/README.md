# Receipt upload (iPhone -> Mac -> Ledger)

**Main route:** app Home -> Receipts -> Send a photo. `receipt_poll.py` (LaunchAgent every 5 min) does Apple Vision + parse + unapproved ledger lines and reports back in the app. Install: copy `com.kairos.receipt-poll.plist` to `~/Library/LaunchAgents/` and `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kairos.receipt-poll.plist`. Needs `~/.kairos-receipts/bin/vision_ocr` (copy of `~/Downloads/kairos_videos_raw/vision_ocr`; rebuild with `swiftc -O vision_ocr.swift -o vision_ocr`). The rest of this file describes the older iCloud-folder route, which is run by hand.

Same process as the sales videos (`~/Downloads/kairos_videos_raw/kairos_inbox_watch.py`): everything local, free, nothing writes to the Sheet until you say so.

| | Sales videos | Receipts |
|---|---|---|
| iPhone drops into | iCloud Drive / **Kairos inbox** | iCloud Drive / **Kairos receipts** |
| Mac script | `kairos_inbox_watch.py` | `scripts/receipts/receipt_inbox_watch.py` |
| OCR | `vision_ocr` (Apple Vision) | the same binary |
| Review | `inbox_summary.md` | `~/Downloads/kairos_videos_raw/receipts/receipt_summary.md` |
| Push (dry run, then `--write`) | `push_*_to_sheet.py` | `scripts/receipts/push_receipts_to_ledger.py` |

## From the iPhone
Photo of the receipt (flat, good light, whole receipt, one photo per receipt; Costco receipts are long, take two overlapping shots only if it won't fit). Then either:
- **Photos -> Share -> Save to Files -> iCloud Drive -> Kairos receipts**, or
- an iOS Shortcut ("Take Photo" -> "Save File" to Kairos receipts, ask where to save: off) on the Home Screen for one tap.
Wait for the iCloud cloud icon to finish before closing Files.

## On the Mac
```bash
python3 scripts/receipts/receipt_inbox_watch.py        # OCR + parse, writes the summary
python3 scripts/receipts/push_receipts_to_ledger.py    # dry run
python3 scripts/receipts/push_receipts_to_ledger.py --write   # posts UNAPPROVED lines
```
Then approve the lines in the app (Baking -> Costs / ledger). A receipt is held back if any item number is unknown, a coupon line was seen, or the items + tax don't equal the receipt total. Add new item numbers to `costco_items.json` (size of one package); other vendors aren't parsed yet and are listed for hand entry.
