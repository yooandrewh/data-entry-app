# Receipt upload (iPhone -> Mac -> Ledger)

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
