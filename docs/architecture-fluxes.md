# Architecture Fluxes (master list)

This file is the single source of truth for Finch's architecture "flux" diagrams.
Every diagram under `docs/diagrams/` is a filtered view of the tables below. The
component ids and the `F#` flux ids are stable and identical across every view --
never renumber per diagram.

Finch is an **offline, local-only** static React app: HTML pages plus
Babel-in-the-browser, with all state in `localStorage`. There is **no backend,
no network, and no external integration**. There is therefore **no network
flux** in this model -- this is deliberate, not an omission.

## Perimeters

| id | Perimeter | What lives here |
|----|-----------|-----------------|
| P1 | Browser Runtime | HTML pages, boot scripts, the React shell + screens + modals |
| P2 | App Logic | `window.FCStore` engine (FX, forecast, recompute, recurring), `window.FCAuth`, mock seed |
| P3 | Local Storage | `localStorage` tables (auth keys + the 14 per-profile data tables) |
| -- | External / Network | None. Fully offline. No flux crosses this boundary. |

## Components

| id | Name | Perimeter |
|----|------|-----------|
| user | User | Browser Runtime |
| dpages | Desktop HTML pages | Browser Runtime |
| mpages | Mobile HTML pages | Browser Runtime |
| login | login.html | Browser Runtime |
| signup | signup.html | Browser Runtime |
| pin | pin.html | Browser Runtime |
| dpage | desktop/page.js (boot + router) | Browser Runtime |
| mpage | mobile/page.js (boot) | Browser Runtime |
| shell | DesktopShell / MobileTabs | Browser Runtime |
| screens | React screens on window.FC | Browser Runtime |
| modals | Add / CRUD / Holding / BulkDelete modals | Browser Runtime |
| auth | window.FCAuth | App Logic |
| store | window.FCStore | App Logic |
| engine_fx | getFxRate | App Logic |
| engine_forecast | buildForecast | App Logic |
| engine_recompute | recompute | App Logic |
| engine_recurring | tickRecurring | App Logic |
| data | window.FCData (mock seed) | App Logic |
| ls_auth | fc.profiles / session / pinLocked keys | Local Storage |
| ls_data | fc.data.{profileId}.{table} (14 tables) | Local Storage |
| none | No network / fully offline | External |

## Fluxes (F1..F21)

Solid edges = runtime / auth (the request and authentication path). Dotted edges
= data / ops (persistence, money engine, import/export). Categories: `runtime`,
`auth`, `data`.

| F# | Name | Category | Trigger | Source -> ... -> Target | Mechanism | Evidence |
|----|------|----------|---------|-------------------------|-----------|----------|
| F1 | Page load + session guard | runtime | Page open | user -> dpage/mpage -> auth.requireSession (redirect login/pin if needed) | requireSession gate | dpage:14-15, mpage:14-15 |
| F2 | Signup | auth | Submit signup form | signup -> auth.signup -> ls_auth -> login -> home | SHA-256 password hash | auth.js:62-94 |
| F3 | Login | auth | Submit login form | login -> auth.login -> ls_auth(session) -> first route | verify hash, write session | auth.js:97-118 |
| F4 | PIN set / verify | auth | Settings PIN action | settings -> auth.setPin/verifyPin -> ls_auth | PIN hash store/verify | auth.js:147-173 |
| F5 | PIN unlock gate | auth | App locked, PIN entered | pin -> auth.verifyPin -> setPinLocked(false) -> home/onboarding | unlock + clear lock flag | pin.html:47-82 |
| F6 | Idle auto-lock | runtime | Idle timer / tab hidden | timer/visibility -> auth.setPinLocked(true) -> pin.html | set lock flag, redirect | dpage:96-129 |
| F7 | Seed-if-empty | data | First boot | dpage -> store.seedIfEmpty -> ls_data(categories) | seed default categories | store.js:286-291 |
| F8 | Seed FX | data | First boot | dpage -> store.seedFxIfEmpty -> ls_data(fxCache) | seed FX cache | store.js:359-369 |
| F9 | Tick recurring on boot | data | Boot | dpage -> tickRecurring -> ls_data(recurring) | post due recurring rules | store.js:488-513 |
| F10 | Build live snapshot | data | Boot / after save | dpage -> buildLiveData -> store.list(tables) + engine_forecast + engine_fx -> screens | assemble view model | dpage:30-79 |
| F11 | Screen render | runtime | After snapshot | dpage -> window.FC[screenMap] -> shell + screen mounts with data prop | React mount | dpage:176-184 |
| F12 | Add / edit transaction | data | Save tx modal | modals -> store.create/update('transactions') -> engine_recompute -> ls_data -> fc:tx-saved -> refresh | write + recompute + event | add-transaction.jsx; store.js:148-259 |
| F13 | CRUD entity save | data | Save entity modal | modals -> store.create/update -> engine_recompute -> ls_data -> fc:*-saved -> refresh | account/card/goal/budget/recurring/holding | crud-modals.jsx, holding-form.jsx |
| F14 | Bulk delete tx | data | Bulk delete action | screens -> store.remove(many) -> engine_recompute -> ls_data | mass remove + recompute | bulk-delete-tx.jsx |
| F15 | Forecast build | data | Snapshot build | engine_forecast (uses recurring direction + engine_fx) -> projection/events | projection math | store.js:410-480 |
| F16 | FX conversion | data | Forecast / snapshot | engine_forecast/buildLiveData -> engine_fx -> ls_data(fxCache) | rate lookup + cache | store.js:377-396 |
| F17 | Import CSV | data | Import screen confirm | screens -> parse -> staging -> store.create('transactions') -> fc:tx-saved | parse + bulk create | import-flow.jsx |
| F18 | Export snapshot | data | Settings export | settings -> store.snapshot -> JSON download | serialize all tables | store.js:262-269 |
| F19 | Restore backup | data | Settings restore | settings -> store.restore -> ls_data(all) -> engine_recompute | replace all + recompute | store.js:271-279 |
| F20 | Cross-page nav | runtime | Nav click | shell.onNav -> location.href id+'.html' | full page navigation | dpage:24-28 |
| F21 | Settings change | runtime | Settings edit | settings -> auth.updateProfile -> ls_auth | base currency / density / theme / accent / idle / privacy | settings-screen.jsx, dpage:193-203 |

## Which fluxes appear in each view

| View (file) | Fluxes shown |
|-------------|--------------|
| Context (architecture-context.mmd) | F1, F10, F12/F13 (as "CRUD"), F19 |
| Runtime + Auth (architecture-runtime.mmd) | F1, F2, F3, F4, F5, F6, F10, F11, F12, F13, F14, F20, F21 |
| Data / Storage (architecture-data.mmd) | F7, F8, F9, F10, F12, F13, F15, F16, F17, F18, F19 |

## Glossary

- **FX** -- foreign-exchange conversion. Balances in non-base currencies are
  converted to the base currency using cached rates (`fxCache`).
- **OIDC** -- not applicable. Finch has no identity provider and no network auth;
  authentication is a local SHA-256 password hash plus an optional PIN.
- **PIN** -- short numeric code that re-locks the app on idle and gates re-entry
  without a full logout.
- **recompute** -- `FCStore.recompute`, which re-derives cached/aggregate fields
  (account balances, totals) after any data mutation.
- **forecast** -- `buildForecast`, a forward projection of balances over time
  built from current data plus due recurring rules, FX-normalized.
- **recurring direction** -- the sign of a recurring rule (income vs expense /
  inflow vs outflow) that the forecast applies when projecting each occurrence.
- **base currency** -- the profile's reporting currency; every amount is shown
  converted to it via FX.
- **fxCache** -- `localStorage` table of exchange rates used by the FX engine so
  conversion stays offline and deterministic.
- **transfer pair** -- a transfer is stored as two linked transaction rows (out
  of one account, into another) so both accounts reconcile.

## Offline note

Finch never makes a network request at runtime. All authentication, money math,
and persistence happen in the browser against `localStorage`. The "External /
Network" perimeter exists only to make that boundary explicit -- no flux ever
crosses it.
