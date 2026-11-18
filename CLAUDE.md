# Kairos — bakery data entry & forecasting

iPhone-optimized web app for Kairos baking: log deliveries, inventory, goodwill and transfers by location, then forecast and plan bakes.
Single static `index.html` + Vercel serverless functions in `api/`. No build step.

- **Local:** `/Users/andrew/data-entry-app/` · **Repo:** `yooandrewh/data-entry-app` (public) · **Live:** https://data-entry-app-roan.vercel.app (the GitHub Pages URL is obsolete).
- **Full design history:** `docs/HISTORY.md` is the old long CLAUDE.md, in the order it was written, so **later sections override earlier ones**. Read the section you need before touching labels, bake sheet, costs, kitchen time, invoices, styling or Home layout. This file holds only what is true now.

## Products

Active (`PRODUCTS`, used by Entry / Forecast / Plan): **Lemon Poppy, Sea Salt, Maple Pecan, Pumpkin Muffin**. `ENTRY_PRODUCTS` adds **Dubai Ball**, shown only when the entry's store is Stanton (zeroed when hidden; no forecast).
Retired but kept so history still shows in Data and on invoices: Ube, Dot, Earl Grey, Earl Grey Mini. They stay in `HIST_PRODUCTS`, `SALES_FLAVORS` (where applicable), `UNIT_PRICE`, the token maps and the API maps. Never delete their data.
Recipes keep every flavor, discontinued ones included. Never filter the Recipes list by `PRODUCTS`.
Pumpkin Muffin, Dubai Ball and the cookie (**Chookie**, in `SALES_FLAVORS` and `EXTRA_SOLD`) are not madeleines and stay out of the madeleine flavor mix and forecast. Maple Pecan is a madeleine flavor and has a sales source.

**Adding a product touches all of:** `PRODUCTS`, `HIST_PRODUCTS`, `PRODUCT_TOKEN`, `PRODUCT_COLOR`, an Entry stepper row, the sheet's Deliveries **and** Inventory columns (add the name to `AUTO_COLUMNS` in `api/_sheets.js`, which adds the header on first write; `appendRow` maps by header name and silently drops a value with no column), and the maps in `api/sync.js`, `api/entries.js`, `api/sales.js`, `api/update-entry.js`.
App "Sea Salt" maps to the sheet column **"Sea Salt Butter"**.

## Backend — Google Sheets

Notion is dead: nothing writes to it, and the `NOTION_*` Vercel env vars can be removed.

- Sheet id `1kmJHEIKkJ3HTvqmIlx2BwSEYZPNbHt28le3LrPQOuIA` (must be a **native Google Sheet**, not an uploaded `.xlsx`). Tabs: Deliveries / Inventory / Sales / Store Sales / StoreStats / Events / Ledger / Pantry / Bakes / Logs.
- Service account `kairos-sheets@premium-griffin-500920-s0.iam.gserviceaccount.com` (Editor). `api/_sheets.js` is a zero-dep client (JWT via `node:crypto`, Sheets v4 REST). Vercel env: `SHEET_ID`, `GOOGLE_SA_JSON` (base64 of the key), `LEDGER_CODE`.
- `ensureTab()` creates a tab on first use. The app URL is public and unauthenticated; anything that costs money or writes shared data needs a server-side code.

## Entry types

| Type | Storage |
|---|---|
| Delivery | Deliveries tab, positive |
| Inventory | Inventory tab |
| Goodwill | Deliveries tab, **negative**, title `Goodwill — La Mirada · Church · note` |
| Transfer | **Two linked rows**: negative at source (`Transfer → X`), positive at dest (`Transfer ← Y`) |

- Deleting one leg of a transfer silently imbalances both stores. Delete both.
- **Soft delete only**: 🗑️ (password `kairos`, a client-side deterrent) sets "Tagged for deletion" = TRUE via `api/tag-delete.js`. Nothing is hard-deleted.
- **Edit** (✏️) works on delivery/inventory only. Goodwill and transfers are signed/paired, so the button is hidden *and* `api/update-entry.js` refuses them. Keep both guards.
- Goodwill has one Location dropdown (`#goodwillLoc`: La Mirada / Stanton / Church). Church records `recipient: 'Church'` and takes stock from La Mirada. Every entry type has an optional Note (≤200 chars, `·` stripped).
- Entry is a popup (`#view-entry`), opened by **+ Entry** on Data and the Entry button on Home. Submit goes through the confirm sheet (`#scrim`).

## Tabs and Home

**Spacing (v1.138.01):** the last CSS block ("Spacing pass") sets 16px side margins, 44px tap height on the page-row chips (`#secNav`) and Data/Plan filters, 8px gaps, roomier cards, and bottom padding that clears the tab bar. Older `!important` rules on `.db-filter` win unless the new rule uses `#secNav` / `#view-x` and `!important`. Checked headless at 390px, not on a phone.

Bottom bar (v1.138.00): **Sales · Inventory · Entry · Plan · Other**. Entry opens the Entry popup (`openEntry()`); the other four each show a row of pages at the top (`#secNav`, `SECTIONS` / `PAGES` / `go(page, sec)`). Every page is an existing screen reused as it was (a Data view, a Home page in `#homePage`, a Baking mode, or Finance); there is no Home photo page any more.
- **Sales:** Sales (Data's sales view), Trends, Invoice. **Inventory:** Ingredients (Pantry with What to buy), Stock (the Forecast page's stock and run-out, with the Both / La Mirada / Stanton toggle), Counts (Data's Deliveries / Inventory / Goodwill / Transfers log), Receipts. **Plan:** Plan (Baking Plan), Bake Day, Forecast, Recipes. **Other:** Finance, Costs, Labels (opens the label popup), Timers.
Add a page: add it to `PAGES` and to a section's `pages`. Jumps between pages use `go(...)`, never `homeTab = ...` alone. The Data header, the Recipes|Costs toggle and Home's old menu are hidden by the last CSS block. Kairos Logs is still unreachable.
**Stanton** is selling again; it shows in Stock (toggle), Sales and Counts (the store dropdown) and Trends. Plan and Baking default to La Mirada. Kairos Logs and Book Commercial Kitchen are removed.

## Forecasting model

`locStats` gives weekday/weekend rates (`dowRate`), `dailyCV`, `growth` (`weeklyGrowth()`: geometric-mean WoW over the last 4 complete weeks, **damped 50%, clamped ±25%/wk**). `depleteDow()` walks day by day at rate × growth^(day/7). `runoutBand()` bands by CV, scaled by ÷√days and **capped ±60%** (uncapped, one outlier hides real dips). Scenario dropdown: Bear / Expected / Bull.
Products with no sales rate read 0.0/day and run-out ∞.
`BATCH_YIELD = 12` (since 2026-10-13; it also drives Plan batch counts). Plan bake dates are specific calendar dates in `localStorage.planBakeDates`; each covers demand until the next, the last one crams everything through the target date. The bake plan starts from this season's recipes on every load; *Save this plan* keeps one.

## Price ledger and costs

Costs read prices from the sheet's **Ledger** tab through `api/ledger.js` (`Id, Receipt, Date, Vendor, Kind item|tax|fee, Item, Amount, Unit g|ml, Price, Note, Link, Deleted, Approved`).
- **Only Approved = TRUE lines count** (`buildCostPrices()`). No built-in fallback; `DEFAULT_PRICES` is only the seed import. Unapproved items show "Needs approval". Don't invent prices.
- Newest purchase date per canonical item (`costCanon`) wins. A receipt's tax and fees are spread over its items. California groceries are untaxed.
- GET is open. POST needs header `x-ledger-code` = env `LEDGER_CODE` (503 unset, 401 wrong). Actions `add` (unapproved unless `approved: true`), `remove` (soft), `approve` (`ids`). Max 80 lines per call. Claude writes receipts through the API with the code in `~/.kairos-ledger-code`, never printed. Andrew doesn't log receipts in the app.
- Sizes are converted to g/ml on save (`UNIT_TO_BASE`); no weight↔volume conversion. Mini Waffle Cones are counted in pieces (`isCone`), never grams.
- Butter shows as `Unsalted Butter (KS)` or `(KG)` everywhere on screen (`bkName`). Printed labels keep plain "Unsalted Butter". Kerrygold only in madeleines, Kirkland elsewhere.
- Names are unified ("Milk", "Maple Syrup"); `PRICE_ALIASES` keeps old ledger names matching.
- The receipt-scan feature and `api/receipt.js` are deleted. Prices come from the ledger only.
- `renderCosts()`: Cost per item and Ingredient prices views. `COST_META` adds filling/topping per item.

## Pantry (Home → Pantry, built 2026-11-17)

Tab **Pantry** (`Id, Item, Amount, Unit, Date, Note, Deleted`); each row is one physical count on a date. `api/pantry.js`: GET open, POST `add` / `remove` need `x-ledger-code`. Soft delete only.
**On hand = latest count + approved ledger item lines dated after it, in the same unit** (`pantryStock()`); lines in another unit set `mixed`. Compared with `buyItems()` for a "Low" flag. Units g, kg, oz, lb, ml, L, fl oz (converted to base on save) and pcs.
Status: live API tested (add/remove round trip); browser-tested 2026-11-17 on desktop Chrome (10 checks pass); **not yet tested on a phone**.

## Upload page (v1.141.02, 2026-11-18)

Other -> Upload. Hyebin (iPhone) picks Sales video La Mirada / Stanton or Receipt photos and sends them **straight to Vercel Blob** using a signed upload link. `api/upload.js` hands out the link (`issueSignedToken` + `presignUrl`, Vercel OIDC via `BLOB_STORE_ID`; the new store has **no** `BLOB_READ_WRITE_TOKEN`, so `handleUpload` can't be used). **Open by Andrew's choice, no code** (like receipt-inbox add); the cap is server-side before any link: 200 MB per file, 40 files / 1.5 GB waiting, video/* or image/* only, one pathname under `inbox/`, 15-minute link. Blobs are public-URL with a random suffix (unlisted, not private), so the Mac must collect them fast. `api/uploads.js` (GET list, POST remove) needs `x-ledger-code`. **Mac collector** `scripts/uploads/upload_poll.py` (LaunchAgent `com.kairos.upload-poll`, installed, every 5 min; README there): downloads to `~/.kairos-uploads/archive/<kind>/`, checks the byte count, only then deletes from Blob; videos are also linked into `~/.kairos-uploads/videos/`, then the collector starts the sales OCR in the background (`~/kairos-ocr/kairos_inbox_watch.py`, no push, no dry run; Andrew reviews `inbox_summary.md` and runs the push scripts); receipts go through `receipt_poll.process()` into unapproved ledger lines; archived files are rsynced to `andrews-macbook-air:~/kairos-uploads`. Store `kairosuplaods` (public) is connected. `UPLOAD_CODE` env var is now unused and can be deleted.

## Sales dashboard (v1.140.00, 2026-11-18)

`salesHomeHtml()` (next to `renderSalesView`) puts four things above the Sales summary, which is now labelled **Overall**: **This week** (about $, Monday to the last sales day, vs the same days last week; same math as the summary: count x `PRICE_PER_UNIT` + `salesAdj`), **Running out** (`runoutBand().days`, expected scenario, every store with a count, within 14 days, soonest 5; "left" is `estLeftNow()`: the count minus the usual weekday/weekend rate for every day since the store's newest sales row or count, shown with `*` and a footnote when that date is before today), **Best seller** this week, **Next bake** (`planBakeDates`). It ignores the Sales filters. Plan step 1 also got big span chips (1 day, 1 week, 1 month, 1.5 months), text-style per-item span pickers and a pinned Next button.

## Plan steps (v1.139.00, 2026-11-18)

Plan page opens as three steps (`#planWiz`, `wizPaint()` after `paintPlan`): **1 Bake** (a span per item: Not now, 1 day, 3 days, 1 week, 2 weeks, 1 month, 1.5 months, 2 months, or Same for every item; `wizSpan` in `localStorage.planSpans.v1`), **2 Ingredients** (`bakeRows()` shortfall against the pantry), **3 Bake sheet** (the existing Bake Plan card). `wizCompute()`: weekday/weekend rates over the span, trend counted for at most 4 weeks, the forecast's CV buffer, minus stock, summed over stores with counts. A span replaces the date-driven total for that item (`planTotals[p]` in `paintPlan`); items with no span keep the old behavior. The old Make it last until / Bake days card sits under a collapsed "Bake dates" in step 1 (Bake Day's per-date views still use it). Screenshot-checked at 390px; not on a phone.

## Bake Day (Home → Bake Day, built 2026-11-17)

`bakeOpen()` / `bakePaint()` / `bakeRows()` next to `buyPaint()`. Takes `buyItems()` (whole bake plan, same as the Buy list) and compares each with `pantryStock()`: **To buy** (short, "Not counted" if no count, "Unit" if counted in a different unit; both list the full need, never treat as zero), **Have enough**, and a collapsed **After the bake: recount** form that saves counts through `pantryPost` (date today, note "After bake"). Baking never subtracts from the pantry by itself; recount is the rule (decided with Andrew). Packs and cost are recomputed on the shortfall. Ticks share `buyChecked` with the Buy list. A dropdown (`bakeView`) switches to **Through <date>** (cumulative bakes from today) or **Only <date>** (one bake), from `planDatesCache` (pieces per date; `paintPlan` fills it and keeps the last 7 days of past dates in `localStorage.planDates.v1` so today's bake can still be marked done) turned into batches by `bakeList()`; only forecast-driven recipes, hand-added ones are left out. **Bake done** (only in the Only-date view, once per date): `api/bakes.js` (tab **Bakes**: `Id, Date, Minutes, Recipes, Note, Deleted`, GET open, POST `add`/`remove` need `x-ledger-code`) records the bake and its minutes (prefilled from Timers' log for that day), then writes estimate counts (today's date, note `Estimate after <date> bake`) = on hand − need for every counted same-unit item; skipped items are listed in the confirm. Liquids sold by volume are converted ml to g with approximate densities (`DENSITY`, `toGrams()`, used by `buyItems()` pack sizes and `pantryStock()`; items not listed are never converted, so add a density there to make a new liquid comparable). Items never counted but bought (approved) after the first pantry count show on hand = those purchases, tagged Not counted (`uncounted`, a floor). The Pantry page's Low flag only compares when the count and plan use the same unit. Browser-tested on desktop Chrome with fake counts; not yet on a phone.

## Bake protocol additions (v1.134.00, 2026-11-18)

- **Yield:** in Bake Day's *Only <date>* view, **Bake done** has a "Pieces made" field per recipe (prefilled with planned = batches x pieces per batch). Pantry use per ingredient = planned need x made / planned (`buyItems([x])` per recipe). "Review and save" shows an in-page confirm (`bdPending`, no native dialog); items with less on hand than used are set to 0 and named in the confirm. The Bakes row's Recipes text records `made N of M`.
- **Pantry** (v1.138.02 order: On hand, What to buy, Count something) opens with **What to buy**: the whole plan against on hand (`bakeRows()`, shared `bkBuyRow`/`bkTotal`/`bkWireTicks` with Bake Day), ticks shared with the Buy list.
- **Receipts** opens with **To review** (`rvPaint`): unapproved ledger item lines grouped by receipt; Approve N lines / Approve all / Remove receipt (tap twice) / remove a line. Calls `ledgerPost` approve/remove in chunks of 80. No auto-approve.
- Baking Plan shows the **Make it last until / Bake days / Add date** card again (it was hidden since v1.120.01, which left Bake Day with no way to set dates). Stanton delivers stays hidden.
- Mock-server browser test passed (pantry, receipts, yield scaling, confirm). Not tried on a phone.

- **Data summary (v1.135.00):** the breakdown at the top and in month folds lists current flavors first; retired ones (`EARLIER_FLAVORS`: Ube, Dot, Earl Grey, Earl Grey Mini, Matcha, Chocolate) sit under a collapsed "Earlier flavors" (`earlierSplit()`). Data is never removed.

## Trends (Home → Trends, built 2026-11-18)

`renderTrends()` next to Pantry; reads `getSales()` (same rows as Data), no new API. Store select (La Mirada / Stanton / Both) and a **Chart | Raw data** toggle (`trLoc`, `trView`). Chart: last 8 Mon–Sun weeks, stacked Lemon Poppy / Sea Salt / Maple Pecan / Other, plus a madeleine table and an Other-items table (BM, CP, PB, CK). **Madeleine total = `trMad()` (madeleine flavors only); the sheet row `total` also counts muffins and cookies, so never use it here.** Weeks under 7 days are hatched and get no change arrow; arrows compare to the last full week. A dash = not tracked yet; `~` = estimated from stock counts (`row.derived`). Raw view: one row per day. Browser-tested headless at 390px; not on a phone.

## Receipt upload (built 2026-11-17/18)

**Phone only uploads; the Mac does the work.** Home -> Receipts -> "Send a photo to the Mac" lets you pick up to 10 photos (sent one at a time) and shrinks each in the browser (long side 1800px, JPEG) and POSTs it to `api/receipt-inbox.js` (tabs `ReceiptInbox`: `Id, Created, Name, Status pending|done|held|failed, Result, Parts, Deleted` and `ReceiptParts`: `Id, N, Data`; GET open lists status only; the phone upload (`add`) is open by choice (internal tool, capped); the pending GET and the other POST actions need `x-ledger-code`; caps: 700k chars per photo, 10 pending). A LaunchAgent (`com.kairos.receipt-poll`, every 5 min, installed from `scripts/receipts/com.kairos.receipt-poll.plist` into `~/Library/LaunchAgents`, log `~/.kairos-receipts/poll.log`) runs `scripts/receipts/receipt_poll.py`: fetches pending photos, runs Apple Vision (`~/.kairos-receipts/bin/vision_ocr`, a copy of the sales-video binary kept outside Downloads/iCloud because macOS blocks background scripts there), parses with `receipt_parse.py` (Costco item numbers from `costco_items.json`), posts **unapproved** ledger lines, and reports done / held / failed to the app, which then blanks its copy of the photo. Held (nothing posted): unknown item number, coupon line, quantity mismatch, total that does not add up. A receipt id already in the Ledger is never posted twice. The Mac must be awake and online. **Share to iCloud** (same page): a web page cannot write to iCloud Drive, so it opens the iPhone Share sheet (`navigator.share` with files) and Andrew taps Save to Files -> "Kairos inbox" (sales videos, renamed `<Store> yyyy-MM-dd HHmm.<ext>` so `kairos_inbox_watch.py` can read the store) or "Kairos receipts" (receipt photos); the Mac watchers run by hand (macOS blocks background reads of iCloud). Untested on a phone. Fallback: "Paste text instead" on the same page (iPhone Live Text, parsed in the browser by `parseReceipt`). The older iCloud-folder watcher (`receipt_inbox_watch.py`, folder "Kairos receipts") still works by hand but cannot run in the background (macOS privacy block). Only Costco is parsed. Details in `scripts/receipts/README.md`.

Costco receipts print a quantity line (`3 @ 4.99`) above an item whose price is the **line total** (14.97); both parsers turn it into 3 lines at 4.99 and block if quantity x price does not equal the line total. The total check alone cannot catch this (line totals add up either way). Verified on the real 2026-11-12 receipt through Apple Vision (Python) and the app parser (node).

## Labels, bake sheet, recipes (details in docs/HISTORY.md)

- Labels live only under Home → Labels (`openLabelGen`, ticks several madeleines, `mlSel` in `labelSel.v1`). Net weight is **ounces first, grams in brackets** (`lblNetText`); fixed per-piece weights in `LBL_NET_G`; ingredients most → least by weight; `Contains:` line for the 9 major allergens; the three storage lines (frozen +21 days, thawed 7 days, room temp 2 days, or "discard after 4 hours" for Lemon Poppy and dairy fillings); manufacturer Kairosbaking, Fullerton CA 92833. The single-label sheet (`openLabel`, `#lblScrim`) is unreachable.
- Bake Sheet: per-recipe batches in the Bake Plan, Preview Plan with mixing steps, "Total ingredients needed" split into "Used in 2+ recipes" and "Other". PDF only (`elementsToPdf()`, `bakeSheetPages()` packs two columns per Letter page; `PAGE_H = 846`), plus Print. No image export.
- Seasonal recipes (`SEASONAL`, `seasonal.v1`) sort first in every recipe/cost dropdown. Recipe cards group ingredients by mixing step (`REC_MAD_STEPS`, or a `steps` / `components` key). Bake temp/time comes from `bsBakeText()`. Maple Pecan has **no bake temperature on file**; don't invent one.
- Testing recipes live in the Recipes **Test** tab (`REC_TEST`). Kitchen Times (`kitchenTimes.v1`) feed `bakeEffort()`.
- Invoices (Home → Invoice): sums `delivery` entries per store and date range, excludes goodwill / transfers / deleted rows. Unit prices default to `PRICE_PER_UNIT` ($2.50, retail), with dated changes in `PRICE_FROM` / `unitPriceOn()` (Blueberry Muffin $2.75 before 2026-11-10). Nothing is written to the sheet.
- Print and PDF documents use **Archivo** (embedded by `archivoEmbedCss()`; falls back to Arial offline) and `@page { size: letter; margin: .5in }`.

## Visual language

**TEMPORARY (2026-11-18, v1.133.00): the app is black and white with the iPhone system font (SF Pro), so work can stay on function.** One block at the end of the stylesheet, marked `BLACK AND WHITE`, does it (variables, selected states, greyscale photo and icons, grey Trends chart, `-apple-system` font); delete that block and the navy/caramel palette below returns. Printed documents keep Archivo. Until then, new UI uses only black, white and greys (no new colors) and the system font. Finance tab and Entry popup checked in B/W 2026-11-18 (headless, 390px): both read fine; Finance keeps a red warning banner and a faint pink tint on the edited top-line input.

- **Current look: "Photo palette, bright"** plus **Glass buttons + dropdowns**: cream ground `#f2eee7`, cards `#fbf9f5`, ink `#232a33`, muted `#6d6660`, caramel `#a45a22` (`--accent`: selected, primary, links, values). See-through fills with a 1px navy outline and light blur. Fonts: **Roboto**, with **Italiana** for big titles. Titles are Title Case. Home's landing sits on the photo (`hero.jpg`, `.home-bg`) with transparent cream-outlined buttons.
- **The last CSS block in the stylesheet wins.** Plum, mauve, apricot, neumorphic, Keys and gradient blocks beneath it are dead weight. Edit the final blocks; don't reintroduce iOS blue or the old palettes.
- **One type scale** on `:root`: `--fs-micro` 11 / `--fs-nav` 12 / `--fs-caption` 13 / `--fs-body` 15 / `--fs-lg` 17 / `--fs-title` 20 / `--fs-figure` 26 / `--fs-display` 32. **Don't add a raw px font-size.** Exceptions: `h1` (30), `--fs-hero` (40), `.tok`, `.db-empty .big`.
- **Flavors are two-letter tokens** (`PRODUCT_TOKEN`, `PRODUCT_COLOR`, `tok(p)`). **Per-flavor numbers stack** in `.proj-row` rows (`kvRow()`), never side-by-side pills.
- **No emoji.** All icons come from `IC` (inline line icons; `ic(name, px)`, `recIc()`, `<span data-ic>`; map new recipes in `REC_ICON`). Survivors: typographic ✓ / ✕ and the 🗑️ / ✏️ row actions. Nav icons are separate inline SVGs.
- Every `<select>` opens the app's own list (`openSelectPopup()`, `.sp-pop`); `data-native` opts out. Needs the touchend `preventDefault` on iPhone, so verify on device.
- Bottom nav is a full-width bar flush to the bottom; on the Home landing it is see-through and outlined.

## Version badge

`.ver-badge` reads `v<major>.<minor 2-digit>.<patch 2-digit> · <PST time>` and is **bumped by hand in every deploy commit** (it is in normal flow above the nav; `#homeVer` copies it). major = redesign or new data model, minor = new feature or page, patch = fix, wording, price or recipe data. Last deploy: **v1.141.03**; the next feature is v1.142.00, a fix v1.141.04. Check live: `curl -s https://data-entry-app-roan.vercel.app | grep -o 'ver-badge">[^<]*'`.

## Usage analytics

`track(name, props)` queues events and posts batches to `api/track.js`, which appends to the **Events** tab. Stored: random device id (`localStorage.kairosDeviceId`), coarse device label, event name, small JSON props. No IP, user agent or entry text. The URL is public, so read Events as "sessions", not "me". Events: `open`, `tab`, `data_filter`, `data_range`, `data_location`, `data_grouping`, `entry_submit`, `forecast_scenario`, `baking_mode`, `invoice_create`.

## Gotchas

- Vercel is linked to the `andrewlew1s` GitHub identity; push-to-deploy on the `yooandrewh` repo is unreliable and often needs a manual Redeploy.
- Recipes were ported from `~/Downloads/kairos.html`, still the source of truth for recipe text. Recipes are visible to anyone with the URL (no gate).
- Client-side `localStorage` holds invoice prices, cost yields, kitchen times, seasonal list, plan dates, label ticks and the ledger code; nothing there is secret except `ledgerCode`.
- Sales data is written by the OCR pipeline in `~/kairos-ocr/` (moved out of Downloads 2026-11-18 so background jobs can read it; `~/Downloads/kairos_videos_raw` is now a symlink to it) (see its CLAUDE.md); `parse_kairos.py` auto-pushes Sales and StoreStats. After inventory or delivery entries, run `scripts/reconcile.py` and ask Andrew about any gaps in chat.
