# Astra Task — M1.2 Participation Domain: Attempts, Trades, Positions, and Stacking

**Milestone:** M1 — Domain Model + State Machines  
**Task:** M1.2  
**Baseline:** M1.1 FROZEN on Windows, 2026-09-09  
**Status:** Implementation task

---

## 1. Context

You are working from the frozen ARISE M1.1 repository.

M1.1 has already been verified on Windows:

- frozen-lockfile install passed,
- typecheck passed,
- lint passed,
- 116 unit/integration tests passed,
- production build passed,
- Electron native rebuild passed,
- Electron E2E smoke test passed on Windows (`1 passed`),
- M0 remained frozen and compatible.

Do **not** reopen or redesign M0 or M1.1 unless a genuine regression caused by this task requires a narrowly scoped compatibility fix.

Before coding, read in this order:

1. `docs/ASTRA_INSTRUCTIONS.md`
2. `docs/MILLIPEDE_PHILOSOPHY.md`
3. `docs/DATA_MODEL.md`
4. `docs/STATE_MACHINES.md`
5. `docs/PRODUCT_SPEC.md`
6. `docs/ARCHITECTURE.md`
7. `docs/TEST_PLAN.md`
8. `packages/domain/M1_1_REPORT.md`

The files in `/docs` are the canonical product specification. This task document narrows implementation scope; it does not override those canonical files.

---

## 2. Objective

Implement the next pure ARISE domain tranche for repeated participation inside a Colony:

1. new durable identity primitives required by this task,
2. `Attempt`,
3. canonical Attempt result/lifecycle vocabulary,
4. `Trade`,
5. `Position`,
6. `PositionStateEvent`,
7. pure Position lifecycle rules,
8. `AttemptBudget`,
9. `StackingPolicy`,
10. pure stacking / attempt-budget eligibility decisions.

The goal is to establish the domain semantics needed for a Colony to make repeated low-risk participation attempts without coupling those semantics to broker execution.

Canonical conceptual flow:

```text
Idea
  ↓
Colony
  ├── Attempt → Trade → Position → Scout → Survivor → Leg → ...
  ├── Attempt → Failed / Scratch / Expired
  ├── Attempt → Trade → Position → Failed / Closed
  └── repeated participation governed by AttemptBudget + StackingPolicy
```

This task is still **domain-only**. It must not place orders, talk to MT5, calculate live stops, or create persistence migrations for these entities.

---

## 3. Files allowed

Primary implementation scope:

- `packages/domain/**`

Allowed only when narrowly required to preserve the frozen foundation:

- `packages/database/**`
- `packages/shared/**`
- relevant root test/lint/type configuration

You may add M1.2-specific tests.

Do **not** modify canonical product-specification files in `/docs`.

Do **not** implement new UI.

---

## 4. Architectural invariants

Preserve all prior invariants plus the following:

- `packages/domain` has no React.
- `packages/domain` has no Electron.
- `packages/domain` has no SQLite/Drizzle.
- `packages/domain` has no MT5 API types or calls.
- broker/account identifiers, where canonical fields require them, must remain opaque domain values rather than MT5-specific structures.
- no broker actions occur inside lifecycle transition functions.
- no database writes occur inside domain functions.
- no renderer-side trading logic.
- state describes what an entity is; management describes what ARISE does about it.
- Position state must not silently imply stop movement, breakeven, trailing, partial close, adding, or any other management action.
- Scout failure must not automatically invalidate its parent Idea or Colony.
- fixed-lot / pip-first philosophy remains intact; do not add percent-risk sizing fields.
- do not implement countertrend automation policy in this task.
- do not redesign M1.1 entities.

---

## 5. Identity primitives

Add stable opaque IDs needed by the canonical M1.2 entities.

At minimum provide:

- `AttemptId`
- `TradeId`
- `PositionId`
- `PositionStateEventId`
- `AttemptBudgetId`

Add opaque references only where required by canonical fields, for example:

- `StrategyRuntimeId`
- `StrategyMapVersionId`
- `BrokerAccountId`
- broker-position identity/key type

Reuse existing IDs such as:

- `ColonyId`
- `IdeaVersionId`
- `InstrumentId`

Human-readable labels must never substitute for canonical IDs.

Do not introduce database-generated semantics into domain identity types.

---

## 6. Attempt

Implement `Attempt` according to `DATA_MODEL.md §17`.

Canonical purpose:

> One effort to acquire exposure.

Required canonical fields:

- Attempt ID
- Colony ID
- Strategy Runtime ID, nullable
- sequence number
- started timestamp
- completed timestamp, nullable
- result, nullable
- pip cost, nullable

Canonical terminal result vocabulary:

- `EXPIRED`
- `FAILED`
- `SCRATCH`
- `SURVIVED`

Preserve these semantics:

- an Attempt begins before fill,
- an entry that never fills may end `EXPIRED`,
- an expired unfilled Attempt may have `pipCost = 0`,
- sequence number is scoped to the Colony and must be a positive deterministic value supplied/validated by the domain; do not query persistence to generate it,
- pip cost is not R and is not account-percent risk.

Do not add broker order IDs to `Attempt`.

### Attempt lifecycle vocabulary

`STATE_MACHINES.md §13` defines the suggested lifecycle:

```text
CREATED
  ↓
WAITING
  ↓
READY
  ↓
ORDER_SUBMITTED
  ↓
FILLED
  ↓
SURVIVED / FAILED / SCRATCH
```

Alternate terminal states:

- `EXPIRED`
- `CANCELLED`
- `REJECTED`

Implement this as pure domain lifecycle vocabulary and transition validation.

Important canonical-model nuance:

- `DATA_MODEL.md` stores terminal `result` on `Attempt`, but does not currently list a persisted current lifecycle-state field or an `AttemptStateEvent` entity.
- Do **not** silently redesign the canonical data model to invent persistence/history schema.
- It is acceptable for M1.2 to expose an `AttemptState` type and pure transition validator independently from the stored `Attempt.result` field.
- If implementation requires a stronger choice, document it in the M1.2 report instead of modifying canonical docs.

No execution side effects are permitted.

---

## 7. Trade

Implement the canonical `Trade` entity from `DATA_MODEL.md §17`.

A Trade is ARISE's conceptual trade/scout identity and is distinct from both an Attempt and a broker-facing Position.

Required fields:

- Trade ID
- Attempt ID, nullable
- Colony ID
- IdeaVersion ID
- StrategyMapVersion ID, nullable
- direction
- created timestamp
- source type

Canonical source types:

- `ARISE_AUTO`
- `ARISE_MANUAL`
- `EXTERNAL_MANUAL`
- `IMPORTED`

Do not collapse `Trade` into `Attempt` or `Position`.

Do not attach MT5 ticket/order semantics to `Trade`.

Direction must remain within existing ARISE direction vocabulary. Do not invent Bull/Bear terminology.

Where an external/manual Trade is represented, preserve source truth; never rewrite history to claim ARISE created it.

---

## 8. Position

Implement the canonical `Position` domain representation from `DATA_MODEL.md §17`.

Canonical purpose:

> Broker-facing live exposure identity represented inside the ARISE domain.

Required fields:

- Position ID
- Trade ID
- Broker Account ID
- broker position key
- original Colony ID
- current Colony ID
- direction
- original size
- current size
- entry price
- current Position state
- opened timestamp
- closed timestamp, nullable

The broker/account/key fields must be opaque domain values only. Do not import MT5-specific types.

No broker queries or commands belong in this task.

`PositionLeg` is explicitly optional in the canonical model (“use where needed”). Do not implement it in M1.2 unless it is genuinely required by the domain types/tests above. If omitted, note that in the report.

---

## 9. Position lifecycle

Implement the canonical Position states exactly as specified in `STATE_MACHINES.md`:

```text
CANDIDATE
SCOUT
SURVIVOR
PROTECTED
LEG
MATURE_LEG
RUNNER
FAILED
CLOSED
CONSOLIDATED
```

Candidate substatus vocabulary may be represented separately where useful:

- `WAITING`
- `READY`
- `ORDER_SUBMITTED`
- `FILLED`
- `EXPIRED`
- `CANCELLED`

Do not confuse Candidate substatus with Position lifecycle state.

### Canonical valid Position transitions

Implement the explicit canonical transition set:

```text
CANDIDATE → SCOUT

SCOUT → SURVIVOR
SCOUT → FAILED
SCOUT → CLOSED

SURVIVOR → PROTECTED
SURVIVOR → LEG
SURVIVOR → FAILED
SURVIVOR → CLOSED

PROTECTED → LEG
PROTECTED → MATURE_LEG
PROTECTED → CLOSED

LEG → MATURE_LEG
LEG → RUNNER
LEG → CLOSED
LEG → CONSOLIDATED

MATURE_LEG → RUNNER
MATURE_LEG → CLOSED
MATURE_LEG → CONSOLIDATED

RUNNER → CLOSED
RUNNER → CONSOLIDATED
```

Examples invalid by default include:

```text
FAILED → LEG
CLOSED → SCOUT
CONSOLIDATED → SCOUT
```

Terminal states must not reopen into active states without a new entity.

Do not add additional Position-state edges merely because they seem convenient. If a canonical gap is discovered, document it in the report.

---

## 10. Position state semantics

Preserve the canonical meanings:

### CANDIDATE
Potential participation opportunity not yet filled.

### SCOUT
Newly filled low-cost participation attempt.

### SURVIVOR
Position has demonstrated meaningful favorable evidence.

SURVIVOR does **not** imply:

- breakeven,
- protected,
- trailing,
- another Scout may be added.

### PROTECTED
Lifecycle classification indicating materially secured downside according to the assigned criterion.

This must **not** be implemented as an automatic stop-management action.

### LEG
Established campaign exposure.

### MATURE_LEG
Durable exposure that has survived sufficient structure/time/progress to be treated as higher-quality campaign exposure.

### RUNNER
Position deliberately detached from the original local exit expectation and managed under a runner policy.

### FAILED
Attempt/position failed under the strategy criteria.

### CLOSED
Broker exposure is closed.

### CONSOLIDATED
Position lineage transferred into another Colony/context while retaining history.

Do not implement consolidation orchestration yet.

---

## 11. State versus protection/management

This separation is non-negotiable.

`STATE_MACHINES.md` explicitly allows conceptual combinations such as:

```text
SURVIVOR + UNPROTECTED
SCOUT + PROTECTED
```

Therefore:

- transitioning to `SURVIVOR` must not move a stop,
- transitioning to `PROTECTED` must not issue a protection request,
- transitioning to `LEG` must not begin trailing,
- transitioning to `MATURE_LEG` must not take a partial,
- transitioning to `RUNNER` must not remove a broker TP,
- no Position transition may create broker exposure or modify broker orders.

The dedicated Protection/Management engines remain later milestones.

---

## 12. PositionStateEvent

Implement immutable Position state-transition history.

Required semantics:

- PositionStateEvent ID
- Position ID
- from state
- to state
- transition reason
- source type
- optional source ID
- occurred timestamp

Reuse the existing M1.1 transition-context conventions where appropriate rather than creating a competing event pattern.

Successful Position transition helpers should return new immutable values suitable for a future atomic persistence write.

Creating an event must not itself persist anything.

---

## 13. AttemptBudget

Implement the canonical `AttemptBudget` domain representation from `DATA_MODEL.md §21`.

Required fields:

- AttemptBudget ID
- Colony ID
- maximum Attempts, nullable
- maximum scouting loss in pips, nullable
- cooldown rule JSON/value, nullable
- reset rule JSON/value
- current period key
- updated timestamp

Do not invent percent-risk fields.

Do not implement TimeframeService, session calendars, market clocks, or structural detectors here.

Rules such as cooldown/reset may remain opaque domain rule payloads where canonical documents do not yet define a typed vocabulary.

### Pure budget evaluation

Implement pure eligibility helpers for facts that can be decided without market/broker side effects.

The evaluator may accept already-computed context such as:

- Attempts consumed in current period,
- scouting loss pips consumed in current period,
- whether cooldown is currently satisfied,
- current period key.

At minimum distinguish rejection reasons for:

- max Attempts reached,
- max scouting-loss pips reached,
- cooldown not satisfied,
- stale/mismatched period context where applicable.

Do not perform clock/session/candle calculations inside this helper.

---

## 14. StackingPolicy

Implement the canonical stacking mode vocabulary from `DATA_MODEL.md §21`:

- `ANY_VALID_ENTRY`
- `ONLY_AFTER_SURVIVOR`
- `ONLY_AFTER_PROTECTED`
- `ONLY_AFTER_LEG`
- `MANUAL`

Model a minimal explicit `StackingPolicy` domain value/entity sufficient to express the canonical fields needed now.

Canonical fields may include:

- mode
- max active Scouts
- max fresh-risk position-pips
- cooldown
- target-proximity block
- strategy-state constraints

Do not over-design versioning/orchestration for StackingPolicy in this task. If the implementation chooses a value object instead of a durable/versioned entity, document that decision in the report.

No Strategy Runtime, detector, Target monitor, or market-data implementation belongs here.

---

## 15. Pure stacking eligibility

Implement a pure deterministic evaluator, for example:

```text
evaluateStackingEligibility(policy, context)
```

The exact API/name may follow existing domain style.

The evaluator must not create a Trade, Position, Attempt, Order, or broker action. It only decides whether an additional participation attempt is currently permitted by the supplied policy/context.

Context should be passed in as already-known facts rather than fetched from infrastructure. It may include:

- active Scout count,
- fresh-risk position-pips,
- whether at least one Survivor exists,
- whether at least one qualifying Protected position exists,
- whether at least one Leg/Mature Leg/Runner exists as appropriate,
- cooldown satisfied,
- target-proximity blocked,
- strategy-state constraints satisfied,
- manual approval present/absent if modeled,
- AttemptBudget eligibility result/context.

The evaluator must produce an explicit allowed/blocked decision and deterministic reason(s).

At minimum preserve these semantics:

### `ANY_VALID_ENTRY`
May permit repeated valid participation while all caps/guards pass.

### `ONLY_AFTER_SURVIVOR`
Block additional stacking until qualifying Survivor-or-later campaign evidence exists.

### `ONLY_AFTER_PROTECTED`
Block until qualifying protection criteria/context are present.

Do **not** infer broker protection from Position lifecycle alone if the evaluator is given separate protection context.

### `ONLY_AFTER_LEG`
Block until a qualifying established Leg-or-later position exists.

### `MANUAL`
Automatic stacking request must not be allowed without explicit manual approval/context.

Global caps/guards must still apply regardless of mode.

This is policy evaluation only. Do not implement the strategy signal that calls it.

---

## 16. Pip-first numeric rules

For M1.2 domain validation:

- pip-cost values are pip-based, not R-based,
- fresh-risk position-pips are pip-derived exposure values supplied to the evaluator, not computed from live broker data here,
- no account-equity percentage sizing,
- no automatic compounding,
- no money-first assumptions.

Do not implement full derived analytics yet.

---

## 17. Parent-child invariants

Add pure validation where the canonical relationship is unambiguous.

At minimum:

- Attempt must reference a Colony.
- Trade must reference a Colony and IdeaVersion.
- a Trade linked to an Attempt must not silently claim a different Colony than that Attempt when both objects are available to a validating constructor/helper.
- Position must reference a Trade.
- Position original/current Colony IDs remain explicit.
- current Colony may later differ from original Colony because consolidation/promotion must preserve lineage/history.
- Position terminal transitions do not mutate parent Idea/Colony state.

Do not implement repository lookups inside domain validators. Cross-object checks should accept explicit domain objects as inputs when needed.

---

## 18. Required tests

Add strong domain tests. Existing M0 + M1.1 tests must remain green.

### Identity

- new IDs are opaque/stable,
- labels/sequence numbers are not IDs.

### Attempt entity

- create valid Attempt,
- positive sequence number validation,
- nullable runtime/result/completed/pip-cost semantics,
- terminal result vocabulary only,
- expired unfilled Attempt can represent `pipCost = 0`,
- invalid negative pip cost only if canonical philosophy/validation requires nonnegative cost; if this is ambiguous, do not guess—document it.

### Attempt lifecycle

Test canonical/suggested forward route:

```text
CREATED → WAITING → READY → ORDER_SUBMITTED → FILLED → SURVIVED
```

and terminal branches:

- `FILLED → FAILED`
- `FILLED → SCRATCH`
- appropriate `EXPIRED`
- appropriate `CANCELLED`
- appropriate `REJECTED`

Reject backward/reopening transitions by default.

Because the canonical document labels this lifecycle “Suggested,” do not invent extra edges without documenting them.

### Trade

- create each canonical source type,
- Attempt nullable,
- StrategyMapVersion nullable,
- IdeaVersion/Colony linkage preserved,
- immutable creation semantics.

### Position

Test canonical lifecycle edges exactly:

- Candidate→Scout,
- Scout→Survivor,
- Scout→Failed,
- Scout→Closed,
- Survivor→Protected,
- Survivor→Leg,
- Survivor→Failed,
- Survivor→Closed,
- Protected→Leg,
- Protected→Mature Leg,
- Protected→Closed,
- Leg→Mature Leg,
- Leg→Runner,
- Leg→Closed,
- Leg→Consolidated,
- Mature Leg→Runner,
- Mature Leg→Closed,
- Mature Leg→Consolidated,
- Runner→Closed,
- Runner→Consolidated.

Reject at minimum:

- Failed→Leg,
- Closed→Scout,
- Consolidated→Scout,
- Runner→Scout,
- arbitrary backward transitions.

Verify terminal states cannot reopen.

Verify prior Position object remains unchanged after transition.

Verify PositionStateEvent is immutable and contains correct from/to state, reason/source/timestamp.

### State/management separation

Tests must prove domain transition helpers do **not**:

- assign breakeven,
- move a stop,
- create TP/SL,
- create an order,
- perform stacking automatically,
- invalidate Idea/Colony after Scout failure.

### AttemptBudget

Test:

- unlimited nullable caps where applicable,
- max Attempts available vs exhausted,
- scouting-loss pip cap available vs exhausted,
- cooldown satisfied vs blocked,
- deterministic evaluation from supplied context,
- no clock/database dependency.

### StackingPolicy

Test every canonical mode:

- `ANY_VALID_ENTRY`
- `ONLY_AFTER_SURVIVOR`
- `ONLY_AFTER_PROTECTED`
- `ONLY_AFTER_LEG`
- `MANUAL`

Test independent guards:

- max active Scouts,
- max fresh-risk position-pips,
- cooldown,
- target-proximity block,
- strategy-state constraint,
- AttemptBudget block.

Verify explicit deterministic rejection reason(s).

---

## 19. Canonical ambiguities — handling rule

The canonical docs intentionally leave some areas incomplete at this stage. In particular:

1. Attempt lifecycle is labeled “Suggested,” while `Attempt` stores terminal `result` rather than a current lifecycle-state field.
2. No canonical `AttemptStateEvent` persistence entity is currently specified.
3. StackingPolicy fields are described as “may include” and versioning is recommended only if behavior becomes complex.
4. Cooldown/reset rule JSON is not yet given a complete typed vocabulary.
5. Position is described as broker-facing while the Position lifecycle includes pre-fill `CANDIDATE`.
6. Direction constraints for a Trade/Position should not be narrowed beyond the canonical ARISE vocabulary without source support.

Do not silently “fix” these by redesigning the product.

Use the smallest domain-only implementation that preserves all canonical semantics and keeps future evolution possible. Record each material choice in the final report.

Do not modify canonical docs to resolve ambiguity during M1.2.

---

## 20. M1.1 compatibility

M1.1 is frozen.

Do not change:

- Instrument semantics,
- Timeframe semantics,
- Idea/IdeaVersion lifecycle behavior,
- Colony lifecycle behavior,
- Target lifecycle behavior,
- existing identity semantics,
- M0 legacy Idea database compatibility,

unless a compile/test regression caused by M1.2 requires the smallest possible compatibility change.

No new database schema/migrations for Attempt/Trade/Position/AttemptBudget/StackingPolicy in M1.2.

Persistence belongs to M2.

---

## 21. Explicitly out of scope

Do **not** implement:

- database persistence/migrations for new M1.2 entities,
- Market Objects,
- TimeframeService,
- candle boundaries,
- quotes/market data,
- Hindsight / Area / Entry assignments,
- Strategy Encyclopedia,
- Strategy Graph,
- Strategy Runtime implementation,
- detectors,
- strategy signal generation,
- Evidence,
- Decision Trace,
- Review Scheduler,
- Watchlists,
- Economic Calendar,
- MT5 Agent or bridge,
- ExecutionIntent/OrderPlan/BrokerCommand/Order/Fill behavior,
- actual broker Position reconciliation,
- stop-loss/take-profit logic,
- breakeven / True BE,
- trailing,
- partial close,
- protection engine,
- management-policy engine,
- consolidation/promotion orchestration,
- analytics,
- new product UI.

Do not begin M1.3 or M2.

---

## 22. Acceptance criteria

M1.2 is complete only if:

1. all required new identity primitives exist,
2. Attempt and canonical result/lifecycle vocabulary exist,
3. Trade exists as a distinct conceptual identity,
4. Position and PositionStateEvent exist,
5. Position lifecycle matches the explicit canonical transition set,
6. terminal Position states cannot reopen,
7. lifecycle transitions are pure, deterministic, immutable and side-effect free,
8. Scout failure does not mutate/invalidate Idea or Colony,
9. AttemptBudget exists and can be evaluated from supplied domain facts,
10. all five canonical StackingPolicy modes exist,
11. pure stacking eligibility supports repeated participation and explicit blocking reasons,
12. state remains separate from management/protection behavior,
13. no percent-risk model is introduced,
14. no MT5/broker implementation leaks into the domain package,
15. no new database schema/migrations are added for M1.2,
16. all new domain behavior has tests,
17. all M0 tests continue passing,
18. all M1.1 tests continue passing,
19. `pnpm typecheck` passes,
20. `pnpm lint` passes,
21. `pnpm test` passes,
22. `pnpm build` passes.

Electron E2E should also be run if the environment supports GUI launch.

If no desktop/database/build infrastructure files were changed and Astra cannot launch Electron because the environment lacks a display, report that fact rather than consuming scope trying to solve it. M1.2 is a domain-only task and the frozen Windows Electron baseline already exists.

Do not begin the next milestone.

---

## 23. Deliverable

Create:

`packages/domain/M1_2_REPORT.md`

At completion, report:

1. exact files changed,
2. identity types added,
3. Attempt model and lifecycle implementation,
4. Trade model implementation,
5. Position model and exact transition table,
6. PositionStateEvent behavior,
7. AttemptBudget model/evaluator,
8. StackingPolicy model/evaluator and all supported rejection reasons,
9. tests added and total test result,
10. any compatibility changes outside `packages/domain`,
11. every canonical ambiguity encountered and the minimal implementation choice made,
12. commands run and their results,
13. any remaining blocker,
14. freeze recommendation for M1.2.

End the report with one of:

- `M1.2 FREEZE RECOMMENDED`
- `M1.2 NOT READY TO FREEZE`

Do **not** begin M1.3 or M2.
