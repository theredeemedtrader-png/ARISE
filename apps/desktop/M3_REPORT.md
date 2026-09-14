# ARISE M3 — Application Shell Report

## Status

**FREEZE CANDIDATE — Windows validation required.**

M3 implements the canonical desktop application shell on top of the frozen M0–M2 foundation. It intentionally does not begin chart rendering, Thesis/Colony authoring, Strategy Runtime, market data, execution, protection, or MT5 integration.

## Implemented

- Canonical left navigation groups: Overview; Plan; Execute; Build; Study; Utility.
- Persistent semantic workspace tabs with close/restore behavior.
- Global Ctrl+K command palette for workspace navigation.
- Persistent top context with Next Review, notification shell, database health and Market Navigator toggle.
- Persistent Market Navigator / watchlist shell without fabricated live prices.
- Overview command center with explicit empty/not-configured states.
- Ideas / Colony Kanban shell.
- Trading workspace shell with chart and execution placeholders; execution actions are disabled.
- Position lifecycle board shell using Scout → Survivor → Protected → Leg → Mature → Runner terminology.
- Knowledge workspace shell.
- Strategy workspace shell with a non-executable visual node-canvas preview.
- Database workspace showing real Electron database readiness and M2 persistence capabilities.
- Review and Analytics shells.
- System Health workspace that makes unavailable subsystems explicit.
- Settings workspace with persisted Appearance, Density, P&L display mode and Market Navigator visibility.
- Dark-first ARISE visual system plus a separate light hierarchy.
- No fake broker/quote values; unavailable live systems are visibly offline/unconfigured.

## Persistence / security boundary

The renderer continues to use only the typed preload API. It does not import Electron, SQLite, Drizzle, MT5, or main-process code. Existing `getAppInfo()` and legacy M0 `listIdeas()` are used only for real database/app readiness information. No M2 schema or repository behavior was changed.

## Tests added

`apps/desktop/src/renderer/shell-model.test.ts` covers:

1. workspace open/deduplication,
2. protection of the permanent Overview tab,
3. active-tab fallback on close,
4. safe canonical workspace restoration,
5. malformed persisted-state fallback.

Existing Electron E2E selectors and typed IPC behavior are preserved, including `.status` = `DATABASE READY` and the frozen `process.getBuiltinModule('node:module')` Windows compatibility fix.

`apps/desktop/e2e/shell.spec.ts` adds a Windows/Electron acceptance path for shell launch, Ctrl+K navigation, Settings, theme persistence, Market Navigator visibility, and restoration across an Electron restart.

## Developer tooling compatibility

Root `pnpm check` now begins by rebuilding `better-sqlite3` for the normal Node ABI (`native:node`) before typecheck/lint/test. This prevents a prior Electron E2E run from leaving the native module compiled for Electron and causing the next normal test run to fail with an ABI mismatch.

`pnpm test:e2e` continues to rebuild the same native module for Electron before Playwright launch.

## Files changed

- `package.json`
- `apps/desktop/src/renderer/App.tsx`
- `apps/desktop/src/renderer/styles.css`
- `apps/desktop/src/renderer/main.tsx`
- `apps/desktop/src/renderer/icons.tsx` (new)
- `apps/desktop/src/renderer/shell-model.ts` (new)
- `apps/desktop/src/renderer/shell-model.test.ts` (new)
- `apps/desktop/e2e/shell.spec.ts` (new)
- `apps/desktop/M3_REPORT.md` (new)

## Explicitly not implemented

- chart engine / Lightweight Charts integration,
- chart drawing layer,
- Market Object authoring/editing UI,
- Timeframe Projection rendering,
- canonical Idea/Colony creation workflow,
- rich documents/backlinks,
- Review Scheduler,
- Economic Calendar provider,
- Strategy Encyclopedia/Graph execution,
- detectors / runtime,
- evidence capture,
- market feed,
- MT5 orders,
- protection,
- live analytics.

The placeholders are intentional product boundaries, not simulated functionality.

## Required Windows validation

From the repo root:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
pnpm dev
```

For the final `pnpm dev` step, visually confirm the shell launches, navigation works, Ctrl+K opens the command palette, Settings persist after switching workspaces, and Market Navigator can be hidden/restored.

M3 should freeze only after these checks are green.
