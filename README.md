# Finch

Local-first personal finance cockpit. Multi-account, multi-currency, with
forecasting, budgets, goals, recurring rules, investments, and a privacy-blur
toggle. **No build step, no backend** — JSX is transformed in the browser via
Babel-standalone, and all data lives in `localStorage`, namespaced per profile.

<p align="center">
  <img src="screenshots/desktop/01-home.png" alt="Finch home dashboard" width="900">
</p>

## Quick start

```bat
start.bat   :: launches the dev server on http://localhost:8765/
down.bat    :: stops whatever is listening on 8765 (production) / 8766 (demo)
```

Requirements: **Python 3** (already present on most Windows installs as `py` or
`python`). If Python is missing, `start.bat` falls back to `npx http-server`.

See [`docs/getting-started.md`](docs/getting-started.md) for the full setup,
first-launch flow, keyboard shortcuts, and reset paths.

## Two builds

Finch ships in two parallel folders that share 99% of the source:

| Build      | Folder         | Port | First-run state                          |
|------------|----------------|------|------------------------------------------|
| Production | `Finance/`     | 8765 | Empty (just 12 default categories)       |
| Demo       | `Finance-demo/`| 8766 | Auto-seeded mock (5 accounts, 13 tx, …)  |

The demo build shows a **DEMO** chip in the sidebar so you always know which one
you're in. They run side by side on different origins, so each has its own
isolated `localStorage`. See [`docs/demo-vs-production.md`](docs/demo-vs-production.md)
for the full diff and how to keep them in sync.

## Architecture

Three "flux" views of the runtime, each a filtered slice of one master flux
table. Component ids and flux ids (`F1..F21`) are stable across all views. Finch
is **offline and local-only**: there is no backend and no network flux. The
diagrams below render inline on GitHub; the editable draw.io sources and the
full flux descriptions are linked under each view.

Master flux list and glossary: [`docs/architecture-fluxes.md`](docs/architecture-fluxes.md).

### Context (L0)

The big picture: the User reaches the Browser Runtime, which drives the App
Logic (auth + store + money engine), which reads and writes Local Storage.
Nothing crosses the External / Network boundary.

```mermaid
flowchart TD
  user([User])

  subgraph P1[P1 Browser Runtime]
    direction TB
    runtime[Pages + Shell + Screens]
  end

  subgraph P2[P2 App Logic]
    direction TB
    logic[FCAuth + FCStore + Money Engine]
  end

  subgraph P3[P3 Local Storage]
    direction TB
    storage[(localStorage tables)]
  end

  subgraph PX[External / Network]
    direction TB
    none[No network - fully offline]
  end

  user -->|F1 load + session guard| runtime
  runtime -->|F10 build live snapshot| logic
  runtime -->|F12/F13 CRUD save| logic
  logic -.->|F10 read tables| storage
  logic -.->|F12/F13 persist| storage
  runtime -->|F19 restore backup| logic
  logic -.->|F19 replace all| storage
  runtime -. no calls .- none

  classDef p1 fill:#FFE6CC,stroke:#D79B00,color:#000;
  classDef p2 fill:#DAE8FC,stroke:#6C8EBF,color:#000;
  classDef p3 fill:#D5E8D4,stroke:#82B366,color:#000;
  classDef px fill:#F5F5F5,stroke:#999999,color:#000;
  class runtime p1;
  class logic p2;
  class storage p3;
  class none px;
```

*Context (L0): top-level fluxes F1, F10, F12/F13, F19.
Source: [architecture-context.drawio](docs/diagrams/architecture-context.drawio) -
[flux descriptions](docs/architecture-fluxes.md).*

### Runtime + Auth

The request, authentication, render, and save path: page load and session guard,
signup/login/PIN, idle auto-lock, screen render, transaction and entry saves,
cross-page navigation, and settings changes.

```mermaid
flowchart TD
  user([User])

  subgraph P1[P1 Browser Runtime]
    direction TB
    login[login.html]
    signup[signup.html]
    pin[pin.html]
    dpage[desktop/page.js boot + router]
    mpage[mobile/page.js boot]
    shell[DesktopShell / MobileTabs]
    screens[React screens on window.FC]
    modals[Add / CRUD / Holding / BulkDelete modals]
  end

  subgraph P2[P2 App Logic]
    direction TB
    auth[window.FCAuth]
    store[window.FCStore]
    engine_recompute[recompute]
  end

  subgraph P3[P3 Local Storage]
    direction TB
    ls_auth[(fc.profiles / session / pinLocked)]
    ls_data[(fc.data.profileId.table)]
  end

  user -->|F1 load + guard| dpage
  user -->|F1 load + guard| mpage
  dpage -->|F1 requireSession| auth
  mpage -->|F1 requireSession| auth
  signup -->|F2 signup hash| auth
  auth -->|F2 write profile| ls_auth
  login -->|F3 login verify| auth
  auth -->|F3 write session| ls_auth
  screens -->|F4 set/verify PIN| auth
  auth -->|F4 PIN store| ls_auth
  pin -->|F5 unlock gate| auth
  dpage -->|F6 idle auto-lock| auth
  dpage -->|F10 build snapshot| store
  dpage -->|F11 mount screen| shell
  shell -->|F11 render| screens
  modals -->|F12 save tx| store
  modals -->|F13 CRUD save| store
  store -->|F12/F13 recompute| engine_recompute
  screens -->|F14 bulk delete| store
  shell -->|F20 cross-page nav| dpage
  screens -->|F21 settings change| auth
  auth -->|F21 updateProfile| ls_auth
  store -.->|F10 read tables| ls_data

  classDef p1 fill:#FFE6CC,stroke:#D79B00,color:#000;
  classDef p2 fill:#DAE8FC,stroke:#6C8EBF,color:#000;
  classDef p3 fill:#D5E8D4,stroke:#82B366,color:#000;
  class login,signup,pin,dpage,mpage,shell,screens,modals p1;
  class auth,store,engine_recompute p2;
  class ls_auth,ls_data p3;
```

*Runtime + Auth: F1-F6, F10-F14, F20, F21.
Source: [architecture-runtime.drawio](docs/diagrams/architecture-runtime.drawio) -
[flux descriptions](docs/architecture-fluxes.md).*

### Data / Storage

The persistence and money-engine view: seeding, recurring tick, snapshot build,
CRUD persistence, forecast, FX conversion, import/export, and restore - plus the
engine functions and the per-profile localStorage tables.

```mermaid
flowchart TD
  subgraph P1[P1 Browser Runtime]
    direction TB
    dpage[desktop/page.js boot + router]
    screens[React screens on window.FC]
    modals[Add / CRUD / Holding / BulkDelete modals]
  end

  subgraph P2[P2 App Logic]
    direction TB
    store[window.FCStore]
    engine_fx[getFxRate]
    engine_forecast[buildForecast]
    engine_recompute[recompute]
    engine_recurring[tickRecurring]
  end

  subgraph P3[P3 Local Storage]
    direction TB
    ls_data[(fc.data.profileId.table - 14 tables)]
  end

  dpage -.->|F7 seedIfEmpty| store
  dpage -.->|F8 seedFxIfEmpty| store
  dpage -.->|F9 tick recurring| engine_recurring
  dpage -.->|F10 build snapshot| store
  store -.->|F10 list tables| ls_data
  store -.->|F10 forecast| engine_forecast
  store -.->|F10 fx| engine_fx
  modals -.->|F12 save tx| store
  modals -.->|F13 CRUD save| store
  store -.->|F12/F13 recompute| engine_recompute
  store -.->|F12/F13 persist| ls_data
  engine_forecast -.->|F15 uses direction + fx| engine_fx
  engine_forecast -.->|F15 projection| store
  engine_fx -.->|F16 rate cache| ls_data
  screens -.->|F17 import CSV| store
  screens -.->|F18 export snapshot| store
  screens -.->|F19 restore backup| store
  store -.->|F19 replace all| ls_data
  engine_recurring -.->|F9 post due| ls_data

  classDef p1 fill:#FFE6CC,stroke:#D79B00,color:#000;
  classDef p2 fill:#DAE8FC,stroke:#6C8EBF,color:#000;
  classDef p3 fill:#D5E8D4,stroke:#82B366,color:#000;
  class dpage,screens,modals p1;
  class store,engine_fx,engine_forecast,engine_recompute,engine_recurring p2;
  class ls_data p3;
```

Key table relationships (companion entity view):

```mermaid
erDiagram
  accounts ||--o{ transactions : "has"
  accounts ||--o{ holdings : "holds"
  accounts ||--o{ recurring : "schedules"
  categories ||--o{ transactions : "tags"
  categories ||--o{ budgets : "limits"
  goals ||--o{ transactions : "funded by"
  transactions }o--|| transactions : "transfer pair"
  fxCache ||--o{ accounts : "converts"

  accounts {
    string id
    string currency
    number balance
  }
  transactions {
    string id
    string accountId
    string categoryId
    string transferId
    number amount
  }
  recurring {
    string id
    string accountId
    string direction
    string nextDate
  }
  goals {
    string id
    number target
    number saved
  }
  budgets {
    string id
    string categoryId
    number cap
  }
  holdings {
    string id
    string accountId
    number units
  }
  fxCache {
    string pair
    number rate
  }
```

*Data / Storage: F7-F10, F12, F13, F15-F19.
Source: [architecture-data.drawio](docs/diagrams/architecture-data.drawio) -
[flux descriptions](docs/architecture-fluxes.md).*

## Layout

```
Finance/
├── README.md              # You are here
├── .gitignore             # Excludes node_modules, test artifacts, Playwright caches
├── start.bat              # Single-command launcher
├── down.bat               # Stops the dev server on 8765 / 8766
├── master-spec.md         # Product source of truth
├── expense-app-plan.md    # Earlier rough plan; superseded by master-spec
├── export_UI/             # Original design mockups (read-only reference)
├── screenshots/           # Visual gallery — every page, desktop and mobile
├── docs/                  # Developer reference — start at docs/README.md
├── tests/                 # Playwright suites
└── webapp/                # The shipped app
    ├── index.html         # Auth-aware splash that routes
    ├── auth.js            # Profile + session API (FCAuth)
    ├── store.js           # Per-profile data API (FCStore)
    ├── tokens.css         # Design tokens, light + dark, accents
    ├── components/        # Shared React components — atoms, screens, shells
    ├── desktop/           # Desktop pages + modal overrides
    ├── mobile/            # Mobile pages + bottom tab bar + FAB
    └── serve.py           # Dev server: http.server with no-cache headers
```

## Screens

### Accounts — multi-currency tiles, 30-day sparkline, type filter chips

<p align="center">
  <img src="screenshots/desktop/02-accounts.png" alt="Accounts" width="900">
</p>

### Transactions — search, account/category/date/currency filters, bulk select with Recategorize & Tag

<p align="center">
  <img src="screenshots/desktop/04-transactions.png" alt="Transactions" width="900">
</p>

### Forecast — projection chart, per-account toggles, and an inline "what if I bought this?" simulator

<p align="center">
  <img src="screenshots/desktop/05-forecast.png" alt="Forecast" width="900">
</p>

### Goals — progress rings, off-track flagging, and clickable suggestions that actually mutate the goal

<p align="center">
  <img src="screenshots/desktop/07-goals.png" alt="Goals" width="900">
</p>

### Budgets — monthly envelopes with prev/next month, reset to zero, hard-cap badges

<p align="center">
  <img src="screenshots/desktop/08-budgets.png" alt="Budgets" width="900">
</p>

### "Can I afford?" simulator — verdict, goal impact, save scenarios, add as planned tx

<p align="center">
  <img src="screenshots/desktop/06-simulator.png" alt="Simulator" width="900">
</p>

### Mobile — bottom-tab nav, themed thin scrollbar, working full-page Add screen

<p align="center">
  <img src="screenshots/mobile/01-home.png" alt="Mobile home" width="220">
  &nbsp;
  <img src="screenshots/mobile/02-transactions.png" alt="Mobile activity" width="220">
  &nbsp;
  <img src="screenshots/mobile/04-goals.png" alt="Mobile goals" width="220">
  &nbsp;
  <img src="screenshots/mobile/06-add.png" alt="Mobile add transaction" width="220">
</p>

The full gallery — 13 desktop pages, 6 mobile pages, 4 auth/onboarding screens —
lives in [`screenshots/`](screenshots/README.md), all captured against the demo
data seed.

## Documentation

The complete developer reference lives in [`docs/`](docs/README.md):

| File | What's in it |
|---|---|
| [`docs/getting-started.md`](docs/getting-started.md) | Run the app, requirements, reset paths, keyboard shortcuts |
| [`docs/architecture.md`](docs/architecture.md) | Directory layout, runtime composition, page bootstrap |
| [`docs/auth.md`](docs/auth.md) | Profiles, login/signup/PIN, session lifecycle |
| [`docs/data-model.md`](docs/data-model.md) | The schema in `store.js`, seed behavior, cached fields |
| [`docs/components.md`](docs/components.md) | Atoms, screens, modals — what they expect |
| [`docs/adding-a-page.md`](docs/adding-a-page.md) | Recipe for landing a new desktop or mobile page |
| [`docs/testing.md`](docs/testing.md) | Playwright suites — how to run, what they cover |
| [`docs/demo-vs-production.md`](docs/demo-vs-production.md) | The two builds and how to maintain both |
| [`docs/roadmap.md`](docs/roadmap.md) | What's in v1, what's deferred, open questions |

## Tech choices, briefly

- **Why no build step?** Trades a one-time ~250 ms Babel parse for zero
  toolchain — no `npm install`, no TypeScript compile. `start.bat` works on a
  fresh Windows install with just Python. Replacing Babel-standalone with a Vite
  build is a 1-day refactor when needed.
- **Why static HTML pages?** Each "page" is a real `.html` file that loads the
  same React shell with a different active screen. Browser back/forward and
  bookmarks work; each reload re-runs the auth guard. No SPA router needed.
- **Why `localStorage`?** Local-first; the user runs the app locally, not from a
  CDN. The schema is multi-user-ready (every row has `profileId` + `householdId`)
  but the v1 UX is single-profile.

## License

Personal project; no license declared.
