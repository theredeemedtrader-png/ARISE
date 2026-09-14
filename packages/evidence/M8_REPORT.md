# ARISE M8 — Evidence + Decision Trace Report

## 1. Objective

M8 builds the canonical Evidence system around the immutable Strategy Runtime events and Decision Traces frozen in M7. It preserves exact historical inputs, captures an immutable original raster asynchronously, exposes Board and Drill-Down review surfaces, and remains completely non-executing.

Frozen M0–M7 behavior remains intact. M8 does not add MT5 connectivity, broker commands, ExecutionIntent, OrderPlan, Positions, fills, protection, or reconciliation.

## 2. Evidence model

`@arise/evidence` now defines:

- `EvidenceEvent` rooted in a durable source event
- `EvidenceSnapshot` with event-time workspace state, portable image path, SHA-256, framing profile, capture time, and capture origin
- `EvidenceReference` for exact historical entity/version lineage
- `EvidenceStageSummary` retaining links to every constituent per-node EvidenceEvent
- explicit source, event, status, capture-policy, capture-origin, and asset-integrity vocabularies
- reconstructable chart workspace state, including candles, MarketObjectVersion IDs, nested Timeframe Projection breadcrumbs, active Runtime Node, Colony, IdeaVersion, StrategyMapVersion, annotations, and event context

Decision Evidence and Entry Snapshot remain distinct event types. Entry/lifecycle types are modeled for later producers, but M8 does not fabricate fills or begin M9 execution work.

## 3. Runtime integration

M7 runtime and Decision Trace semantics were not changed.

M8 derives Evidence plans from the immutable `RuntimeNodeEvent`, matching `DecisionTrace`, `DetectorEvaluation`, the exact frozen StrategyMapVersion/StrategyVersion, Colony/IdeaVersion, Candle IDs, MarketObjectVersions, and EconomicEventRevisions available in the event-time `MarketContext`.

Default runtime capture policy is `STRATEGY_EVIDENCE_AND_ENTRY`. Runtime trigger, confirmation, failure, and expiry transitions create per-node Decision Evidence. Manual confirmation is explicitly labeled `MANUALLY_CONFIRMED`; failed cascades retain the failed node EvidenceEvent without relabeling cancelled descendants as confirmations.

`RuntimeRepository.commit` and `commitManualDecision` retain their M7-compatible call shape through an optional Evidence argument. When supplied, Runtime Node Events, evaluations, Decision Traces, EvidenceEvents, reconstructable workspace state, and exact references commit in the same SQLite transaction.

## 4. Asynchronous capture and integrity

The canonical runtime transaction completes before raster work begins.

An in-memory capture queue:

- never blocks or rolls back runtime progression
- retries failed capture work asynchronously
- resumes uncaptured durable EvidenceEvents after application restart
- records every failed attempt as immutable history
- leaves the EvidenceEvent and event-time workspace state durable when all capture attempts fail

Original rasters are deterministic PNG renderings of the immutable event-time chart state. They are stored below the Electron user-data Evidence directory with portable relative paths. The asset store:

- uses create-only writes so an original file is not overwritten
- computes SHA-256 from the original bytes
- reports `VERIFIED`, `MISSING`, or `CORRUPT` by checking the stored asset against immutable metadata

Regenerated views create new snapshots labeled `REGENERATED_VIEW`; they never replace the original `AUTOMATIC` snapshot.

## 5. Persistence

Database migration **v6** adds:

- `evidence_events`
- `evidence_references`
- `evidence_snapshots`
- `evidence_capture_attempts`
- `evidence_stage_summaries`
- `evidence_stage_summary_items`

Evidence tables have foreign keys, source uniqueness, status/type checks, and database-level immutable update/delete triggers. Event rows retain reconstructable workspace state and framing metadata even before image capture succeeds.

## 6. Typed desktop boundary

Typed shared schemas, main-process handlers, and the isolated preload expose:

- Evidence workspace query
- Board/Drill-Down data
- linked Decision Trace details
- exact Evidence references
- original/regenerated snapshots and integrity state
- explicitly labeled regeneration requests

The renderer does not access SQLite or the filesystem directly. Asset reads, verification, and base64 transport remain in the Electron main process.

## 7. Review UX

The frozen Market Review workflow is preserved. Its workspace now also offers an Evidence surface with:

- BOARD and DRILL-DOWN modes
- timeframe stages with numbered per-node events
- explicit CONFIRMED / MANUALLY_CONFIRMED / FAILED / EXPIRED / BLOCKED / ERROR vocabulary
- explicit PENDING / CAPTURED / CAPTURE FAILED state
- original raster and abbreviated SHA-256
- Decision Trace summary, event type, and diagnostics
- exact historical reference list
- reconstructable workspace-state disclosure
- regenerated-view action and non-replacement warning
- visible `EXECUTION DISABLED` boundary

## 8. Tests

M8 coverage includes:

- runtime transition → EvidenceEvent + Decision Trace linkage
- exact IdeaVersion, StrategyMapVersion, StrategyVersion, MarketObjectVersion, Candle, and EconomicEventRevision references
- immutable nested Timeframe Projection breadcrumbs
- Stage Summary links to each per-node event
- failed-cascade Evidence behavior
- capture queue non-blocking behavior and retries
- EvidenceEvent survival when capture fails
- runtime state survival when capture fails
- PNG generation and SHA-256 validation
- corrupt/missing asset handling
- immutable snapshot metadata
- regenerated-view labeling without original replacement
- schema-v6 migration and rollback behavior
- full Electron Board/Drill-Down, raster integrity, restart, and regeneration flow

Frozen M0–M7 unit, integration, and Electron E2E suites remain present.

## 9. Windows acceptance

Final Windows acceptance completed on 2026-09-11:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
pnpm dev
```

Results:

- frozen-lockfile install: passed
- typecheck/lint/unit/integration: passed
- substantive tests: 495 passed
- production build: passed
- Electron E2E: 7 passed
- desktop development launch: passed
- populated Evidence BOARD and DRILL-DOWN visual acceptance: passed

The IDE environment supplies `ELECTRON_RUN_AS_NODE=1`; it was removed only for Electron launch commands, as in the frozen M7 acceptance process.

## 10. Freeze recommendation

**M8 FROZEN — Windows acceptance passed.**

The next milestone is **M9 — MT5 Integration / Read-only bridge / Reconciliation foundation**. M9 is unstarted and must follow the durable handoff and canonical execution/safety specifications.
