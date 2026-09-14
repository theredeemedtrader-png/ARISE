# ARISE M6 — Strategy Encyclopedia + Strategy Graph

**Status:** Freeze candidate; Windows dependency-backed validation still required.

## Scope implemented

M6 adds the reusable strategy-authoring layer without starting live Strategy Runtime or detector execution.

### Strategy Encyclopedia
- Durable `StrategyDefinition` identity.
- Immutable `StrategyVersion` history.
- MANUAL / DETECTABLE / AUTOMATABLE capability.
- Explicit detector contract reference: key, version, evaluation mode and parameter schema.
- AUTOMATABLE strategies require an explicit detector contract.
- Descriptive knowledge is never treated as executable behavior implicitly.

### Strategy Graph
- One canonical `LogicGraph` shared by SIMPLE and GRAPH presentation modes.
- Node families: STRATEGY, LOGIC, MODIFIER, MARKET_OBJECT, STATE, ACTION.
- Logic operators: AND, OR, THEN, NOT.
- Flexible timeframe + purpose flags (HINDSIGHT / AREA / ENTRY), importance and execution mode per node.
- Graph validation rejects missing endpoints, duplicate connections, self-links and cycles.
- Strategy graph cycles are intentionally disallowed; repeated participation belongs to runtime/stacking policy rather than control-flow loops.
- `simpleSequence()` exposes a linear graph without creating a second representation.

### Reusable hierarchy
`StrategyMap.kind` supports:
- COMBO
- STRATEGY_MAP
- TEMPLATE

All three use the same versioned graph model.

### Persistence
SQLite migration v4 adds:
- `strategy_definitions`
- `strategy_versions`
- `strategy_maps`
- `strategy_map_versions`

Version tables are immutable and enforce linear history heads and supersedes pointers. Repositories reconstruct full history and save new graph revisions as new immutable versions.

### Desktop workspace
The Strategy workspace now includes:
- Encyclopedia browser.
- strategy creation and immutable revision UI.
- detector/capability metadata.
- reusable Map / Combo / Template list.
- node library.
- draggable Grasshopper-style graph canvas.
- persistent connections.
- selected-node inspector.
- timeframe, Hindsight/Area/Entry purposes, importance and execution-mode editing.
- SIMPLE / GRAPH views over the same graph.
- EDIT / LIVE separation; LIVE is deliberately read-only and marked unavailable until M7.

The graph canvas is implemented behind ARISE's graph data model with no runtime dependency. It is intentionally presentation-only; M7 owns actual RuntimeNodes, detector evaluation, trigger memory and subscriptions.

## Explicitly not implemented
- Strategy Runtime.
- live detector evaluation.
- market-data subscriptions.
- automatic actions.
- evidence/Decision Trace.
- MT5 execution.
- live deployment migration.
- prose-to-code inference.

## Tests added
- strategy-engine domain tests for immutable versions, capability gating, DAG validation and Simple/Graph equivalence.
- database persistence test for immutable strategy/map history.
- Electron E2E `strategy.spec.ts` creates an Encyclopedia strategy, creates a map, adds/links nodes, saves v2, restarts Electron and verifies exact persisted graph state.

Expected E2E count after M6: **5 tests**.

## Local validation in this build environment
- `packages/strategy-engine/src/model.ts` compiles with standalone TypeScript.
- strategy-engine smoke execution passed for creation, graph validation and Simple sequence resolution.
- M6 SQLite migration was extracted and executed successfully against in-memory SQLite; all four M6 tables and triggers parse successfully.
- all changed TS/TSX files pass TypeScript syntax/transpile diagnostics.

Full pnpm/Vitest/Electron execution is not available in this clean container because npm dependencies are intentionally absent and registry access is unavailable. Run the normal Windows gate before freezing.

## Windows freeze gate
From repository root:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
pnpm dev
```

Expected E2E result: **5 passed**.

## Visual acceptance
Open **Strategy** and verify:
1. Create an Encyclopedia strategy.
2. Create a Strategy Map.
3. Add Strategy / Logic / Action nodes.
4. Drag nodes on the canvas.
5. Connect nodes through the Inspector.
6. Assign any timeframe and any combination of HINDSIGHT / AREA / ENTRY.
7. Save a new Map version.
8. Toggle SIMPLE / GRAPH and EDIT / LIVE.
9. Restart ARISE and confirm the Strategy and graph remain.
