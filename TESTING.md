# TESTING.md

Focused split of `AGENTS.md`. The full suite reference is `docs/testing.md`. Read that
for detail; this is the agent-facing summary.

This is the **demo twin** of Finch. It has **no local test harness**. The shared
Playwright + `node:test` suite lives in the sibling production repo
(`C:\Users\mtx\desktop\Finance\tests`) and exercises this build via the demo project
(port 8766). To verify a demo change, run the relevant project from the production repo's
`tests/` dir (e.g. `npx playwright test --project=demo-seed`).

## Layers

Two layers live under the production repo's `tests/`:

1. **Unit** (`tests/unit/`) - fast, browser-free `node --test` coverage of the pure money
   engine in `webapp/store.js`. The harness loads `store.js` in a `node:vm` sandbox with a
   stubbed `localStorage` and a pinnable clock for deterministic date math.
2. **Functional / E2E** - Playwright specs driving the real app in Chromium. One
   consolidated `tests/playwright.config.mjs` runs each spec as a named **project** and
   auto-starts both static servers (prod `127.0.0.1:8765`, demo `127.0.0.1:8766`),
   reusing any already running. Demo projects need this `Finance-demo` checkout.

Suite size: ~220 functional tests + ~21 unit tests.

## Commands

Run from `C:\Users\mtx\desktop\Finance\tests` (these are the real scripts in
`tests/package.json` - do not invent others):

```
npm run test:unit     # node --test "unit/*.test.mjs"   (no browser, no server)
npm test              # playwright test                  (whole functional suite)
npm run test:all      # unit + playwright test
```

Per-suite convenience scripts: `test:auth-nav`, `test:qa-auth`, `test:qa-settings`,
`test:crud`, `test:width`, `test:mobile`, `test:visual`. Any spec can be run directly as a
project: `npx playwright test --project=<name>` (e.g. `qa-pages-1`, `qa-pages-2`,
`qa-pages-3`, `seed-verify`, `demo-seed`, `empty-prod`, `smoke-verify`, `crud-flows`).
The `demo-seed` project is the one that exercises this demo build.

E2E prereq: Chromium installed once via `npx playwright install chromium`.

There is **no format, lint, or type-check step** in this project - do not add one.

## Choosing the layer

| Change | Test |
|---|---|
| Money engine (`store.js`): FX, forecast, addMonths, recompute, tickRecurring | Unit: `tests/unit/store-engine.test.mjs` |
| A fixed bug | Regression test - red before the fix, green after |
| User flow (add/edit, import, onboarding, settings) | Playwright project mirroring the existing suites |
| A screen that can render-crash | Spec importing `test`/`expect` from `./no-page-errors.mjs`; add new page ids to the `PAGES` array in `smoke-verify.spec.mjs` |
| Seed / production-vs-demo behavior | `seed-verify` and `demo-seed` projects |
| Layout / overflow | `width-check` project |
| Mobile-specific behavior | `mobile-flows` project |

## Rules

- Every behavior change gets a test; every bug fix gets a regression test written red
  first. Reproduce before you fix.
- Test observable behavior (persisted values, what renders, projection shape), not private
  internals.
- Keep tests deterministic: use the unit harness's pinned clock for date math; do not rely
  on wall-clock time or run order.
- An uncaught page error fails the test via the `no-page-errors.mjs` fixture (Babel
  transform noise is ignored). This is the guard against render-crash regressions.
- Add a new spec as a `project` entry in `tests/playwright.config.mjs`. Use Playwright for
  flows and `node --test` for the engine; do not introduce another framework.
- Do not weaken, skip, or delete an existing test to go green. Do not leave `skip` /
  `only` / commented-out tests behind.

## Before finishing

This demo build has no tests of its own. From the production repo's `tests/` dir, run
`npm run test:unit` after any `store.js` change (fastest regression gate), and `npm test`
(or the relevant project) for behavior changes. If you changed shared `webapp/` source,
mirror it into the production build and re-run `seed-verify` / `demo-seed`.
