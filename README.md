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

## Notion sync

Entries are saved on the device first, then synced to Notion via small serverless
functions so the Notion token never touches the client.

- `api/sync.js` — creates the row, **routing by type**: Delivery entries go to the
  **Deliveries** database, Inventory entries go to the **Inventory** database.
- `api/tag-delete.js` — soft delete. The app's 🗑️ (password `kairos`) doesn't remove
  anything; it ticks the row's **Tagged for deletion** checkbox in Notion and greys
  the entry in the app so it can be reviewed before any real removal.

Each entry shows **✓ Synced to Notion**, **⟳ Not synced — tap to retry**, or
**🏷️ Tagged for deletion**. Unsynced/untagged actions retry automatically when the
Database tab opens.

Field mapping (app → both databases):

| App | Notion column |
|-----|---------------|
| Location | `Location` |
| Date | `Date` (date only) |
| Lemon Poppy | `Lemon Poppy` |
| Sea Salt | `Sea Salt Butter` |
| Ube | `Ube` |

The Delivery/Inventory choice selects *which database* the row lands in (no Type column).

### Deploy the sync backend (Vercel)

1. Create a Notion **internal integration** at <https://www.notion.so/my-integrations>,
   copy its secret token.
2. In Notion, open **both** the **Deliveries** and **Inventory** databases → ••• menu →
   **Connections** → add your integration (grants write access to each).
3. Import this repo into <https://vercel.com> (New Project → import `data-entry-app`).
4. Add a Vercel environment variable: `NOTION_TOKEN` = your integration token.
   The database ids are baked in as defaults; override with `NOTION_DELIVERIES_DB` /
   `NOTION_INVENTORY_DB` if needed. Optional `APP_KEY` requires a shared `x-app-key` header.
5. Deploy. The app is now at `https://<project>.vercel.app` with sync + soft-delete working
   (`SYNC_ENDPOINT` / `TAG_DELETE_ENDPOINT` are same-origin `/api/...`).

If you keep the app on GitHub Pages instead, point `SYNC_ENDPOINT` and `TAG_DELETE_ENDPOINT`
in `index.html` at the absolute `https://<project>.vercel.app/api/...` URLs.

## Status

Frontend complete and verified. Two routed Notion databases created; sync + soft-delete
implemented. Deploy the Vercel backend (steps above) to turn it on live.
