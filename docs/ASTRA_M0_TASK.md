# Astra Task — Milestone 0 Foundation Verification

## Context

You are working in the ARISE repository. Before coding, read:

1. `docs/ASTRA_INSTRUCTIONS.md`
2. `docs/ARCHITECTURE.md`
3. `docs/PRODUCT_SPEC.md`
4. `docs/TEST_PLAN.md`

This repository is intentionally only Milestone 0.

## Objective

Verify and finish the engineering foundation so ARISE has a stable base for Milestone 1.

## Files allowed

You may modify:
- root package/workspace configuration
- `apps/desktop/**`
- `packages/shared/**`
- `packages/domain/**`
- `packages/database/**`
- CI/test configuration
- `README.md`

Do not implement product features from later milestones.

## Invariants

- No trading logic in React.
- Domain package contains no Electron, SQLite, MT5 or UI specifics.
- Renderer never talks directly to SQLite.
- Renderer never talks directly to MT5.
- IPC is typed and validated.
- Direction vocabulary is LONG / SHORT / NEUTRAL.
- Fixed-lot/pip semantics are not to be redesigned here.
- Do not add Strategy Graph, charting, broker execution or market-data functionality.
- Do not reinterpret canonical specs.

## Acceptance tests

1. `pnpm install` succeeds.
2. `pnpm typecheck` succeeds.
3. `pnpm test` succeeds.
4. Electron desktop launches.
5. Main process opens SQLite in WAL mode.
6. Renderer calls a typed IPC method and displays app/database status.
7. `IdeaRepository` can persist/read a domain Idea.
8. Repository boundaries match `ARCHITECTURE.md`.
9. No later-milestone behavior is introduced.

## Out of scope

- MT5 connectivity
- live data
- charts
- Market Objects
- Strategy Encyclopedia
- Strategy Graph
- detector engine
- evidence
- trading
- protection
- analytics

## Deliverable

Return:
- files changed
- commands run
- tests passed/failed
- any M0 blocker
- recommendation whether M0 is ready to freeze.
