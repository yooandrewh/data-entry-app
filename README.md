# Data Entry App

An iPhone-optimized data entry app for logging deliveries and inventory across locations. Single self-contained `index.html` — no build step.

## Features

- **Two entry types** — Delivery 🚚 / Inventory 📦
- **Date & time** — defaults to now in PST, adjustable for future entries
- **Location** — La Mirada / Stanton
- **Amounts** — per-product steppers (Lemon Poppy, Sea Salt, Ube)
- **Confirmation sheet** before submitting (entries can't be edited or deleted)
- **Database tab** — review everything submitted, grouped by day
- Light theme, safe-area aware, haptic feedback, native iOS feel

## Run locally

Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 4173
# then visit http://localhost:4173
```

## Google Sheets sync

Entries are saved on the device first, then synced to a **Google Sheet** via small
serverless functions so the service-account key never touches the client.

- `api/sync.js` — appends the row, **routing by type**: Delivery/Goodwill entries go
  to the **Deliveries** tab, Inventory entries go to the **Inventory** tab.
- `api/entries.js` — reads both tabs (the shared list every device sees).
- `api/tag-delete.js` — soft delete. The app's 🗑️ (password `kairos`) doesn't remove
  anything; it sets the row's **Tagged for deletion** cell to TRUE and greys the
  entry in the app so it can be reviewed before any real removal.
- `api/sales.js` — reads the **Sales** tab for the Sales/Projections views.
- `api/_sheets.js` — shared, zero-dependency Sheets client (service-account JWT
  signed with Node's built-in `crypto`).

Each entry shows **✓ Synced to Sheets**, **⟳ Not synced — tap to retry**, or
**🏷️ Tagged for deletion**. Unsynced/untagged actions retry automatically when the
Database tab opens.

Field mapping (app → sheet column):

| App | Sheet column |
|-----|--------------|
| Location | `Select` (Deliveries/Inventory), `Location` (Sales) |
| Date | `Date` (full datetime) |
| Lemon Poppy | `Lemon Poppy` |
| Sea Salt | `Sea Salt Butter` |
| Ube | `Ube` |
| Dot | `Dot` |

The Delivery/Inventory/Goodwill choice selects *which tab* the row lands in.
Goodwill rows are negative stock adjustments written to the Deliveries tab.

### Deploy the sync backend (Vercel)

The backend was migrated from Notion to Google Sheets. See
[`migration/SETUP.md`](migration/SETUP.md) for the full one-time setup: create the
sheet (from `migration/kairos-baking.xlsx`), make a Google service account, share the
sheet with it, and set the Vercel env vars `SHEET_ID` and `GOOGLE_SA_JSON`.

## Status

Frontend complete and verified. Backend migrated to Google Sheets (Deliveries /
Inventory / Sales tabs); sync + soft-delete implemented. Complete `migration/SETUP.md`
to turn it on live.
