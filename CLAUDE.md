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
  `h1` (30px), `--fs-hero` (40px, Home's headline), `.tok` (sized to its box) and `.db-empty .big` (an emoji graphic). **Don't add a
  raw px font-size** — pick the nearest step, or the scale stops being one. It had drifted to 23
  distinct sizes before 2026-09-22.
- **Emoji are gone from labels and controls.** They survive only where they carry meaning: the
  Bear/Bull scenario toggle, recipe icons (`REC_ICON`), empty-state glyphs, and status marks
  (✓ synced, ⚠️ warning, 🔥/🥶 forecast misses, 🗑️/✏️ row actions).

## Tabs

Home · Data · **Baking** — three tabs; nav shows an inline-SVG icon + label. **Entry is no longer a tab
(2026-09-29)**: it's a popup (`#view-entry`, `.entry-modal`) opened by the **+ Entry** button at the top
right of Data. Submit still goes through the confirm sheet (`#scrim`) that summarises the whole entry,
and the popup closes on success.

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

**Receipt scan** (Baking → Costs → Ingredient prices → *Scan a receipt*): `api/receipt.js` sends the
photo (downsized to ~1600px JPEG client-side) to the Anthropic API with a `record_receipt` tool and
the app's ingredient names; the client shows a review sheet (`#rcpScrim`) and only writes prices the
user confirms. Needs Vercel env **`ANTHROPIC_API_KEY`**. The app URL is public, so also set
**`RECEIPT_CODE`** — the client prompts for it once and remembers it (`localStorage.receiptCode`);
without it anyone with the link can spend the API credits. Optional `RECEIPT_MODEL`.
The receipt image is not stored, but it does leave for Anthropic's API.

## Bake sheet (Baking → Plan, bottom card)

Choose from the **seasonal** recipes (dropdown adds on select; batches default to the plan's projected bake via `planBakeTotals` + `BS_PRODUCT`, else 1; **Add all seasonal** adds them all) — batches saved in `bakeSheet.v1`. **Preview sheet** → per-recipe
scaled ingredient lists, then **Total ingredients needed** merged across recipes, showing only `BS_TOTALS`
(butter, eggs, sugar, powdered sugar — for now). `bsCanon` only merges spelling variants. Print (`printing-bake`) or
**Download as image** (`domToBlob()`, shared with the label). Amounts are the base version of each
recipe from `costRows()` (flavoring, glaze and topping rows included). It is independent of the
forecast — it doesn't prefill from the Plan numbers.

**Seasonal recipes** (`SEASONAL`, editable via *Edit this season's recipes*, saved in `seasonal.v1`;
default Classic, Lemon Poppy, Pumpkin Pie Spice, Maple Pecan madeleines, Lemon Curd, Pumpkin Cream Cheese Frosting)
sort to the top of every recipe/cost dropdown ("This season" group) and are the only ones the bake
sheet offers. Everything else stays reachable in the Recipes tab — nothing is hidden there.
`BS_PRODUCT` maps recipe → forecast product for batch defaults (Classic→Sea Salt is a guess).

**Generate labels** (Baking → Recipes → *Generate labels*): tick several madeleines (`mlSel`, saved in
`labelSel.v1`; *Seasonal / All / None* shortcuts), set one manufactured date, and it lays them out as
one page of stacked labels (`lblMarkup()` — the same markup as the single label). **Print** or
**Download as image** (`domToBlob(…, 640)` lays out at a fixed 640px so the PNG isn't squeezed to the
phone width). Multi-label always uses each recipe's first version and the computed net weight; use
the single-label button on a recipe to pick another version or edit the net weight first.

**Labels → PDF**: *Download PDF (to print)* on both label sheets uses `elementsToPdf()` — a small
built-in PDF writer (no library): each label is rendered to a JPEG and placed whole on US-Letter
pages (never split across a page). The bake sheet has no PDF button yet (image/print only).

## Soft UI (2026-09-29)

Buttons are neumorphic: one shared surface (`--bg` = `--card`), raised with paired light/dark shadows
(`--neu-sm`, `--shadow`), sunk when pressed/selected (`--neu-in`), accent buttons raised in the accent
colour (`--neu-acc`). The override block is the **last** thing in the stylesheet ("Soft UI") — it wins
over the rules above it, so edit there. Spacing was tightened in the same block. No dotted underlines on
inputs (quantity fields get a soft well only while focused). Entry amount fields select their contents
on focus and strip leading zeros, so typing replaces the 0 instead of sitting next to it.
**This season's recipes** are edited from Home only (*This season's recipes → Edit*).

## Home is the planning screen (2026-09-29)

Home (**Kairosbaking**) is three tabs (`#homeTabs`, `homeTab`): **Forecast** (scenario **dropdown**
`#projScenario` — Bear / Expected / Bull — plus the forecast list and store analytics, i.e. what the live
site shows), **Baking plan** (`#bakingPlan`: make-it-last-until, bake days, plan cards, bake sheet) and
**Invoice** (inline form; the invoice itself opens in `#invScrim` with Print / Copy). A small **This season**
button top right opens the seasonal-recipes sheet (the only place it's edited; its button reads *Update*).
The plan only loads when its tab is opened, so Home doesn't pay for it on every visit. The **Baking** tab is now just
**Recipes | Costs** (`bakingMode` defaults to `'recipes'`; there is no Plan mode).

## Goodwill "Given to" + notes

Goodwill entries have a **Given to** pill (Customers / **Church**) and every entry type has an optional
**Note**. `api/sync.js` writes them into the notes column after the title, separated by ` · `:
`Goodwill — La Mirada · Church · Sunday service`. Only `Church` is accepted as a recipient (allow-list);
notes are clipped to 200 chars and any `·` is stripped so the separator stays unambiguous. The Data list shows
the extra text under the store name (`entryExtra()`). Edit is still refused for goodwill/transfer.

## Home layout + palette depth (2026-09-29)

Home copies the Chick-fil-A app's home screen: an **apricot hero** (`.home-hero`) with a big plum headline
and the **madeleine cut-out** (`madeleine.png`, from IMG_0909.HEIC), one white **card** (`.home-card`)
holding underline tabs (`.hc-tabs`: Forecast / Baking plan / Invoice), and a footer link (*Generate
labels*). The bottom nav is a **floating rounded pill** (`.tab-pill`) with a soft highlight on the active
tab; the version strip sits on top of it. The whole palette was **deepened** because the first soft
version read pale: `--bg` is now an apricot tint (`#f8e2d0`), text is Deep Plum, primary buttons use
`--grad` (a mauve gradient). Apricot `#f0a875` / Plum `#341f37` / Mauve `#a067a2` are still the only brand
colours. `madeleine.png` was cut out with a colour-segmentation script (macOS's Vision subject-mask API
isn't in this machine's SDK); redo it the same way if the photo changes. The small madeleine also marks
the *Mads* segment in Recipes.

## Keys + plum default (2026-09-29, supersedes the neumorphic look above)

**Deep Plum is the default colour** (`--accent: #341f37`): tabs, links, values, selected and primary
buttons. Buttons are squared **keys**, like elevator panels: light brushed-metal keys normally
(`--key-light`), dark plum keys with a soft glow when selected or primary (`--key-dark`, `--glow`), a
2px bottom edge and a press-down state. The segmented control is a dark panel with a lit light key;
the floating nav is a dark plum slab whose current tab is a lit key. This is the **last block in the
stylesheet ("Keys")** and it overrides the earlier "Soft UI" rules, which are now mostly dead — edit the
Keys block, don't the older ones. Mauve/apricot are secondary (apricot page tint, hero fallback).

Home's hero is the **actual photo** (`hero.jpg`, resized from IMG_0909.HEIC) with the name over its dark
corner; the background-removed madeleine (`madeleine.png`) is only the small logo beside the name and the
Mads button icon.

**Sharp + flat (2026-09-29):** every corner is square (`* { border-radius: 0 !important }` in the final
"Sharp + flat" block) and there are no glows (no text-shadow / icon drop-shadow on selected keys). The
hero has no logo any more — `madeleine.png` is only the small icon on the Mads button. Selects layer their
chevron over the key gradient (`background-image: chevron, gradient` with per-layer size/position) — a
plain `background:` shorthand on a select wipes the arrow's sizing and it tiles across the field.

## Flat gradient (2026-09-29) — the current look; supersedes Soft UI, Keys and Sharp

Simple UI-kit style: **no shadows anywhere** (`* { box-shadow: none !important }`), rounded shapes
(12px controls, pills for chips/pickers, 16px cards, 18px Home card), a faint plum tint
(`--tint`) for unselected controls and a **plum→mauve gradient** (`--grad`) for anything selected or
primary (also the floating nav bar). It is the **final block of the stylesheet ("Flat gradient")** and
wins over everything above it; the earlier Soft UI / Keys rules are dead weight kept underneath. Home's
hero is still the real photo. Edit that last block to change the look.

**Fonts + Home backdrop (2026-09-29):** the app font is **Roboto** (replaced Catamaran); only Home's
*Kairosbaking* title uses **Italiana** (Google Fonts' serif — read "Italiano" as this). The Home photo is a
**fixed full-screen backdrop** (`.home-bg`, `position: fixed`, only shown while Home is active) that stays put
while the card scrolls over it; `.home-hero` is a transparent 500px spacer that keeps the madeleine visible
above the card. Print label/invoice/bake-sheet documents keep Arial/Georgia on purpose.

## Home = landing + pages; sharp, flat, no gradation (2026-09-29, latest)

Home opens on the photo with three **transparent outlined buttons** (Forecast / Baking plan / Invoice,
`#homeMenu`); each opens its own page (`#homePage`, `homeTab`) with a **‹ Back** header. The Home tab in
the nav always returns to the landing. The **version line** is shown over the photo below the buttons
(`#homeVer`, copied from `.ver-badge` at load — so the hand-bump in `.ver-badge` still covers both); the
fixed strip is hidden on the landing (`body.home-landing`) and shown everywhere else.

The look is now **sharp** (`border-radius: 0 !important`), **no shadows**, **no gradients** (`--grad` is a
single flat plum; the nav is solid plum). This reverses the rounded gradient look of a few hours earlier —
the final CSS block wins, so edit that one. Older Soft UI / Keys / Flat-gradient rules are dead weight.

**Inverted colours (experiment, 2026-09-29):** Deep Plum ground (`--bg #341f37`), peach ink
(`--text #f8e2d0`), apricot for selected/primary/nav. It is one clearly-marked block at the end of the
stylesheet ("EXPERIMENT: inverted colours") — **delete it to get the peach-ground look back**. Note `--plum`
is deliberately re-pointed to peach there (it means "the ink colour on tinted controls"). Paper documents
(invoice, labels, bake sheet) keep their own dark-on-white colours. All big titles (`h1`, Home title, sheet
`h2`, Home page titles) are **Italiana**; **This season** is a compact 36px solid peach button.

**Bottom nav (latest):** one solid apricot bar, full width and flush to the bottom edge (not a floating
pill) — `--tabbar-h` is 62px. The active tab is a darker tint; no focus outline. The earlier floating-pill
notes above are superseded.

**Downloads are PDF-only (2026-09-29):** every "Download as image" button is gone (single label, Generate
labels, bake sheet); each has one **Download PDF** button built by `elementsToPdf()` (+ `downloadPdf()`),
plus Print. Each label / recipe block / totals block is its own element so it stays whole on a page. The
older notes above that mention image/PNG export are out of date; `domToCanvas()` remains only as the PDF's
renderer.

**Bake sheet PDF format (2026-09-29):** plain prep sheet — `RECIPE NAME` (bold, uppercase) with a small
`2 batches · ≈ 36 pcs` line, then `190 grams Whole eggs` lines grouped **wet / dry / fat** with a gap
between groups (`recMadRank`), then a *Total Ingredients Needed* block. `bakeSheetPages()` measures each
block and packs them into **two columns per Letter page** (page 1 has the title) so no block is split;
the on-screen preview is the same blocks in one column (`.bs2-*` styles). Titles across the app are
Title Case (Bake Sheet, Baking Plan, Confirm Entry, …).

## Kitchen time + booking link (2026-09-29)

Plan cards show **kitchen time** for the commercial kitchen (`bakeEffort()` / `kitchenRows()`), from
editable assumptions (*Kitchen Times*, saved in `kitchenTimes.v1`, defaults in `KT_DEFAULT`):
**batch prep** = ⌈batches ÷ 3⌉ × 17.5 min (before the batter rests); **baking after resting** = rounds ×
(12 bake + 5 cooling) where a round is 4 pans × 12 madeleines, + 15 s glazing per Lemon Poppy / Earl Grey
madeleine, + 30 min cleaning; **total to book** = prep + baking. **Setup (15 min) is shown but not booked.**
*Madeleines per pan = 12 is an assumption* (a batch is 18) — change it in Kitchen Times if your pans differ.
Home has a **Book Commercial Kitchen** link (opens The Food Corridor's booking page in a new tab).

## Photo palette, bright (2026-09-29, latest — replaces the plum/peach themes above)

The rest of the app takes its colours from the Home photo and is **light**: caramel crust `#a45a22`
(`--accent`: selected, primary, links, values), cream plate → ground `#f2eee7` / cards `#fbf9f5`, shadow navy
`#232a33` (ink), warm grey `#6d6660` (muted). The inverted-plum experiment is gone. This is the last CSS
block ("Photo palette, bright") and wins over the older ones. The Home *landing* still sits on the photo
with transparent outlined buttons, centred vertically (`#view-home:not(.paged)` is a flex column with the
menu on `margin: auto`); Home's sub-pages and every other screen use the bright theme. Apricot/plum/mauve
from the first palette are no longer used.

**Version line (latest):** it is no longer a fixed strip. `.ver-badge` sits in normal flow at the end of the
content (just above the nav), so it only appears when you scroll to the bottom of a page and never overlays
content — like it already did on Home's landing (`#homeVer`, over the photo). It is still hand-bumped in
`.ver-badge`. The earlier notes about a fixed strip / `--footer-h` are superseded (`--footer-h` is 0).

**Glass buttons + dropdowns (latest):** all buttons and dropdowns use the Home buttons' idea — a see-through
fill (`rgba(255,255,255,.30)`), a 1px navy outline and a light backdrop blur — instead of solid tints.
Selected = caramel-tinted glass with a caramel outline and caramel text; primary buttons (Submit,
Generate, + Entry) are caramel at 90% with an outline. Last CSS block ("Glass buttons + dropdowns").

**Goodwill location (latest, replaces the *Given to* pills):** for Goodwill the Location row is one dropdown
(`#goodwillLoc`): **La Mirada / Stanton / Church**. Choosing Church records `recipient: 'Church'` and takes
the stock out of **La Mirada** (the only active store) — there is no separate *Given to* row any more.
Storage is unchanged (`Goodwill — La Mirada · Church · note`). The × / − / + controls are borderless.

**Home's bottom bar (latest):** on the Home landing (`body.home-landing`) the nav is see-through and outlined
in cream like the buttons over the photo; on every other screen it's the light bar.

**Labels live only under Baking Plan (latest):** the *Generate Labels* button is on Home → Baking Plan, under the
bake sheet. The Home footer link, the Recipes-tab link and the per-recipe *Make ingredient label* button were
removed (the single-label sheet code, `openLabel()` / `#lblScrim`, is now unreachable — Generate Labels lets you
tick just one recipe instead). **Bake days** are plain letters (no boxes) on the label's line; the chosen day is
caramel with an underline.

**Dropdown lists (latest):** every `<select>` opens an **app-styled list** (`openSelectPopup()`, `.sp-pop`:
cream panel, thin outline, group labels, caramel current choice with ✓) instead of the browser's dark native
picker. The `<select>` itself remains the button and holds the value; choosing an option sets it and fires a
normal `change`, so existing handlers are untouched. It's wired by document-level delegation (mousedown +
iOS touchend `preventDefault`, Enter/Space/↓ from the keyboard, Esc / outside-click / page scroll to close).
Add `data-native` to a select to opt out. iPhone behaviour relies on the touchend `preventDefault` — verify on device.
