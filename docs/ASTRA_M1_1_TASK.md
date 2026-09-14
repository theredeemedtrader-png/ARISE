# Astra Task — M1.1 Core Domain Foundations

**Milestone:** M1 — Domain Model + State Machines  
**Task:** M1.1  
**Baseline:** M0 FROZEN on Windows, 2026-09-09  
**Status:** Implementation task

---

## 1. Context

You are working from the frozen ARISE Milestone 0 repository.

Milestone 0 has already been verified on Windows:

- frozen-lockfile install passed,
- typecheck passed,
- lint passed,
- unit/integration tests passed,
- production build passed,
- Electron E2E smoke test passed,
- renderer isolation passed,
- typed IPC passed,
- SQLite WAL passed,
- persistence across Electron restart passed,
- `pnpm dev` launched the real Electron application and displayed `DATABASE READY`.

Do **not** reopen or redesign M0 unless a genuine regression caused by this task requires a narrowly scoped compatibility fix.

Before coding, read:

1. `docs/ASTRA_INSTRUCTIONS.md`
2. `docs/MILLIPEDE_PHILOSOPHY.md`
3. `docs/DATA_MODEL.md`
4. `docs/STATE_MACHINES.md`
5. `docs/PRODUCT_SPEC.md`
6. `docs/ARCHITECTURE.md`
7. `docs/TEST_PLAN.md`

The files in `/docs` remain canonical.

---

## 2. Objective

Implement the first real ARISE domain layer for:

1. canonical identity primitives,
2. Instrument,
3. Timeframe,
4. Idea,
5. IdeaVersion,
6. Colony,
7. ColonyLineage,
8. ColonyStateEvent,
9. Target,
10. TargetEvent,
11. pure Idea / Colony / Target lifecycle rules.

This task establishes semantic foundations only.

Do **not** implement persistence architecture for these entities beyond the minimum compatibility necessary to keep the frozen M0 repository passing.

---

## 3. Files allowed

Primary implementation scope:

- `packages/domain/**`

Allowed only when required to keep the frozen M0 foundation compiling/testing:

- `packages/database/**`
- `packages/shared/**`
- relevant root test/lint/type configuration

You may add M1.1-specific tests.

Do not modify canonical product specifications.

Do not implement UI features.

---

## 4. Canonical identity rules

Every durable entity must use a stable opaque ID.

At minimum provide domain-level identities for:

- `InstrumentId`
- `TimeframeId`
- `IdeaId`
- `IdeaVersionId`
- `ColonyId`
- `ColonyLineageId`
- `ColonyStateEventId`
- `TargetId`
- `TargetEventId`
- opaque `MarketObjectId` / `MarketObjectVersionId` references where required by current canonical fields

Human-readable labels such as:

- `Weekly Long #05`
- `Scout #24`
- `D FVG #03`

are presentation values and must never replace canonical IDs.

Do not introduce database-generated semantics into the domain model.

---

## 5. Instrument

Implement the canonical domain representation described in `DATA_MODEL.md`.

Required semantics include:

- canonical symbol,
- display name,
- asset class,
- base currency,
- quote currency,
- pip size,
- tick size,
- price digits,
- enabled state,
- created timestamp.

Broker symbol mapping is out of scope.

Do not add MT5-specific fields.

---

## 6. Timeframe

Implement canonical Timeframe identity and metadata.

Required semantics:

- stable `TimeframeId`,
- code,
- duration where applicable,
- calendar rule for D/W/M-style timeframes,
- display order.

Do **not** hard-code Hindsight / Area / Entry roles onto Timeframes.

This task does not implement `TimeframeService` candle-boundary calculations.

---

## 7. Idea

An `Idea` is the durable identity of a thesis across revisions.

Canonical fields:

- Idea ID
- Instrument ID
- thesis Timeframe ID
- current status
- created timestamp
- archived timestamp if applicable

Canonical lifecycle vocabulary:

- DRAFT
- WATCHING
- ACTIVE
- IN_PLAY
- TARGET_APPROACHING
- TARGET_HIT
- COMPLETED
- INVALIDATED
- CANCELLED
- ARCHIVED

Preserve the distinction:

> Scout stop-out is not Idea invalidation.

No trade or position implementation belongs in this task.

---

## 8. IdeaVersion

`IdeaVersion` is an immutable thesis snapshot.

Required fields:

- IdeaVersion ID
- Idea ID
- version number
- direction: `LONG | SHORT | NEUTRAL`
- thesis text
- target description
- invalidation description
- primary target MarketObjectVersion reference, nullable
- invalidation MarketObjectVersion reference, nullable
- created timestamp
- superseded IdeaVersion reference, nullable

Historical versions must not be mutated in place.

Implement domain guards/helpers needed to create successive versions deterministically.

Do not add an editor or database version-history UI.

---

## 9. Colony

A Colony represents a campaign around one explicit thesis.

Required fields:

- Colony ID
- Idea ID
- original IdeaVersion ID
- Instrument ID
- human-readable label
- current Colony state
- current Target ID, nullable
- created timestamp
- completed timestamp, nullable

Canonical Colony states:

- DORMANT
- BUILDING
- ESTABLISHED
- MATURE
- DECAYING
- INVALIDATED
- COMPLETED

Do not collapse Colony into Idea.

---

## 10. Colony lifecycle

Implement pure transition validation matching `STATE_MACHINES.md`.

Typical valid progression:

```text
DORMANT → BUILDING
BUILDING → ESTABLISHED
ESTABLISHED → MATURE
```

Alternative valid transitions include the canonical DECAYING / INVALIDATED / COMPLETED routes in `STATE_MACHINES.md`.

Invalid transitions must fail explicitly.

Transition logic must not perform broker actions, persistence, UI changes or hidden side effects.

A successful transition must make it possible for higher layers to produce an immutable `ColonyStateEvent`.

---

## 11. ColonyLineage

Implement canonical lineage relationships:

- `PROMOTED_TO`
- `CONSOLIDATED_INTO`
- `DERIVED_FROM`

The source and target Colony IDs must remain explicit.

Do not implement promotion/consolidation orchestration yet.

Do not rewrite source Colony history.

---

## 12. ColonyStateEvent

Represent immutable Colony state-transition history.

Required semantics:

- event ID
- Colony ID
- from state
- to state
- reason
- source type
- optional source ID
- occurred timestamp

Creating a state event must not itself persist anything.

---

## 13. Target

A Target represents intended destination.

It is **not automatically a broker take-profit order**.

Required fields:

- Target ID
- Colony ID
- target type
- exact price, nullable
- zone MarketObject ID, nullable
- management mode
- status
- created timestamp

Canonical management modes:

- REFERENCE_ONLY
- FULL_TP
- PARTIAL_TP
- TRAIL
- MANUAL
- HYBRID
- RUNNER

Canonical lifecycle/status vocabulary:

- ACTIVE
- APPROACHING
- REACHED
- HIT
- INVALIDATED
- REASSIGNED
- COMPLETED

Preserve:

- APPROACHING = spatial proximity threshold,
- REACHED = price enters target zone,
- HIT = target objective considered consumed/satisfied.

Do not implement target-price monitoring yet.

---

## 14. TargetEvent

Implement immutable Target-event representation for at least:

- APPROACHING
- REACHED
- HIT
- INVALIDATED
- REASSIGNED

Use canonical IDs and timestamps.

Do not implement market-data-triggered generation yet.

---

## 15. State-machine implementation rules

State transitions must be:

- pure,
- deterministic,
- unit tested,
- side-effect free,
- explicit about invalid transitions.

Do not silently coerce invalid states.

Do not attach broker actions to domain transitions.

Do not infer management behavior from lifecycle state.

---

## 16. M0 compatibility

The frozen M0 repository currently contains a minimal starter Idea persistence path.

You may adapt that compatibility layer only as necessary for compilation/tests.

Do not turn M1.1 into the persistence milestone.

Do not introduce broad schema migrations for Colony/Target/version history in this task.

That belongs to M2.

---

## 17. Required tests

Add strong domain tests covering at minimum:

### Identity
- IDs remain opaque/stable values.
- presentation labels are not IDs.

### Idea
- create a valid Idea.
- use LONG / SHORT / NEUTRAL only.
- valid status transitions.
- invalid status transitions fail.
- archived timestamp semantics where relevant.

### IdeaVersion
- create v1.
- create a successor version.
- version number increments correctly.
- `supersedesIdeaVersionId` links correctly.
- prior version remains unchanged.

### Colony
- create DORMANT Colony.
- canonical happy-path lifecycle.
- DECAYING routes.
- INVALIDATED routes.
- COMPLETED routes.
- invalid shortcuts rejected.

### Colony lineage
- each canonical relationship type.
- source and target remain distinct.

### Target
- management modes.
- ACTIVE → APPROACHING → REACHED → HIT.
- REACHED and HIT remain distinct.
- invalid transitions rejected.
- Target remains semantic destination, with no broker-order dependency.

All existing M0 tests must continue passing.

---

## 18. Architecture invariants

This task must preserve:

- `packages/domain` has no React.
- `packages/domain` has no Electron.
- `packages/domain` has no SQLite/Drizzle.
- `packages/domain` has no MT5.
- no broker-specific code in domain.
- no trading logic in renderer.
- LONG / SHORT / NEUTRAL terminology.
- no percent-risk sizing model.
- no fixed H/A/E timeframe mapping.
- Idea and Colony remain distinct.
- Target and broker TP remain distinct.
- state and management remain distinct.
- historical concepts remain versionable.

---

## 19. Explicitly out of scope

Do not implement:

- Market Object implementation beyond opaque references needed by these entities
- TimeframeService
- candles/quotes
- Hindsight / Area / Entry assignments
- Position lifecycle
- Attempts
- Trades
- Strategy Encyclopedia
- Strategy Graph
- Strategy Runtime
- detectors
- Evidence
- Review Scheduler
- Watchlists
- Economic Calendar
- MT5
- execution
- protection
- analytics
- new product UI

These belong to later tasks.

---

## 20. Acceptance criteria

M1.1 is complete only if:

1. canonical domain identities exist,
2. Instrument and Timeframe domain entities exist,
3. Idea and immutable IdeaVersion exist,
4. Colony / lineage / state-event entities exist,
5. Target / TargetEvent exist,
6. lifecycle rules match canonical docs,
7. invalid transitions are explicitly rejected,
8. domain code remains infrastructure-independent,
9. all new domain behavior has tests,
10. all frozen M0 tests still pass,
11. `pnpm typecheck` passes,
12. `pnpm lint` passes,
13. `pnpm test` passes,
14. `pnpm build` passes,
15. `pnpm test:e2e` still passes on a capable GUI environment.

Do not begin M1.2.

---

## 21. Deliverable

At completion report:

1. files changed,
2. domain types/entities added,
3. state-machine rules implemented,
4. tests added and results,
5. compatibility changes outside `packages/domain`, if any, with justification,
6. architecture/spec ambiguities encountered,
7. remaining blockers,
8. whether M1.1 is ready to freeze.

Do not begin M1.2 until explicitly authorized.
