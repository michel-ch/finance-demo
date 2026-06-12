# ARCHITECTURE.md

Condensed, agent-facing map of Finch. This is a focused split of `AGENTS.md`. For the
deep reference read `docs/architecture.md` (runtime composition, boot, data flow) and
`docs/data-model.md` (the 14-table schema and recompute formulas). For visual maps see
`docs/diagrams/` and the master flux list `docs/architecture-fluxes.md`. Code is the
source of truth; when this doc and the code disagree, trust the code and flag it.

This is the **demo twin** of Finch (the presentation build). See
`docs/demo-vs-production.md` for the full production-vs-demo diff.

## What it is

A static, no-build, fully offline personal-finance app. Plain HTML pages load React +
ReactDOM (UMD, from a CDN) and Babel-standalone, which transpiles JSX in the browser.
There is no bundler, no SPA router, and no backend. Persistence is `localStorage` only.
Verified: zero `fetch`/XHR/axios/WebSocket calls - do not add a network edge.

## Two shells, one source tree

- **Desktop** - boots from `webapp/desktop/page.js`; sidebar nav; `screenMap` of 15
  keys: `home`, `forecast`, `transactions`, `goals`, `accounts`, `budgets`, `recurring`,
  `investments`, `networth`, `cards`, `import`, `simulator`, `profiles`, `onboarding`,
  `settings`.
- **Mobile** - boots from `webapp/mobile/page.js`; 6 bottom tabs: `home`, `transactions`,
  `forecast`, `goals`, `add`, `more`.

Each route is its own `.html` file that mounts the same React shell with a different
active screen. Navigation is real: `onNav(id)` -> `location.href = id + '.html'`, so back/
forward and bookmarks work and each load re-runs the auth guard.

## Globals on `window`

- `window.FC.*` - screens and helpers, registered by JSX IIFEs in `components/*.jsx` and
  `desktop/*.jsx`.
- `window.FCStore` (`webapp/store.js`) - `localStorage` data API + money engine.
- `window.FCAuth` (`webapp/auth.js`) - profiles, session, PIN (SHA-256 with legacy djb2
  fallback).
- `window.FCData` (`webapp/data.js`) - mock seed.

## Persistence

`localStorage`, per-profile namespaced as `fc.data.{profileId}.{table}`. Global auth keys:
`fc.profiles.v1`, `fc.session.v1`, `fc.pinLocked.v1`. 14 tables: `accounts`, `cards`,
`transactions`, `categories`, `tags`, `recurring`, `goals`, `budgets`, `holdings`,
`dcaPlans`, `importStaging`, `importTemplates`, `priceCache`, `fxCache`.

## Money engine (`store.js`)

- `getFxRate(from, to)` - direct -> inverse -> EUR triangulation -> 1:1 fallback (+warn).
- `buildForecast({days, accountIds, baseCurrency})` -> `{history, projection:[{d,date,v}],
  events:[{date,t,n,a}]}`.
- `addMonths` - month-end clamp.
- `parseLocalDate` / `ymdLocal` - local-midnight date handling.
- `recompute` - re-derives `account.balance`, `goal.current`, `budget.spent`,
  `card.cycleSpend` from transactions; skips transfer rows.
- `tickRecurring` - rolls each rule's `nextDate` forward; `direction === 'in'` is income,
  otherwise outflow.

## Boot order (`page.js`)

`requireSession` guard (-> `login.html`, or `pin.html` when idle-locked) -> `loadOpts`
(theme/accent) -> `seedIfEmpty` + `seedFxIfEmpty` -> `tickRecurring` ->
`buildLiveData(profile)` -> render the active screen.

## Refresh-on-save

Modals dispatch custom DOM events; `page.js` listens and re-runs `buildLiveData` so
screens update without a reload. Events: `fc:add-transaction`, `fc:tx-saved`,
`fc:account-saved`, `fc:card-saved`, `fc:goal-saved`, `fc:budget-saved`,
`fc:recurring-saved`, `fc:holdings-changed`, plus the `fc:edit-*` openers.

## Two builds

Production lives in `C:\Users\mtx\desktop\Finance` (port 8765, starts empty). This demo
twin at `C:\Users\mtx\desktop\Finance-demo` (port 8766, auto-seeds mock data) mirrors
`webapp/` and `docs/`. Keep shared changes in sync; see `docs/demo-vs-production.md`.

## Diagrams

Keep architecture diagrams under `docs/diagrams/` (context, runtime, data) in both `.mmd`
and `.drawio` form, and the end-to-end flow list in `docs/architecture-fluxes.md`. Method
reference: `C:\Users\mtx\Desktop\md\HOWTO-flux-diagrams-mermaid-to-drawio.md`. Update them
when a structural change makes them stale.
