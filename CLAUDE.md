# Kairos — bakery data entry & forecasting

iPhone-optimized web app for Kairos baking: log deliveries, inventory, goodwill and transfers
by location, then forecast and plan bakes. Actively tracked products (`PRODUCTS`): **Lemon Poppy,
Sea Salt, Earl Grey, Pumpkin Muffin**. Ube, Dot and Dubai Ball were discontinued 2026-09 — dropped
from Entry / Forecast / Plan, but their history stays in the Data tab (`SALES_FLAVORS` and the
sheet columns are kept).

**Dubai Ball and Pumpkin Muffin are not madeleines** — separate SKUs, excluded from the madeleine
flavor mix. Neither is in `SALES_FLAVORS`, because the OCR pipeline only reads madeleines: they
have no sales source, so their Forecast rate stays 0.0/day and run-out reads ∞ until one exists.
Deliveries, inventory and stock-on-hand work normally.

Adding a product touches all of: `PRODUCTS`, `HIST_PRODUCTS`, `PRODUCT_TOKEN`, `PRODUCT_COLOR`,
an Entry stepper row in the markup, a column in the sheet's Deliveries **and** Inventory tabs, and
the maps in `api/sync.js`, `api/entries.js`, `api/sales.js` and `api/update-entry.js`. Miss the
sheet column and `appendRow` drops the value silently, because it maps by header name.

- **Local:** `/Users/andrew/data-entry-app/` · **Repo:** `yooandrewh/data-entry-app` (public)
- **Live:** https://data-entry-app-roan.vercel.app — the GitHub Pages URL is obsolete, only Vercel works.
- Single static `index.html` + Vercel serverless functions in `api/`. No build step.

## Backend — Google Sheets

Migrated off Notion on 2026-06-29. **Nothing writes to Notion anymore.** The old Notion DBs
remain as an untouched backup, and the `NOTION_TOKEN` / `NOTION_*_DB` Vercel env vars are dead
and safe to remove.

- Sheet id `1kmJHEIKkJ3HTvqmIlx2BwSEYZPNbHt28le3LrPQOuIA`, tabs **Deliveries / Inventory / Sales
  / Store Sales / StoreStats / Events**
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

## Usage analytics

`track(name, props)` in `index.html` queues events and posts a batch to `api/track.js`, which
appends them to the **Events** tab (`Timestamp / Date / Session / Device / Event / Props`).
`ensureTab()` in `_sheets.js` creates that tab on the first call, so nothing is set up by hand.

Stored per event: a random device id from `localStorage.kairosDeviceId`, a coarse device label
(iPhone / iPad / Android / Desktop), the event name, and a small JSON props blob. No IP, no user
agent string, no entry text. **The app URL is public and unauthenticated**, so anyone who opens
the link is recorded the same anonymous way — read the Events tab as "sessions", not "me".

Events: `open`, `tab`, `data_filter`, `data_range`, `data_location`, `data_grouping`,
`entry_submit`, `forecast_scenario`, `baking_mode`, `invoice_create`. Flushed on a 5s timer, at 20 queued events,
and via `sendBeacon` on `pagehide` / backgrounding.

## Visual language

- **Flavors are two-letter tokens, not emoji** — `PRODUCT_TOKEN` + `PRODUCT_COLOR` render through
  `tok(p)` as a fixed-width colored square (LP, SS, EG…). Emoji were ambiguous at small sizes and
  had different widths, so rows never lined up. Recipe icons (`REC_ICON`) are still emoji.
- **Per-flavor numbers stack**, they never sit side by side as pills. One shared row pattern,
  `.proj-row` (label left, value right, hairline between), used on Data, Forecast and Baking;
  `kvRow()` builds one. `.pr-fc` adds a muted second line under the value when one line is too long.
- **Nav and Entry-type icons are inline SVG**, stroked with `currentColor`. No icon font, no build
  step.
- **One type scale, as CSS variables on `:root`** — `--fs-micro` 11 / `--fs-nav` 12 /
  `--fs-caption` 13 / `--fs-body` 15 / `--fs-lg` 17 / `--fs-title` 20 / `--fs-figure` 26 /
  `--fs-display` 32. Every `font-size` in the sheet uses one of these. Deliberate exceptions:
  `h1` (30px), `.tok` (sized to its box) and `.db-empty .big` (an emoji graphic). **Don't add a
  raw px font-size** — pick the nearest step, or the scale stops being one. It had drifted to 23
  distinct sizes before 2026-09-22.
- **Emoji are gone from labels and controls.** They survive only where they carry meaning: the
  Bear/Bull scenario toggle, recipe icons (`REC_ICON`), empty-state glyphs, and status marks
  (✓ synced, ⚠️ warning, 🔥/🥶 forecast misses, 🗑️/✏️ row actions).

## Tabs

Home · Data · **Entry** (center, boxed in the accent colour via `.tab-entry` — it's the primary action) ·
**Baking**. Four tabs; nav shows an inline-SVG icon + label.

**Forecast was merged into Home (2026-09).** There is no `view-proj` and no `proj` tab.
`renderHome()` writes the "last updated" strip to `#homeUpdated`, then calls `renderProj()`,
which still fills `#projScenario` / `#projSub` / `#projList` — those elements now live inside
`view-home`. Home no longer draws its own stock card; that was a thinner copy of the same one.
Cost of the merge: one extra `fetchRemoteEntries()` per Home load (`getSales()` is cached).

**Baking** has a `#bakingMode` segment toggle (Plan / Recipes / **Costs**) — the older note follows:
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

Bake effort constants: `BATCH_YIELD=18, SETUP_MIN=20, PREP_MIN=15, BAKE_MIN=14`. Time is
`20 + batches×(15+14)` min — sequential single oven, glaze overlaps the bake.

Plan bake dates are **specific calendar dates**, not a recurring weekly pattern (they vary week
to week). Stored in `localStorage.planBakeDates`. Each chosen date covers demand until the *next*
one; the last date crams everything through the target date.

## Gotchas

- **The version badge is hardcoded** (a solid strip on top of the tab bar, `--footer-h`, so scrolled content passes behind it). `.ver-badge` shows `v<git commit count> · <deploy time PST>`
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

## Color palette (decided 2026-09-29 — use this from now on)

Pantone **1485 C Apricot** `#f0a875` (`--orange`, warm highlight) · **7449 C Deep Plum** `#341f37`
(`--text`) · **7655 C Dusty Mauve** `#a067a2` (`--accent`, primary actions/links/active tab).
Neutrals (`--bg`, `--sep`, `--muted`) are plum-tinted. Hexes were eyeballed from a screenshot of
the swatches, not the official Pantone conversions. Green/red stay as status colors. `--blue` was
renamed `--accent`; don't reintroduce iOS blue.

**Recipes keep discontinued flavors** (Ube, Dot Cake, etc.) — user's call, 2026-09-29. Only
Entry / Forecast / Plan drop discontinued products; never filter the Recipes list by `PRODUCTS`.

## Invoices

Data → Deliveries → **Create invoice** (`openInvoice()` / `buildInvoice()`): pick a store and a date
range, and it sums `delivery` entries for that store (goodwill, transfers and tagged-for-deletion
rows are excluded), prices them, and shows a printable invoice (Print / Save PDF via `@media print`,
or Copy as text). Unit prices are editable per product and remembered in `localStorage.invoicePrices.v1`;
they **default to `PRICE_PER_UNIT` ($2.50), which is the retail figure, not a wholesale price**.
Nothing is written to the sheet — invoices are generated on the fly.

## Ingredient labels

Baking → Recipes → any madeleine → **Make ingredient label** (`openLabel()` / `paintLabel()`). Live
preview + `window.print()`. Inputs: manufactured date (defaults to today, editable each print) and
net weight; best-by is auto — **fridge +7 days, freezer +14 days** — and both are printed. Ingredients
are listed **most → least by weight** (`lblList`, ties keep mixing order), with Glaze / Filling /
Topping as separate lines; allergens (`lblAllergens`) are keyword-detected from the final list.
Net weight = (batter + glaze + topping grams) ÷ `BATCH_YIELD` (**18 per batch**, changed from 20
2026-09-29 — this also drives Plan batch counts). It's a raw-batter estimate, not a scale weight —
edit it if you weigh finished pieces. Prepared in: LGI Kitchen, Fullerton CA. The label text is
`contenteditable` so a line can be fixed before printing. Recipe rows with no gram amount
(peach jam, sprinkles) are supplied by `lblExtra` on the recipe.

## Costs (Baking → Costs)

Ported from the old `kairos.html` Costing section (which CLAUDE.md used to say was left out).
`renderCosts()` has two views: **Cost per item** (pick any recipe; batch cost from `costRows()`,
÷ pieces-per-batch, plus per-item filling/topping from `COST_META`) and **Ingredient prices**
(package size + price → $/g). Prices/yields save to `localStorage` (`costPrices.v1`, `costYields.v1`)
— this device only, but `DEFAULT_PRICES` ships in the public source, so the seed prices are visible
to anyone with the repo. Every ingredient any recipe uses appears in the price list; ones with no
price are flagged "Needs a price" and block that recipe's total. Cake Flour = AP + cornstarch
(436:64), Egg White/Yolk = Eggs, Tea Bags = 2g tea leaves. Unlike the old page, flavoring notes,
glaze and toppings count toward the batch. Madeleine yield defaults to `BATCH_YIELD` (18).
