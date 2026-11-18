# STATE — where we are (update after each finished piece)

Last updated: 2026-11-18
After a `/compact` or in a new chat: read this file first, then CLAUDE.md. Stable rules live in CLAUDE.md; only status lives here.

## Now
- **v1.135.00 LIVE:** Data summary folds retired flavors under 'Earlier flavors'. **Queued:** Baking controls (fold category chips into the dropdown), Home items ordered by use (Baking Plan, Invoice first), nav Option A (unanswered; the bar already has labels and a black active tab, so it may need only bigger icons), check Finance tab and Entry popup in B/W.
- **v1.134.00 LIVE (49b10a7):** yield step in Bake done, Pantry 'What to buy', Receipts 'To review' approval list, bake-date controls back on Baking Plan, plus Bake Day fixes (in-page confirm, 11px tags, 'have' label, form clears, badge pill). Mock-server browser test passed; not on a phone. **The live ledger has 66 unapproved lines waiting in Receipts > To review** (Nov 12 Costco receipt and older). The pantry needs a first full count or everything reads Not counted. **Queued:** nav Option A (unanswered), Data summary (active four flavors, retired under Earlier flavors), Baking controls (chips into the dropdown), Home items by use, check Finance tab and Entry popup in B/W.
- **v1.133.00 LIVE (b5bf4d3):** temporary black-and-white theme + iPhone system font (one CSS block marked BLACK AND WHITE; delete it to restore colors). Finance tab and Entry popup not checked. **Queued, in order:** (1) yield step in Bake Done (enter pieces made per recipe; ingredients used = planned x made / planned) plus the Bake Day browser-test fixes (silent zero when need > on hand, native confirm() to an in-app sheet, tags under 11px, version badge overlaps rows, 'have' label on Have enough rows, Pantry form not clearing, check that '+ Add date' is hidden on Baking Plan); (2) 'What to buy' section at the top of Pantry; (3) receipt approval section: OCR lines wait in a review list, Andrew approves, approved lines feed Costs and Pantry (no auto-approve, decided 2026-11-18); (4) nav Option A (four labeled tabs, bigger icons, clearer active tab); (5) Data summary: only the four active flavors, retired under 'Earlier flavors'; (6) Baking controls: fold category chips into the dropdown; order Home items by use (Baking Plan and Invoice first). Usage (Events, Sep 19 to Nov 18): Data 401 / Home 388 / Baking 348 / Finance 64 tab opens; Baking Plan 96, Invoice 81, Forecast 44 Home opens; Pantry 7, Bake Day 5, Receipts 3. The live /api/sales once returned zero rows during testing (likely a transient Sheets read); recheck if it repeats.
- **v1.132.00 LIVE (dce6bde):** Home menu regrouped Sell / Bake / Buy on a glass panel, plain-case larger text. Part 1 of the cleaner-UI pass. Next: Data summary (show only active flavors, retired under 'Earlier flavors'), then Baking controls (fold category chips into the dropdown). Legibility goal applies to all three. Not checked on a phone.
- **v1.131.00 LIVE (8a2ae61):** Home → Trends (weekly stacked chart + tables + Raw data view). Headless-tested at 390px with live data; not on a phone. v1.129 (multi-photo receipts) and v1.130 (Share to iCloud) are live too; the Share sheet with large videos and a real phone receipt upload are still untested.
- **v1.128.00:** receipt photo upload. Phone Send -> Sheet inbox -> Mac poller (LaunchAgent, 5 min, Apple Vision) -> unapproved ledger lines + status back in the app. Real 2026-11-12 receipt parses to 7 correct lines (quantity lines fixed in v1.127.01). Live round trip, iPhone camera/HEIC and 390px layout still to verify.
- **v1.127.00 (built, not committed or deployed):** Home → Receipts: paste the receipt text (iPhone Live Text), Read, review, Post as unapproved Ledger lines. Costco only; blocks on unknown item, coupon, total mismatch or duplicate receipt. Parser tested in node (`parseReceipt`); not tried on a phone with real Live Text, never posted to the live API.
- **Receipt upload (Mac side built, not deployed, no app change):** `scripts/receipts/` (watcher, Costco parser, ledger push, README). Same iCloud-inbox + Apple Vision flow as the sales videos. End-to-end tested on a rendered fake receipt; real phone photo, an iOS Shortcut and a schedule (LaunchAgent) are still to do.
- **v1.126.01 (live, 55f4789):** liquids bought or counted in ml now compare with the gram plan via a density table (`DENSITY`). Receipt upload is NOT built. Research 2026-11-17 (free only): best fit is Gemini API free tier (Flash-Lite, no card, JSON line items, but Google may train on free-tier images; check AI Studio rate limits first); runner-up is iPhone Live Text copy + paste into a textarea with a client-side parser (no privacy cost, one manual step). Tesseract.js is weak on thermal receipts; Google Vision needs a billing account; Mindee/Veryfi free tiers unreliable. Today receipts cost $0 because Andrew sends the photo and Claude enters it through the ledger API.
- **v1.126.00:** Bake Day: 'Only <date>' view, **Bake done** (records bake + minutes in new Bakes tab via api/bakes.js, lowers pantry as an estimate), never-counted items count purchases since the first count. Node-tested; API not yet round-tripped live; UI untested in a browser. Clipboard in a sandboxed iframe shows 'Couldn’t copy' (test artifact).
- **v1.125.02 live:** fixed the three browser-test nits (Not counted tag beside the name, Amount/unit inputs side by side, Pantry page runs the plan so 'plan needs' is consistent, Copy list has a fallback). Re-check by subagent was running when this was written.
- **v1.125.01:** Bake Day has a 'Through <date>' view (cumulative bakes up to a date); Pantry 'Low' flag now compares only same-unit counts. **Browser-tested 2026-11-17 (desktop Chrome, fake counts, 390px iframe): all 10 checks pass, no console errors, no POSTs.** Open nits: at 390px the 'Not counted' tag squeezes the item text and the amount/unit inputs stack; Pantry 'plan needs' differs until the plan has run once (Pantry page never calls renderPlan); Copy list untested on a real device. Phone test still Andrew's.
- **v1.125.00: Bake Day** (Home → Bake Day): shopping list from plan vs on hand, 'Not counted' / 'Unit' flags, recount-after-bake form. Syntax + shortfall logic tested in node only; UI untested (Chrome still not connected).
- **v1.124.01 (78ed71f) live:** the three Pantry nits are fixed. Browser UI test tried again, Chrome still not connected (open Chrome, click the Claude icon, sign in), so it is still untested in a browser.
- **Done in v1.125.00 (was Andrew's idea):** Bake Day page. Pick a bake date, show plan needs vs on hand, list what to buy. Gaps: stock never goes down after a bake (leaning: recount after the bake, not auto-subtract), uncounted items must read 'not counted', not zero.
- **Pantry (Home → Pantry):** merged to `main` and LIVE as **v1.124.00** (2026-11-17, commit 1308a44). Live API tested: GET open, POST rejects missing/wrong code (401), add + remove round trip worked (one soft-deleted "ZZ TEST (delete)" row remains in the Pantry tab). The browser UI test could NOT run (Claude in Chrome was not connected), so Pantry has only API + code-review checks; NOT yet tested on a phone.
- Context-overhead trim: project CLAUDE.md (44k → 13k bytes) and global CLAUDE.md (22k → 10k) done; old text kept in `docs/HISTORY.md` and `~/.claude/docs/CLAUDE-HISTORY.md`. Three local skills moved to `~/.claude/skills-disabled/`. Connectors Crisp, Supabase, Figma, Drive, Vercel turned off. `autoCompactWindow` raised 150k to 250k (may be capped by the real window size).

## Next
0. (DONE 2026-11-17, see Now) Browser UI test of Pantry: re-run via a subagent once Chrome is open and signed in to the Claude extension (page renders, empty state, no-code prompt, fake-row logic, 390px layout). Never give it the ledger code.
   (Code-review nits done in v1.124.01.)
1. Andrew: switch off the `design` plugin and synced skills `setup-claude`, `import-memory`, `consolidate-memory`, `morning`, `docx`, `pptx` in the app (Claude can't do this). Check with ListPlugins / ListSkills.
2. Andrew: test Pantry on a phone (add a count with the ledger code, check on-hand and the "Low" flag).
3. In a fresh chat, run `/context` to measure the savings and see the context window size.
4. Decision 5 (habits) is open: when to handoff vs `/compact`, and whether to add a "Don't / constraints" section to the handoff skill.

## Don't
- Don't touch `scripts/reconcile.py` (modified, unknown origin), `exports/`, `scripts/reconcile.py.bak_win`, `.claude/worktrees/`.
- Don't delete retired product data; don't invent prices or a Maple Pecan bake temperature.
- Don't print or commit the ledger code (`~/.kairos-ledger-code`).

## Files touched (Pantry work)
- `index.html`: Pantry block near line 7183 (`PANTRY`, `fetchPantry`, `pantryPost`, `pantryStock`, `renderPantry` into `#homePantry`).
- `api/pantry.js` (new): GET open, POST `add` / `remove` need `x-ledger-code`.
- `CLAUDE.md` (trimmed), `docs/HISTORY.md` (old CLAUDE.md text).

## Verify
- `node --check api/pantry.js`
- Live version: `curl -s https://data-entry-app-roan.vercel.app | grep -o 'ver-badge">[^<]*'`
- After inventory/delivery entries: `scripts/reconcile.py`, then ask Andrew about gaps.

## Decisions (with why)
- Pantry sat on `pantry-wip` first so untested code wouldn't auto-deploy; merged (fast-forward) after a clean secrets scan and the API tests. Push-to-deploy worked this time within ~20s.
- Vercel connector turned off 2026-11-17 (200+ tools; push-to-deploy needs only git, a stuck deploy is redeployed from the Vercel dashboard; re-enable from the connectors menu if needed). Crisp, Supabase, Figma, Drive also off: unused, and their tool lists add to every chat's fixed context.
- Handoff threshold stays 150k for now; revisit once `/context` shows the window size.
- On hand = latest count + approved ledger lines after it, same unit only; mixed units are flagged, not converted.

## Open questions
- Does the account-level skill/plugin list update after switching things off, or does it need a new chat?
- Which context window size is this account on (200k or 1M)? It sets the sensible handoff threshold.
