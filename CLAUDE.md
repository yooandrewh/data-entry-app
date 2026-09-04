# Kairos — bakery data entry & forecasting

iPhone-optimized web app for Kairos baking: log deliveries, inventory, goodwill and transfers
by location, then forecast and plan bakes. Actively tracked products (`PRODUCTS`): **Lemon Poppy,
Sea Salt, Earl Grey, Dubai Ball**. Ube and Dot were discontinued 2026-09 — dropped from Entry /
Forecast / Plan, but their history stays in the Data tab (`SALES_FLAVORS` and the sheet columns are
kept). **Dubai Ball is not a madeleine** — a separate SKU; excluded from the madeleine flavor mix,
and its sales can't come from the madeleine-filtered OCR, so its Forecast rate stays 0 until a
sales source exists. Adding a product = `PRODUCTS` + `PRODUCT_ICON` + an Entry stepper + a sheet
column + the `sync`/`entries`/`sales` maps.

- **Local:** `/Users/andrew/data-entry-app/` · **Repo:** `yooandrewh/data-entry-app` (public)
- **Live:** https://data-entry-app-roan.vercel.app — the GitHub Pages URL is obsolete, only Vercel works.
- Single static `index.html` + Vercel serverless functions in `api/`. No build step.

## Backend — Google Sheets

Migrated off Notion on 2026-06-29. **Nothing writes to Notion anymore.** The old Notion DBs
remain as an untouched backup, and the `NOTION_TOKEN` / `NOTION_*_DB` Vercel env vars are dead
and safe to remove.

- Sheet id `1kmJHEIKkJ3HTvqmIlx2BwSEYZPNbHt28le3LrPQOuIA`, tabs **Deliveries / Inventory / Sales
  / Store Sales / StoreStats**
- Service account `kairos-sheets@premium-griffin-500920-s0.iam.gserviceaccount.com` (Editor)
- `api/_sheets.js` is a zero-dep client — signs a service-account JWT with `node:crypto` and
  calls the Sheets v4 REST API. Vercel env: `SHEET_ID`, `GOOGLE_SA_JSON` (base64 of the key).
- The sheet **must be a native Google Sheet, not an uploaded `.xlsx`** — the API can't read
  Office files.
- App "Sea Salt" maps to the sheet column **"Sea Salt Butter"**.

## Entry types

| Type | Storage |
|---|---|
| Delivery | Deliveries tab, positive |
| Inventory | Inventory tab |
| Goodwill (free samples) | Deliveries tab as a **negative** adjustment, title `Goodwill — …` |
| Transfer (stock between stores) | **Two linked rows** — negative at source (`Transfer → X`), positive at dest (`Transfer ← Y`) |

Steppers and the backend accept negatives generally.

- **Deleting one leg of a transfer leaves the other**, silently imbalancing both stores. Delete both.
- **Soft delete only** — 🗑️ (password `kairos`, a client-side deterrent, not security) sets
  "Tagged for deletion" = TRUE via `api/tag-delete.js`. Nothing is ever hard-deleted.
- **Edit** (✏️) works on delivery/inventory rows only. Goodwill and transfers are signed/paired,
  so the button is hidden *and* `api/update-entry.js` refuses them — keep both guards.

## Tabs

Home · Data · **Entry** (center, boxed blue via `.tab-entry` — it's the primary action) ·
Forecast · **Baking**. Five tabs; nav shows emoji icon + label.

**Baking** merges the old Plan + Recipes into one tab with a `#bakingMode` segment toggle
(`📅 Plan` / `📖 Recipes`) — `renderBaking()` shows `#bakingPlan` or `#bakingRecipes` and calls
`renderPlan()` / `renderRecipes()`. There is no separate Recipes tab/view anymore.

**Stanton is paused (~mid-July 2026), so it's gone from all forward-looking views** — Home,
Forecast, and Baking have no location toggle and default to La Mirada (`homeLoc`/`projLoc`/`planLoc`
= `'La Mirada'`). Stanton's **historical** data still shows in the **Data** tab (its `dataLoc`
filter keeps All/LM/Stanton). Don't delete stored Stanton data — it's history.

Analytics live at the bottom of Home (`storeAnalyticsHtml()`), collapsed by default (La Mirada
only now). Madeleines are only ~4% of orders and under 1.5% of revenue — the stores are mostly
drinks.

## Forecasting model

`locStats` computes weekday-vs-weekend rates (`dowRate`), `dailyCV`, and `growth`
(`weeklyGrowth()`: geometric-mean WoW growth over the last 4 complete weeks, **damped 50% and
clamped ±25%/wk**). `depleteDow()` walks day by day applying the right rate × growth^(day/7).
`runoutBand()` bands the result with a CV margin, horizon-scaled by ÷√days and **capped ±60%** —
uncapped, a single outlier widens the band until real dips stop being detected.

Scenario toggle is 🐻 Bear / Expected / 🐂 Bull.

Bake effort constants: `BATCH_YIELD=20, SETUP_MIN=20, PREP_MIN=15, BAKE_MIN=14`. Time is
`20 + batches×(15+14)` min — sequential single oven, glaze overlaps the bake.

Plan bake dates are **specific calendar dates**, not a recurring weekly pattern (they vary week
to week). Stored in `localStorage.planBakeDates`. Each chosen date covers demand until the *next*
one; the last date crams everything through the target date.

## Gotchas

- **The version badge is hardcoded.** `.ver-badge` shows `v<git commit count> · <deploy time PST>`
  and **must be bumped by hand in every deploy commit** (`git rev-list --count HEAD`, including
  the commit you're making).
- Vercel is linked to the `andrewlew1s` GitHub identity; push-to-deploy on the `yooandrewh` repo
  is unreliable and often needs a manual Redeploy.
- Recipes were ported from `~/Downloads/kairos.html`, which remains the source of truth. Its
  **Costing section was deliberately not ported** — that's earmarked for a future cost-per-flavor
  feature. The source page had an access-code gate; this app has none, so recipes are visible to
  anyone with the URL.

## Related

Sales data is written automatically by the OCR pipeline in `~/Downloads/kairos_videos_raw/` —
see that directory's CLAUDE.md. `parse_kairos.py` auto-pushes Sales and StoreStats on every
non-debug parse.
