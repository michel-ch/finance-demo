# AGENTS.md

Guidance for coding agents working in the Finch repository. Read this first, then look
at the real directory tree before editing anything. This is a standard format read by
most coding agents. Focused splits of this file exist as `ARCHITECTURE.md`, `TESTING.md`,
and `CLEAN-CODE.md`; this file is the complete, self-contained version.

This is the **demo twin** of Finch (the presentation build). It mirrors the production
app's source so you can browse, screenshot, and demo it with seeded sample data. For the
full production-vs-demo diff, see `docs/demo-vs-production.md`.

Finch is a static, no-build, offline personal-finance app. It is plain HTML + JSX with
React loaded from a CDN and JSX transpiled in the browser. There is no server, no
bundler, and no network access at runtime. Do not describe or add a backend.

## Project facts

- **Language / runtime:** Vanilla JavaScript + JSX. JSX is transpiled in the browser by
  Babel-standalone (no compile step). No Node runtime for the app itself.
- **Framework:** React + ReactDOM loaded as UMD bundles from a CDN. No JSX build, no SPA
  router. Each route is its own static `.html` page that mounts the same React shell with
  a different active screen.
- **Package manager:** None for the app. The app itself ships no `package.json` and needs
  no `npm install`.
- **Run locally:** `start.bat` from the repo root serves `webapp/` on
  `http://localhost:8766` (the static server binds `127.0.0.1`). Equivalent manual
  command: `py -3 webapp/serve.py 8766` (run from `webapp/`). The production build runs on
  `8765`. Stop the server with `down.bat`.
- **Lint:** None configured. There is no ESLint/Biome/Prettier config in the repo. Do
  not introduce one unless explicitly asked; match the existing code style by hand.
- **Test:** This demo build has no test suite of its own. The shared Playwright +
  `node:test` harness lives in the sibling production repo
  (`C:\Users\mtx\desktop\Finance\tests`) and exercises this build via the demo project
  (port 8766). To verify a demo change, run the relevant project from the production
  repo's `tests/` dir (e.g. `npx playwright test --project=demo-seed`).
- **Type-check:** None. This is plain JavaScript; there is no TypeScript and no `tsc`.

## Navigation

- **Code is the source of truth.** The `docs/` folder is the developer reference for
  intent, architecture, and decisions. When docs and code disagree, trust the code and
  flag the mismatch.
- **Read the minimum.** Find the smallest set of files that completes the task.
- **Reuse context.** Do not re-open a file you have already read this session unless you
  suspect it changed.
- **Target your searches.** Prefer direct reads when the location is known; fall back to
  a wide search only when you cannot locate something otherwise.

Repo layout:

```
webapp/          the shipped app (HTML pages, JSX components, JS data/auth/store)
  index.html     auth-aware splash that routes to login/pin/home
  login.html signup.html pin.html   auth entry pages
  auth.js store.js data.js          window.FCAuth / window.FCStore / window.FCData
  tokens.css     design tokens (light/dark, accents)
  components/    shared screens + atoms, register on window.FC.*
  desktop/       one HTML per page + page.js bootstrap + modals/overrides
  mobile/        mobile shell (page.js) + 6 tab pages
  serve.py       no-cache static dev server
docs/            architecture, data model, testing docs
export_UI/       design mockups (read-only reference)
screenshots/     captured page screenshots
start.bat down.bat   launch / stop the dev server
```

Architecture docs to read first for a given task:

- `docs/architecture.md` - runtime composition, boot, data flow.
- `docs/data-model.md` - the 14-table schema, cached fields, recompute formulas.
- `docs/architecture-fluxes.md` - the F1..Fn end-to-end flows.
- `docs/diagrams/` - the context/runtime/data flux diagrams.

## Scan vs. open on demand

Keep these out of wide searches; open a specific file only when the task needs it.

- **Generated / minified:** anything pulled from a CDN at runtime (React, Babel) is not
  in the repo; do not look for it locally.
- **Binary & media:** images under `screenshots/` and `export_UI/`, fonts, archives.

## Architecture diagram (Mermaid -> draw.io)

When asked to document or map the architecture (or when a structural change makes an
existing diagram stale), diagram the system as it actually is in the code. Read the entry
points (`webapp/desktop/page.js`, `webapp/mobile/page.js`), the screen registry on
`window.FC.*`, the data API in `webapp/store.js`, and the auth API in `webapp/auth.js`.

This project keeps its diagrams under `docs/diagrams/` and a master flux list at
`docs/architecture-fluxes.md` (the F1..Fn end-to-end flows). When these exist, update
them rather than starting new ones; keep both the `.mmd` and `.drawio` forms in sync.

- **Program structure** - the two shells (desktop, mobile), the `window.FC` screen
  registry, and the three global APIs (`FCStore`, `FCAuth`, `FCData`) with dependency
  direction.
- **Datastore** - `localStorage`, per-profile namespaced as `fc.data.{profileId}.{table}`
  across the 14 tables, plus the global auth keys. Use a separate `erDiagram` for the
  table schema.
- **External boundaries** - there are NONE. No APIs, no third-party services, no queues,
  no schedulers. Verified: zero `fetch`/XHR/axios/WebSocket calls anywhere. Do not draw a
  network edge.
- **Security boundaries** - the auth guard (`requireSession` in `page.js`, routing to
  `login.html` / `pin.html`), PIN hashing in `auth.js` (SHA-256 with a legacy djb2
  fallback), and the per-profile `localStorage` namespace as the data trust boundary.

How to produce it:

1. Write Mermaid first - `flowchart`/`graph` for the system view, `erDiagram` for the
   14-table schema. Group with `subgraph`s; label edges with the action (renders,
   dispatches `fc:tx-saved`, reads `fc.data.*`).
2. Save the diagram sources under `docs/diagrams/` (e.g. `architecture-context.mmd`,
   `architecture-runtime.mmd`, `architecture-data.mmd`).
3. Convert each to draw.io and save the `.drawio` alongside the `.mmd`. If a converter is
   available, use it; otherwise write valid `<mxfile>`/`<mxGraphModel>` XML mirroring the
   Mermaid (one `mxCell` per node and per edge).
4. Verify: the Mermaid must parse and the draw.io XML must be well-formed.
5. Keep them in sync with reality and with `docs/architecture-fluxes.md`.

The step-by-step method (Mermaid authoring, conversion, verification) is documented in
`C:\Users\mtx\Desktop\md\HOWTO-flux-diagrams-mermaid-to-drawio.md` - follow it.

## How Finch is put together

Two shells over the same source tree:

- **Desktop** - `webapp/desktop/page.js` boots; sidebar navigation; a `screenMap` of 15
  keys: `home`, `forecast`, `transactions`, `goals`, `accounts`, `budgets`, `recurring`,
  `investments`, `networth`, `cards`, `import`, `simulator`, `profiles`, `onboarding`,
  `settings`.
- **Mobile** - `webapp/mobile/page.js` boots; 6 bottom tabs: `home`, `transactions`,
  `forecast`, `goals`, `add`, `more`.

Globals on `window`:

- `window.FC.*` - screens and helpers, registered by the JSX IIFEs in
  `components/*.jsx` and `desktop/*.jsx`.
- `window.FCStore` (`webapp/store.js`) - the `localStorage` data API and money engine.
- `window.FCAuth` (`webapp/auth.js`) - profiles, session, PIN (SHA-256, legacy djb2
  fallback).
- `window.FCData` (`webapp/data.js`) - the mock seed.

Persistence is `localStorage`, per-profile namespaced as `fc.data.{profileId}.{table}`.
Global auth keys: `fc.profiles.v1`, `fc.session.v1`, `fc.pinLocked.v1`. The 14 tables:
`accounts`, `cards`, `transactions`, `categories`, `tags`, `recurring`, `goals`,
`budgets`, `holdings`, `dcaPlans`, `importStaging`, `importTemplates`, `priceCache`,
`fxCache`.

Money engine in `store.js`:

- `getFxRate(from, to)` - direct rate, then inverse, then EUR triangulation, then a 1:1
  fallback with a warning.
- `buildForecast({days, accountIds, baseCurrency})` -> `{history, projection:[{d,date,v}],
  events:[{date,t,n,a}]}`.
- `addMonths` - advances by month with month-end clamping.
- `parseLocalDate` / `ymdLocal` - local-midnight date handling (avoid UTC drift).
- `recompute` - re-derives `account.balance`, `goal.current`, `budget.spent`, and
  `card.cycleSpend` from transactions; skips transfer rows.
- `tickRecurring` - rolls each recurring rule's `nextDate` forward. A rule's `direction`
  field is `'in'` for income, otherwise it is an outflow.

Boot order in `page.js`: `requireSession` guard (routes to `login.html`, or `pin.html`
when idle-locked) -> `loadOpts` (theme/accent) -> `seedIfEmpty` + `seedFxIfEmpty` ->
`tickRecurring` -> `buildLiveData(profile)` -> render the active screen.

Refresh-on-save uses custom DOM events: `fc:add-transaction`, `fc:tx-saved`,
`fc:account-saved`, `fc:card-saved`, `fc:goal-saved`, `fc:budget-saved`,
`fc:recurring-saved`, `fc:holdings-changed`, and the `fc:edit-*` modal openers. `page.js`
listens and re-runs `buildLiveData` so screens update without a reload. Cross-page
navigation is real: `onNav(id)` sets `location.href = id + '.html'`.

Deeper references: `docs/architecture.md` (runtime composition, boot, data flow),
`docs/data-model.md` (the 14-table schema, cached fields, recompute formulas),
`docs/diagrams/` and `docs/architecture-fluxes.md` (visual flux maps). See also
`ARCHITECTURE.md` for the condensed agent-facing view.

## Conventions

- **Stay in scope.** Keep changes to what the task requires. No drive-by refactors unless
  asked.
- **Respect the structure.** Screens register on `window.FC.*`; data goes through
  `FCStore`; auth goes through `FCAuth`. Do not reach into `localStorage` directly when an
  API method exists, and do not add direct DOM data flow that bypasses the `fc:*` events.
- **Match local style.** Follow the patterns, naming, and JSX idioms already in the file
  you are editing. There is no linter to normalize style, so consistency is manual.
- **Keep the no-build constraint.** Do not add a bundler, a transpile step, ES module
  `import`/`export`, or a `package.json` for the app. Components are registered on
  `window.FC` by IIFEs and consumed globally; keep that pattern.
- **Keep the two builds in sync.** This demo build mirrors the production build at
  `C:\Users\mtx\desktop\Finance`. Changes that affect shared source should be applied to
  both; see `docs/demo-vs-production.md`. The demo runs on port 8766 and auto-seeds mock
  data; production starts empty.

## Code quality

Write clean, idiomatic code an experienced JavaScript/React developer would approve in
review. Code that merely works is not done; it must be readable, consistent, and
conventional. See `CLEAN-CODE.md` for the focused version.

### Clean code

- **Clarity over cleverness.** Optimize for the next reader.
- **Name things well.** Intention-revealing names; no cryptic abbreviations.
- **Small, focused units.** Each function does one thing; prefer early returns over deep
  nesting.
- **Don't repeat yourself, but don't over-abstract.** Extract a helper only when
  duplication is real and stable.
- **No magic values.** Name unexplained numbers and strings (e.g. forecast horizon days,
  storage-key prefixes).
- **Handle errors explicitly.** Do not swallow exceptions. The money engine already
  signals fallback (the `getFxRate` 1:1 warning); preserve that signalling.
- **Leave no dead weight.** No unused variables, no stray `console.log`, no
  commented-out code, no context-free `TODO`.
- **Comment the why, not the what.** Explain trade-offs and non-obvious decisions (date
  clamping, transfer exclusion in recompute) and keep comments accurate after edits.

### Language standards

- Follow idiomatic JavaScript and React. Honor the existing in-file style; there is no
  repo formatter or linter config, so do not reformat unrelated code and do not invent a
  tooling step. (`webapp/serve.py` is the one Python file - keep it PEP 8 clean.)
- Because there is no automated style check, review your own diff against neighboring code
  before finishing.

## Dependencies & security

- **Prefer what's already there.** Solve problems with the existing globals (`FCStore`,
  `FCAuth`, helpers on `window.FC`) and the browser standard library. The app has no
  runtime dependencies to add.
- **Never hardcode secrets.** There is no server and no API key in this app; do not
  introduce one. Use obvious placeholders in any doc samples.
- **No network calls.** The app is fully offline. Do not add `fetch`/XHR/WebSocket or any
  remote dependency; doing so breaks the core offline guarantee.
- **Validate at the boundaries.** Treat imported CSV content and user form input as
  untrusted: validate and bound it in the import flow and the CRUD modals before it
  reaches `FCStore`.
- **Respect auth.** PINs are hashed in `auth.js` (SHA-256 with a legacy djb2 fallback);
  do not log raw PINs, passwords, or session contents, and do not weaken the
  `requireSession` / idle-lock guard to make something work.

## Testing

Add or update tests for every change that affects behavior. This demo build has no test
suite of its own; the shared harness lives in the sibling production repo
(`C:\Users\mtx\desktop\Finance\tests`) and exercises this build via the demo project
(port 8766). See `TESTING.md` for the focused version.

### Core rules

- **Every bug fix gets a regression test.** Write it red first (fails on the broken
  code), then green. Engine tests go in the production repo's
  `tests/unit/store-engine.test.mjs`; render-crash specs import `test`/`expect` from the
  production repo's `tests/no-page-errors.mjs` so an uncaught page error fails the test.
- **Reproduce before you fix.** Write the failing test before the fix.
- **New behavior ships with tests** covering the happy path, edge cases, and failure
  paths.
- **Test behavior, not implementation.** Assert observable output: persisted values, what
  renders, the projection shape - not private internals.
- **Match the existing setup.** Use Playwright for flows and `node --test` for the engine.
  Do not introduce another framework. Add a new spec as a `project` entry in the
  production repo's `tests/playwright.config.mjs`.
- **Keep tests deterministic.** The unit harness pins the clock; reuse it for date math.
  Do not rely on wall-clock time or run order.

### Which tests, by what you touched

| If the code is... | Write... |
|---|---|
| Money-engine logic in `store.js` (FX, forecast, addMonths, recompute, tickRecurring) | **Unit tests** in `tests/unit/store-engine.test.mjs` via the `node:vm` harness |
| A fixed bug | **Regression test** - red before, green after |
| A user-facing flow (add/edit, import, onboarding, settings) | **End-to-end Playwright** spec/project mirroring the existing suites |
| A screen that could render-crash | A spec that imports from `./no-page-errors.mjs`; add new page ids to the `PAGES` array in `smoke-verify.spec.mjs` |
| Seed / production-vs-demo behavior | `seed-verify` and `demo-seed` projects |
| Layout / overflow | `width-check` project (desktop fill + mobile overflow) |
| Mobile-specific behavior | `mobile-flows` project |

### Don't

- Don't weaken, delete, or skip an existing test to make the suite pass; fix the cause, or
  update the test and say why if behavior intentionally changed.
- Don't write tests that cannot fail.
- Don't leave `skip` / `only` / commented-out tests behind.
- Don't test React or the browser; test Finch's own code.

## Before finishing

This demo build has no test suite of its own. Run the project's real checks from the
sibling production repo (`C:\Users\mtx\desktop\Finance\tests`) and fix any failures:

```
npm run test:unit     # engine unit tests (fast; no browser, no server)
npm test              # whole functional suite (Playwright auto-starts both servers)
```

Or `npm run test:all` for both layers at once. For a demo change, run the relevant demo
project (e.g. `npx playwright test --project=demo-seed`).

There is **no format, lint, or type-check step in this project** - do not invent one. For
docs-only changes, no Playwright run is needed; do link/path checks instead.

If you changed behavior, confirm the suite includes a test that covers it and that the
test fails without your change and passes with it. If you changed shared `webapp/` or
`docs/` source, mirror the change into the production build.
