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

## Status

Frontend complete. Submissions are currently saved to the device (`localStorage`).
Backend integration to sync entries into Notion is the next step — see the
`// TODO: POST record to backend -> Notion` marker in `index.html`.
