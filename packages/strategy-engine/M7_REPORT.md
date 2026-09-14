# ARISE M7 — Strategy Runtime + Detector Engine Report

## 1. Objective

M7 turns the frozen M6 Strategy Encyclopedia/Graph definition layer into a persistent, deterministic runtime that can evaluate detector-backed graph nodes against `MarketContext`, advance graph state, preserve trigger memory and Decision Traces, and surface safe action proposals without creating broker orders or Positions.

Frozen baselines preserved:

- M0 — Engineering foundation
- M1 — Domain model
- M2 — Persistence and immutable history
- M3 — Application shell
- M4 — Charts / drawings / Market Objects
- M5 — Ideas / Thesis / Knowledge / Review
- M6 — Strategy Encyclopedia + Graph

M8 and later milestones were not started.

## 2. Runtime architecture

M7 adds a separate runtime layer beneath immutable M6 definitions:

`Strategy Definition / Strategy Map Version -> Strategy Runtime -> Runtime Nodes -> Market Event + MarketContext -> Detector Evaluation -> Runtime Node Event -> Decision Trace -> downstream node/action`

The runtime stores mutable *current* node state while preserving immutable event/evaluation/trace history. Definitions and frozen graph versions remain immutable.

Runtime modes implemented:

- `OBSERVE` — evaluates and records what would occur, but does not emit actionable proposals.
- `SHADOW` — evaluates the same graph and may persist an `ActionProposal`, but never executes it.
- `DEMO` / `LIVE` exist in the canonical runtime model and deployment ceiling logic, but M7 IPC/UI deliberately does not permit broker execution.

Runtime/node states include:

- Runtime: `READY`, `RUNNING`, `PAUSED`, `COMPLETED`, `CANCELLED`, `ERROR`
- Node: `DORMANT`, `ARMED`, `WATCHING`, `TRIGGERED`, `CONFIRMED`, `COMPLETED`, `FAILED`, `EXPIRED`, `CANCELLED`, `BYPASSED`

M7 also adds duplicate-event protection, persisted trigger counts/memory, dead-branch settlement, and restart-safe runtime reconstruction.

## 3. Detector engine

A typed detector registry and `MarketContext` contract were added. Initial detector keys are:

- `price_touch`
- `price_cross`
- `zone_entry`
- `spread`
- `liquidity_sweep`
- `displacement`
- `fvg`
- `fvg_retracement`
- `mss`

Evaluation modes are modeled explicitly, including `ON_TICK`, `ON_PRICE_UPDATE`, `ON_BAR_UPDATE`, `ON_BAR_CLOSE`, and `MANUAL` where applicable.

`MarketContext` carries instrument/timeframe context, candles, bid/ask/chart price, spread/pip size, Market Objects, strategy state, session/economic-event context, and event time. M7 does not introduce a live broker feed; the M7 lab feeds simulated events through the same runtime interfaces intended for later live market data.

## 4. Runtime graph behavior

M7 evaluates the frozen Strategy Map graph rather than inventing a second runtime graph format.

Implemented behaviors include:

- arming/watching downstream nodes from satisfied upstream nodes
- detector evaluation and trigger memory
- logic-node progression
- modifier/state node evaluation
- deterministic action-node handling
- explicit failure/cancellation settlement for dead downstream branches
- duplicate market-event rejection
- persisted current node state plus immutable transition history
- Decision Trace production for runtime decisions

A SHADOW action such as `CREATE_SCOUT` produces only a persisted proposal. It does **not** create an ARISE Position, execution intent, MT5 order, or broker side effect.

## 5. Manual nodes and confirmation gates

Canonical manual-node behavior is implemented end to end.

Manual strategy nodes, and detector-backed strategy nodes configured with execution mode `CONFIRM`, can pause at the decision boundary and require one of:

- `CONFIRM`
- `REJECT`
- `SKIP`

Each manual decision:

- validates the exact frozen strategy/map definition
- records user/manual source metadata and timestamp
- creates a Decision Trace
- transitions node state explicitly
- deterministically updates downstream eligibility
- persists across restart

Semantics:

- `CONFIRM` -> node becomes `CONFIRMED`; eligible downstream nodes are armed/watched.
- `REJECT` -> node becomes `FAILED`; unreachable descendants are cancelled/settled.
- `SKIP` -> node becomes `BYPASSED` and is treated as satisfied for downstream progression.

Detector-backed `CONFIRM` nodes stop at `TRIGGERED` after a valid detector hit. Repeated matching events while manual confirmation is pending do not repeatedly increment the trigger or emit duplicate confirmation-required traces.

The Strategy LIVE inspector exposes the three manual controls only when a selected runtime node actually requires a manual decision.

## 6. Deployment gating

Strategy versions now carry a deployment status:

- `EXPERIMENTAL`
- `VALIDATED`
- `DEMO_APPROVED`
- `LIVE_APPROVED`
- `RETIRED`

Runtime-mode eligibility is checked against the frozen strategy versions used by the map. Helper logic computes whether a requested runtime mode is permitted and the maximum allowed mode.

M7's exposed lab/runtime workflow remains limited to `OBSERVE` and `SHADOW`. `DEMO` and `LIVE` broker behavior remain intentionally unavailable.

## 7. Persistence

Database schema migration **v5** adds runtime persistence including:

- `strategy_runtimes`
- `runtime_nodes`
- `runtime_node_events`
- `detector_evaluations`
- `decision_traces`
- `runtime_processed_events`
- `runtime_action_proposals`

`deployment_status` is added to strategy versions.

Historical event/evaluation/trace/proposal records are immutable. Runtime-node rows represent reconstructable current state. Repository operations persist market-event processing and manual decisions transactionally.

The previously validated v5 migration produced 44 application tables and 49 integrity/immutability triggers with foreign-key/integrity checks clean.

## 8. IPC and desktop integration

Typed IPC/preload APIs were added for runtime creation, querying, simulated event processing, and manual decisions. The renderer does not directly access SQLite.

The Strategy workspace LIVE surface now supports:

- launching an OBSERVE or SHADOW runtime from the selected Colony/Strategy Map context
- selecting runtime nodes and inspecting actual runtime state
- feeding M7 lab market events into the engine
- viewing Decision Trace/runtime results
- explicit manual `CONFIRM / REJECT / SKIP` controls
- seeing SHADOW action proposals as records only

Review copy was also corrected so it does not imply that automatic candle-close reviews already have canonical live TimeframeService data.

## 9. Safety boundaries / explicitly out of scope

M7 does **not** implement or simulate broker authority.

Not included:

- live MT5 market feed
- broker orders
- ExecutionIntent / OrderPlan
- ARISE Position creation from runtime actions
- stop-loss / take-profit placement
- partial fills
- protection / breakeven / trailing
- reconciliation
- live trading

A SHADOW `CREATE_SCOUT` result is an `ActionProposal`, not a Scout/Position or order.

## 10. Tests added / extended

M7 adds or extends coverage for:

- detector evaluation contracts
- event-mode matching
- runtime node transitions
- duplicate-event protection
- graph progression
- OBSERVE vs SHADOW safety behavior
- action proposals
- persisted runtime reconstruction
- runtime repository history
- deployment status persistence/gating
- manual nodes ignoring synthetic manual market events
- explicit manual CONFIRM
- explicit manual REJECT and dead-branch settlement
- explicit manual SKIP
- detector-backed confirmation gates waiting at `TRIGGERED`
- no duplicate trigger/trace while manual confirmation is pending
- restart persistence of manual decisions / Decision Traces
- Electron runtime workflow in `apps/desktop/e2e/runtime.spec.ts`

The existing M0–M6 tests are retained.

## 11. Files changed relative to frozen M6

Before this report, M7 changed 22 implementation/test files across:

- `packages/strategy-engine/**`
- `packages/database/**`
- `packages/shared/src/ipc.ts`
- Electron main/preload/renderer integration
- Electron E2E runtime/strategy tests

This report is the additional M7 documentation file.

No frozen canonical product/spec documents were rewritten.

## 12. Validation

Pre-acceptance validation completed during implementation included:

- strict TypeScript compilation of `packages/strategy-engine` using temporary dependency stubs: **passed**
- production Strategy Engine compilation/smoke execution: **passed**
- strict compilation of the shared IPC production source using a temporary Zod type stub: **passed**
- detector-backed `CONFIRM` smoke: detector hit stops at `TRIGGERED`; explicit CONFIRM advances downstream: **passed**
- manual `REJECT` smoke: manual node `FAILED`, dead child `CANCELLED`, runtime settles, manual/upstream traces emitted: **passed**
- manual `SKIP` smoke: node `BYPASSED`, downstream watches, correct traces emitted: **passed**
- SQLite migration v5 application/integrity validation performed during M7 implementation: **passed**

All temporary validation stubs/node_modules were removed before packaging.

## 13. Windows acceptance

The final Windows acceptance run completed on 2026-09-11:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
pnpm dev
```

Results:

- frozen-lockfile install: **passed**
- `pnpm check`: **passed**
- `pnpm build`: **passed**
- Electron E2E: **6 passed** (foundation + shell + chart + planning + strategy + runtime)
- `pnpm dev`: **launched successfully**
- Strategy LIVE visual/runtime acceptance: **passed**

The accepted Strategy workspace showed the M7 LIVE runtime surface, OBSERVE/SHADOW runtime behavior, manual decision controls only where applicable, and clearly non-executing SHADOW proposals. Restart restoration passed in Electron E2E.

## 14. Freeze recommendation

**M7 FROZEN — Windows acceptance passed.**

The next milestone is **M8 — Evidence + Decision Trace**. M7 already establishes Decision Trace as runtime substrate; M8 adds the canonical evidence/snapshot system around it.
