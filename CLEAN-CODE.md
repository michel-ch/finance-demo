# CLEAN-CODE.md

Focused split of `AGENTS.md`. Finch is plain JavaScript + JSX with no bundler, no
TypeScript, and no configured linter or formatter, so style and quality are enforced by
review, not tooling. Match the existing in-file style and review your own diff before
finishing.

This is the **demo twin** of Finch. See `docs/demo-vs-production.md` for the full
production-vs-demo diff.

## Clean code

- **Clarity over cleverness.** Optimize for the next reader; obvious beats clever.
- **Name things well.** Intention-revealing names; no cryptic abbreviations or one-letter
  names outside tight loops.
- **Small, focused units.** Each function does one thing. Prefer early returns and guard
  clauses over deep nesting.
- **Don't repeat yourself, but don't over-abstract.** Extract a helper only when
  duplication is real and stable.
- **No magic values.** Name unexplained numbers and strings (forecast horizon days,
  `fc.data.*` storage-key prefixes, event names).
- **Handle errors explicitly.** Do not swallow exceptions or ignore failure paths.
  `getFxRate` already warns on its 1:1 fallback - preserve that kind of signalling rather
  than failing silently.
- **Leave no dead weight.** No unused variables or imports, no stray `console.log`, no
  commented-out code, no context-free `TODO`.
- **Comment the why, not the what.** Explain non-obvious decisions (local-midnight date
  handling, transfer exclusion in `recompute`, month-end clamping) and keep comments
  accurate after edits.

## Project-specific standards

- **Idiomatic JS/React, no new patterns.** Components register on `window.FC.*` via IIFEs
  and are consumed globally. Keep that pattern - do not add ES module `import`/`export`, a
  bundler, a transpile step, or a `package.json` for the app. The no-build constraint is a
  feature.
- **Go through the APIs.** Read and write data via `FCStore`; do not touch `localStorage`
  directly when a method exists. Auth goes through `FCAuth`. Trigger screen refreshes by
  dispatching the existing `fc:*` events, not by mutating React state across pages.
- **No linter/formatter to lean on.** There is no ESLint/Prettier/`.editorconfig` config
  in the repo. Do not introduce one unless explicitly asked, and do not reformat unrelated
  code. Consistency is manual: match neighboring code exactly.
- **Keep `serve.py` clean.** The one Python file (`webapp/serve.py`) should stay PEP 8
  tidy.

## Stay in scope

- Keep changes to what the task requires; no drive-by refactors unless asked.
- When your change orphans an import, variable, or helper, remove it. Do not delete
  pre-existing dead code unless asked - mention it instead.
- Respect module boundaries: screens, data (`FCStore`), and auth (`FCAuth`) are separate
  concerns. Ask if you are unsure where a change belongs.
- Keep the production and `Finance-demo` builds in sync for shared `webapp/` and `docs/`
  source (see `docs/demo-vs-production.md`).

## Security and dependencies

- **No network calls.** The app is fully offline; do not add `fetch`/XHR/WebSocket or any
  remote dependency.
- **No hardcoded secrets.** There is no server or API key; do not introduce one. Use
  obvious placeholders in doc samples.
- **Validate at the boundaries.** Treat imported CSV and form input as untrusted; validate
  and bound it before it reaches `FCStore`.
- **Protect auth.** PINs are hashed in `auth.js` (SHA-256, legacy djb2 fallback). Never log
  raw PINs, passwords, or session contents, and do not weaken the `requireSession` /
  idle-lock guard to make something work.
- **Prefer what exists.** Solve problems with the existing globals and the browser standard
  library; the app has no runtime dependencies to add.

## Before finishing

There is no format/lint/type-check command - do not invent one. Re-read your diff against
neighboring code for consistency, then run the relevant tests. This demo build has no test
suite of its own; the shared harness lives in the sibling production repo
(`C:\Users\mtx\desktop\Finance\tests`) and drives this build via the `demo-seed` project
(see `TESTING.md`).
