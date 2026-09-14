# ARISE

ARISE is a Windows trading operating system for discretionary-guided, multi-timeframe trading.

This repository is frozen through Milestone 10. Product semantics and the active handoff live in `/docs`; implementation must follow `AGENTS.md`, `docs/CURRENT_MILESTONE.md`, `docs/ASTRA_INSTRUCTIONS.md`, and the canonical specifications.

## Current milestone

**M11 — Not started**

Frozen through M10:

- engineering, domain, persistence, shell, charts, planning, knowledge, and review foundations
- Strategy Encyclopedia and Grasshopper-style Graph
- persistent Strategy Runtime and detector engine
- OBSERVE and SHADOW runtime surfaces
- Decision Trace substrate and non-executing Action Proposals
- immutable EvidenceEvents, exact version references, original raster/hash integrity, and asynchronous capture
- Evidence Board and Drill-Down review surfaces
- read-only local MT5 Agent transport, health, market-data plumbing, broker-reality mirrors, reconciliation, and recovery-safe UNKNOWN states
- external broker-position classification without creating ARISE Positions
- M10 immutable intent/validation/OrderPlan pipeline, SHADOW results, DEMO execution gateway, idempotent Agent commands, fill/partial-fill handling, and initial-protection safety
- eleven Windows Electron E2E workflows

Explicitly not included yet:

- real terminal automation (the shipped read-only Agent reports disconnected until a connector exists)
- real-terminal broker mutation (the shipped MT5 transport remains read-only; DEMO acceptance uses the labeled fake harness)
- advanced breakeven, trailing, Colony-wide protection, and later automation
- live trading

M0–M10 are frozen. See `docs/CURRENT_MILESTONE.md` and `apps/desktop/M10_REPORT.md` for the acceptance record. M11 has not started.

## Commands

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm test
pnpm check
```

## M0 acceptance criteria

1. Desktop app launches.
2. Main process creates/opens the local SQLite database.
3. Migrations/schema initialization succeeds.
4. Renderer can call at least one typed backend IPC method.
5. One domain object can be written/read through a repository.
6. Tests pass.
7. No trading logic exists in React.
8. No MT5 or SQLite specifics leak into `packages/domain`.

## Source of truth

Read in this order:
1. `docs/ASTRA_INSTRUCTIONS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/DATA_MODEL.md`
4. `docs/STATE_MACHINES.md`
5. remaining canonical specs

## Running the M0 foundation

Use Node.js 22.12+ (Node 22 LTS recommended) and the pinned pnpm 10.15.0.
If a different pnpm is installed, use `corepack pnpm` in this repository.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm dev
```

`pnpm dev` rebuilds SQLite for Electron, bundles main/preload, starts Vite, and
opens Electron. Renderer edits use HMR; restart dev for main/preload edits.
For the built renderer, run `pnpm --filter @arise/desktop start` after building.
Opening Vite in a browser alone does not provide the desktop IPC bridge.

SQLite is stored in Electron's userData directory (`arise.db`). Main enables
WAL and applies sequential, transactional migrations tracked by SQLite
`user_version`. Migration 1 preserves the original unversioned M0 table and
its existing rows. Failed migrations abort startup and close the connection.
No M1 domain model or product behavior is implemented here.

### Native module runtimes

Node and Electron use different native module ABIs. `pnpm dev`, `start`, and
`test:e2e` rebuild better-sqlite3 for Electron. Before returning to Node/Vitest
after those commands, restore the Node build:

```bash
pnpm --filter @arise/desktop native:node
pnpm test
```

If no prebuilt native binary is available, a native compiler toolchain and
runtime headers are required (Visual Studio C++ build tools/Python on Windows;
C++/make/Python on Linux). Electron installation also downloads its binary.

### M0 Electron smoke test

```bash
pnpm test:e2e
```

On Linux CI, use `xvfb-run --auto-servernum pnpm test:e2e` with the Electron
system libraries installed. Windows uses the same test without Xvfb. The test
opens the built desktop, checks DATABASE READY through the preload bridge,
checks renderer isolation and SQLite WAL, persists a draft Idea, restarts, and
checks the same Idea remains. It uses a temporary userData directory.

Root lint checks TypeScript and enforces restricted imports at the domain and
renderer boundaries. The placeholder packages remain placeholders. Unit and
SQLite integration tests cover IPC rejection, database write errors, migration
rollback, starter database compatibility, and persistence across reopen.

A freeze requires passing checks and a successful Electron smoke run. Windows
runtime verification remains necessary for this Windows-targeted application;
adding CI jobs does not itself establish that they passed.

## M0 verification report — 2026-09-09

**Recommendation: do not freeze yet.** The Electron GUI acceptance test is
blocked in the validation environment. No Milestone 1 work was begun.
All canonical `/docs` files remain byte-for-byte unchanged; no original files
were deleted. All changes are inside the M0 allowed scope.

### Files changed or added

- `.github/workflows/ci.yml`
- `.gitignore`
- `README.md`
- `apps/desktop/e2e/foundation.spec.ts`
- `apps/desktop/package.json`
- `apps/desktop/playwright.config.ts`
- `apps/desktop/scripts/build.mjs`
- `apps/desktop/scripts/dev.mjs`
- `apps/desktop/src/main/ipc.test.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/preload/preload.ts`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/tsconfig.main.json`
- `apps/desktop/tsconfig.test.json`
- `apps/desktop/vite.config.ts`
- `apps/desktop/vitest.config.ts`
- `eslint.config.mjs`
- `package.json`
- `packages/database/src/database.ts`
- `packages/database/src/migrations.test.ts`
- `packages/database/src/migrations.ts`
- `packages/shared/src/ipc.test.ts`
- `packages/shared/src/ipc.ts`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`

### Verification results

| Check | Result |
| --- | --- |
| Install with pnpm 10.15.0 | Passed |
| Frozen-lockfile installation | Passed |
| Workspace typecheck | Passed, including Electron E2E/test configuration |
| Root ESLint | Passed, including domain/renderer import restrictions |
| Unit and SQLite integration tests | 19 passed: domain 1, shared IPC 8, database 5, main IPC 5 |
| Workspace production build | Passed: React renderer and bundled Electron main/preload |
| Electron native SQLite rebuild | Passed |
| Restore SQLite to Node ABI | Passed |
| Canonical documents / out-of-scope packages | Unchanged |
| Electron GUI smoke test | 1 failed at launch: missing X server / DISPLAY |
| Windows execution | Not available locally; CI matrix configured, not yet run |

Empty placeholder packages report no tests; those are not counted as passing
test cases. Repository tests verify WAL, schema version 1, restart persistence,
unversioned starter compatibility, rollback after failed migrations, duplicate
Idea identity rejection, invalid IPC rejection, and database-error propagation.

The first Electron smoke attempt found `better-sqlite3` unavailable to the
bundled main process. Adding it as an explicit desktop runtime dependency fixed
that module-loading error. The retry reached Electron initialization and failed
because no X server / DISPLAY exists. It did not reach the renderer assertions
or establish that main-process startup opened the database successfully.

`pnpm dev` started its rebuild and Vite workflow, but Electron refused to run
as root with its normal sandbox settings. The dev launcher now returns failure
for signal-terminated Electron processes. No production sandbox setting was
weakened. Playwright uses its own standard Electron launch arguments.

### Commands run

Commands below were run from the repository root unless otherwise stated.
The environment's global pnpm was 11.19.0; its first install failed on blocked
native dependency scripts. Subsequent work used the repository's pinned
pnpm 10.15.0 via Corepack (and a temporary PATH shim for nested pnpm scripts).

```bash
node --version
pnpm --version
corepack pnpm --version
pnpm install
corepack pnpm install
CI=true corepack pnpm install --no-frozen-lockfile
pnpm install --no-frozen-lockfile
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter @arise/desktop typecheck
pnpm --filter @arise/desktop native:electron
pnpm --filter @arise/desktop exec playwright test
pnpm dev
pnpm test:e2e
pnpm --filter @arise/desktop native:node
pnpm check
```

The first Corepack install requested a clean module reinstall after switching
pnpm versions; it was rerun noninteractively with CI=true. Initial attempts to
run checks through global pnpm also stopped at its blocked-install prerequisite.
File inspection used unzip, cat, sed, rg, and Git diff/status against an imported
baseline. Python compared every final source file to the uploaded ZIP, checked
scope, and prepared the source archive. `apt-get update` was attempted to obtain
Xvfb; it failed on environment setgroups/setuid permissions, so no system
packages were installed. Local runtime: Linux x64, Node 24.19.0, Electron 37.10.3.

### Remaining freeze gate

On a normal Windows desktop, use pinned pnpm, run the checks above and
`pnpm test:e2e`, then visually confirm `pnpm dev` shows DATABASE READY.
The smoke test must complete its IPC, WAL, and restart assertions before M0
is frozen. The Linux/Windows CI jobs must actually run; their presence is not
a passing result. Do not begin M1 until explicitly authorized.

## AI / Agent Development

Before an AI coding agent edits this repository, read [`AGENTS.md`](./AGENTS.md) and [`docs/CURRENT_MILESTONE.md`](./docs/CURRENT_MILESTONE.md). These files contain the durable project context, frozen milestone boundaries, current acceptance state, and required workflow so implementation does not depend on prior chat history.
