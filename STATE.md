# STATE — where we are (update after each finished piece)

Last updated: 2026-11-17
After a `/compact` or in a new chat: read this file first, then CLAUDE.md. Stable rules live in CLAUDE.md; only status lives here.

## Now
- **Pantry (Home → Pantry):** built and committed on branch `pantry-wip` (commit 6a74317), pushed. NOT on `main`, NOT deployed, NOT tested in a browser or against the live sheet.
- Context-overhead trim: project CLAUDE.md (44k → 13k bytes) and global CLAUDE.md (22k → 10k) done; old text kept in `docs/HISTORY.md` and `~/.claude/docs/CLAUDE-HISTORY.md`. Three local skills moved to `~/.claude/skills-disabled/`. Connectors Crisp, Supabase, Figma, Drive turned off (Vercel kept).

## Next
1. Andrew: switch off the `design` plugin and synced skills `setup-claude`, `import-memory`, `consolidate-memory`, `morning`, `docx`, `pptx` in the app (Claude can't do this). Check with ListPlugins / ListSkills.
2. Merge `pantry-wip` to main, bump the badge to **v1.124.00**, run the secrets scan, deploy (often needs a manual Redeploy), then test Pantry on a phone and against the live sheet.
3. In a fresh chat, run `/context` to measure the savings and see the context window size.
4. Decision 5 (habits) is open: when to handoff vs `/compact`, and whether to add a "Don't / constraints" section to the handoff skill.

## Don't
- Don't push untested Pantry straight to `main`.
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
- Pantry went to branch `pantry-wip`, not `main`: push-to-deploy would put untested code live.
- Vercel connector kept (deploys, logs); Crisp, Supabase, Figma, Drive turned off: unused, and their tool lists add to every chat's fixed context.
- Handoff threshold stays 150k for now; revisit once `/context` shows the window size.
- On hand = latest count + approved ledger lines after it, same unit only; mixed units are flagged, not converted.

## Open questions
- Does the account-level skill/plugin list update after switching things off, or does it need a new chat?
- Which context window size is this account on (200k or 1M)? It sets the sensible handoff threshold.
