# Receipt upload (iPhone -> Mac -> Ledger)

**Main route:** app Home -> Receipts -> Send a photo. `receipt_poll.py` (LaunchAgent every 5 min) does Apple Vision + parse + unapproved ledger lines and reports back in the app. Install: copy `com.kairos.receipt-poll.plist` to `~/Library/LaunchAgents/` and `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.kairos.receipt-poll.plist`. Needs `~/.kairos-receipts/bin/vision_ocr` (copy of `~/Downloads/kairos_videos_raw/vision_ocr`; rebuild with `swiftc -O vision_ocr.swift -o vision_ocr`). The rest of this file describes the older iCloud-folder route, which is run by hand.

**Tests:** `python3 scripts/receipts/tests/run.py` (stdlib, no network or OCR) parses saved OCR lines in `tests/fixtures/` (real Costco Yorba Linda photo shot sideways and tilted, real Target and Amazon samples with personal numbers blanked, one synthetic Costco Westminster receipt) and checks vendor, date, item count, coupons and the total check. Add a fixture and a check whenever a new kind of photo fails.

**What the parser tolerates (Costco):** sideways, upside-down or tilted photos (`orient()` tries 4 turns x tilts up to 20 degrees; the poller also retries with the image rotated by `sips` if the first read has no vendor, no passing total or no date); logo misread (`CosT` over `WHOLESALE`, or WHOLESALE with a `#445` warehouse or member line); `E`/`F` flags before item numbers; `N @ price` quantity lines (also `N € price`, or wrapped onto the item row); a row with no item number (`2 WHOLE MILK 8.18`, held as unknown); coupons (`<id> / <item> 3.00-`) kept as negative fee lines (note `coupon <id> on item <n>`); an unreadable TOTAL accepted as subtotal + tax only when the items and coupons add up to the printed subtotal (the ledger note says so). A photo with no date is held ("photo cut off?"), never guessed.

**Unknown items:** a held receipt lists each unknown item as `#<number> <printed name> <price> xN` in the app's result (clipped to 300 characters; the full text is in `~/.kairos-receipts/poll.log`). Add one entry per number to `costco_items.json` (`item` = ledger item name, `size` in g or ml for one package, `what` with "confirm" when the size is inferred); the next upload of that receipt then parses. A receipt that is held is not re-read automatically; upload the photo again (or retake it with the date in frame).

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
