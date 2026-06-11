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

Entries are saved on the device first, then synced to the Notion **Sales** database
via a small serverless function (`api/sync.js`) so the Notion token never touches the
client. Each entry shows **✓ Synced to Notion** or **⟳ Not synced — tap to retry**;
unsynced entries retry automatically when the Database tab opens.

Field mapping (app → Notion):

| App | Notion column |
|-----|---------------|
| Type (Delivery/Inventory) | `Type` |
| Location | `Select` |
| Date | `Date` (date only) |
| Lemon Poppy | `Lemon Poppy` |
| Sea Salt | `Sea Salt Butter` |
| Ube | `Ube` |

(Matcha and Chocolate are written as 0 — not collected by the app.)

### Deploy the sync backend (Vercel)

1. Create a Notion **internal integration** at <https://www.notion.so/my-integrations>,
   copy its secret token.
2. Open the **Sales** database in Notion → ••• menu → **Connections** → add your integration
   (this grants it write access).
3. Import this repo into <https://vercel.com> (New Project → import `data-entry-app`).
4. In the Vercel project, add an environment variable: `NOTION_TOKEN` = your integration token.
   (Optional: `APP_KEY` to require a shared key header; `NOTION_DATABASE_ID` to override the target DB.)
5. Deploy. Your app is now at `https://<project>.vercel.app` with sync working out of the box
   (`SYNC_ENDPOINT` is `/api/sync`, same origin).

If you instead keep the app on GitHub Pages, set `SYNC_ENDPOINT` in `index.html` to the
absolute URL `https://<project>.vercel.app/api/sync`.

## Status

Frontend complete and verified. Notion sync implemented (`api/sync.js`); deploy the
backend with the steps above to turn it on.
