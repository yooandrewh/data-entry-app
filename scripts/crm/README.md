# CRM data layer

Turns the per-receipt OCR output (`~/kairos-ocr/kairos_transactions.csv`, `kairos_items.csv`) into a local SQLite database
and, optionally, two Sheet tabs (`Orders`, `OrderItems`) behind `api/orders.js`. It holds names and phone numbers: no real data goes in this repo.

- Build: `python3 scripts/crm/build_crm.py` rebuilds `~/.kairos-crm/crm.db` from scratch and prints counts only.
- Tables `orders`, `items`; views `customers` (key = phone digits, else lowercase name) and `daily`. Order Id = `LM-<id>` / `STN-<id>`.
- Item rows are kept as the OCR wrote them (nothing summed across frames).
- Push: `--push --dry` shows row counts and sizes; `--push` replaces both tabs through `/api/orders` (code from `~/.kairos-ledger-code`).
  It needs `api/orders.js` deployed. Both GET and POST on that endpoint need the `x-ledger-code` header.
- Env overrides: `KAIROS_OCR_DIR`, `KAIROS_CRM_DIR`, `KAIROS_API`.
- Tests: `python3 scripts/crm/test_crm.py` (synthetic data; also runs `test_orders.mjs` and `node --check`).

Example queries (`sqlite3 ~/.kairos-crm/crm.db`):
- Busiest weekday: `select strftime('%w',date) d, count(*) from orders where date<>'' group by d order by 2 desc;`
- Top items: `select item, sum(qty) from items group by item order by 2 desc limit 5;`
- Receipts with a madeleine: `select round(100.0*sum(madeleines>0)/count(*),1) from orders;`
