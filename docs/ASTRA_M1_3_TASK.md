# ARISE — ASTRA_M1_3_TASK.md

**Milestone:** M1 — Domain Model + State Machines  
**Task:** M1.3 — Market Objects + Versioned References + Timeframe Projection  
**Baseline:** M1.2 frozen and accepted  
**Status:** Implementation task  

---

## 1. Context

ARISE M0, M1.1 and M1.2 are frozen.

M1.1 established the foundational domain identities and the Instrument, Timeframe, Idea/IdeaVersion, Colony/lineage/state events, and Target/TargetEvent models.

M1.2 established Attempt, Trade, Position/PositionStateEvent, AttemptBudget and StackingPolicy/eligibility.

Do not redesign or reopen those milestones.

This task finishes the **static chart/thesis domain foundation** needed before persistence and UI work by implementing canonical Market Objects, immutable Market Object versions, relations, frozen/live-linked references, and Timeframe Projection records.

This remains a **pure domain task**. It does not implement charts, drawing interaction, TimeframeService, market data, strategy runtime, persistence, or broker behavior.

Do not begin M2 or any later milestone.

---

## 2. Read first

Before editing code, read these canonical files in this order:

1. `docs/ASTRA_INSTRUCTIONS.md`
2. `docs/DATA_MODEL.md`
3. `docs/ARCHITECTURE.md`
4. `docs/PRODUCT_SPEC.md`
5. `docs/STATE_MACHINES.md`
6. `docs/STRATEGY_ENGINE.md`
7. `docs/EVIDENCE_SYSTEM.md`
8. `docs/PROTECTION_SPEC.md`
9. `docs/TEST_PLAN.md`
10. `packages/domain/M1_1_REPORT.md`
11. `packages/domain/M1_2_REPORT.md`

The current task requirements override canonical docs only where this task explicitly resolves an ambiguity.

Do not modify canonical product/specification documents during M1.3.

---

## 3. Objective

Implement and test the pure domain model for:

1. additional opaque identity primitives required by this task,
2. `MarketObject`,
3. immutable `MarketObjectVersion`,
4. Market Object revision helpers,
5. `MarketObjectRelation`,
6. explicit frozen vs live-linked Market Object references,
7. deterministic reference resolution from supplied domain objects,
8. `TimeframeProjection`,
9. pure parent/nesting validation where it can be established without TimeframeService.

The implementation must preserve the central invariant:

> **Drawing tools define geometry. Market Object properties define meaning.**

A rectangle is not automatically an FVG.

An FVG is not automatically an Area.

A Market Object is canonical domain data, not a chart-library annotation.

---

## 4. Files allowed

Primary allowed scope:

- `packages/domain/**`

You may modify existing domain files only where necessary to add identities/exports or reuse domain helpers without changing frozen M1.1/M1.2 semantics.

Do not modify:

- `apps/**`
- `packages/database/**`
- `packages/charting/**`
- `packages/strategy-engine/**`
- `packages/shared/**`
- root build/dependency configuration
- canonical `/docs` other than adding this task file if it is not already present

No dependency additions.

If an unexpected compatibility issue appears outside `packages/domain`, stop and report it rather than broadening scope.

---

## 5. Identity primitives

Extend the existing branded opaque identity system with only the identities required for M1.3:

- `MarketObjectRelationId`
- `TimeframeProjectionId`
- `CandleId` as an **opaque reference only**

`MarketObjectId` and `MarketObjectVersionId` already exist and must retain their M1.1 semantics.

Do not implement the Candle entity or market-data model in this task.

IDs remain caller-supplied opaque tokens. Do not generate IDs, parse labels into IDs, or use names as identity.

---

## 6. MarketObject

Implement the canonical stable semantic identity.

Required fields:

```text
market_object_id
instrument_id
owner_type
owner_id
geometry_type
semantic_type
role
timeframe_id nullable
name
current_version_id
created_at
archived_at nullable
```

Use established TypeScript naming conventions already present in the domain package.

### 6.1 Geometry types

Use this exact canonical vocabulary:

- `LINE`
- `RAY`
- `RECTANGLE`
- `TRENDLINE`
- `POINT`
- `CANDLE_REFERENCE`
- `TEXT`

Geometry type means **shape representation only**.

It must not infer semantic meaning.

### 6.2 Semantic type

Canonical docs give examples, not a closed universal enum.

Expose constants for canonical built-in examples where useful:

- `GENERIC_ZONE`
- `FVG`
- `ORDER_BLOCK`
- `LIQUIDITY_ZONE`
- `RANGE`
- `PREMIUM_DISCOUNT`
- `TARGET_ZONE`
- `INVALIDATION_ZONE`
- `CUSTOM`

But do **not** prevent future/custom semantic keys merely because they are not in that list.

`semanticType` should therefore remain a validated nonempty semantic key/string rather than a permanently closed union.

### 6.3 Role

Use this canonical closed vocabulary:

- `REFERENCE`
- `AREA`
- `TRIGGER`
- `TARGET`
- `INVALIDATION`
- `PROTECTION`
- `CONFIRMATION`
- `ORIGIN`

Role is separate from semantic type.

Examples that must remain valid conceptually:

```text
semanticType = FVG
role = AREA
```

and

```text
semanticType = FVG
role = REFERENCE
```

No semantic-type-to-role inference.

### 6.4 Owner

`ownerType` is an open validated semantic key because the canonical docs do not define a complete owner-type enum.

`ownerId` is an opaque referenced entity ID token.

Do not hard-code ownership to Colony only. Market Objects may later belong to other supported contexts.

Do not query repositories to prove owner existence.

### 6.5 Timeframe

`timeframeId` is nullable.

Do not infer HINDSIGHT / AREA / ENTRY purpose from the timeframe or from the Market Object role.

Do not call or implement TimeframeService.

### 6.6 Archive field

`archivedAt` is nullable domain data.

M1.3 does not implement deletion/orphan-warning orchestration or active-dependency scans.

Do not silently delete historical versions.

---

## 7. MarketObjectVersion

Implement an immutable revision object.

Canonical required fields:

```text
market_object_version_id
market_object_id
version_no
geometry_json
semantic_properties_json
source_candle_ids_json
created_at
supersedes_version_id nullable
```

### 7.1 Deep immutability

`geometryJson` and `semanticPropertiesJson` must accept JSON-compatible domain data only and must be defensively copied/deep-frozen.

Reject at minimum:

- functions,
- `undefined`,
- non-finite numbers,
- cyclic structures,
- accessors/symbol keys,
- non-plain objects that cannot be treated as deterministic JSON,
- sparse arrays or extra array properties.

Do not depend on browser structured-clone APIs or mutable chart-library objects.

It is acceptable to implement a Market-Object-specific immutable JSON helper rather than refactor frozen M1.2 helpers merely for code deduplication.

### 7.2 Source Candle references

Represent source candles as immutable opaque `CandleId` references.

Do not implement Candle data or validate market-data existence.

No volatile chart bar indexes may be used as canonical candle identity.

### 7.3 Version rules

Provide deterministic helpers for:

- initial version `versionNo = 1`, `supersedesVersionId = null`,
- successor version increments exactly by one,
- successor `supersedesVersionId` equals the prior version ID,
- prior version remains unchanged,
- version records are immutable.

Reject skipped/decremented version sequences when a successor helper is used.

Creation timestamps for a successor may not precede the prior version creation timestamp.

### 7.4 Geometry and semantic revisions

Both geometry changes **and semantic changes** must result in a new MarketObjectVersion when using the revision helper.

This task explicitly resolves a canonical modeling ambiguity:

`MarketObjectVersion` must preserve enough typed snapshot information to reconstruct the semantics that were active for that version, not merely raw geometry.

Therefore the implementation may include immutable snapshot fields on `MarketObjectVersion` for the current versioned presentation/semantic metadata, at minimum:

- geometry type,
- semantic type,
- role,
- timeframe ID nullable,
- name.

These snapshot fields are in addition to the canonical JSON payload fields and exist to satisfy the historical-integrity invariant that exact historical Market Object semantics must be reconstructable.

The stable `MarketObject` may mirror the **current** version's values for convenient current-state access.

When a revision changes any of these versioned values, the returned current MarketObject snapshot must update consistently with the new version while the prior MarketObject/Version objects remain unchanged.

Do not mutate an old MarketObjectVersion in place.

### 7.5 What is not versioned here

Do not invent policy for changing:

- instrument identity,
- owner identity,
- stable MarketObject identity,
- historical creation timestamp.

If a caller attempts to use the revision helper to rewrite stable identity/ownership, reject it or design the helper so those values are not accepted as revision inputs.

---

## 8. Market Object creation/revision API

Use pure deterministic factories/helpers.

A clean API may resemble:

```text
createMarketObjectWithInitialVersion(...)
reviseMarketObject(...)
```

or equivalent names consistent with the package.

The initial factory should make it difficult to construct an object whose `currentVersionId` points at an unrelated version.

The revision helper should return both:

```text
updated MarketObject snapshot
new immutable MarketObjectVersion
```

without persistence or side effects.

The exact function names are an implementation choice; document them in the report.

Factories may additionally expose validation helpers for imported/hydrated records if useful.

---

## 9. MarketObjectRelation

Implement the canonical relation record.

Fields:

```text
relation_id
source_market_object_id
target_market_object_id
relation_type
created_at
```

`relationType` remains an open validated semantic key because no canonical closed vocabulary is specified.

Do not invent graph orchestration, recursive traversal, deletion behavior, or automatic relation generation.

Do not infer relation type from geometry or role.

---

## 10. Frozen vs live-linked references

ARISE explicitly distinguishes:

### FROZEN
References a specific `MarketObjectVersion`.

Later edits to the Market Object must not alter what this reference resolves to.

### LIVE_LINKED
References the stable `MarketObject` identity and follows its current version.

Implement an explicit domain type such as:

```text
MarketObjectReference =
  FROZEN(...)
  | LIVE_LINKED(...)
```

or equivalent discriminated union.

Do not represent these two modes using a nullable version ID without an explicit mode discriminator.

### 10.1 Pure resolver

Implement deterministic reference resolution from domain objects supplied by the caller.

The resolver must not query a database.

Required semantics:

- FROZEN reference resolves only its exact version.
- LIVE_LINKED reference resolves the MarketObject's `currentVersionId`.
- a frozen historical reference continues to resolve the old version after a successor exists,
- a live-linked reference resolves the new current version after revision,
- reference/object/version identity mismatches are rejected explicitly,
- missing supplied versions are errors/explicit failures, never silently substituted.

Do not implement active-protection edit warnings yet; that belongs to later application/protection orchestration.

---

## 11. TimeframeProjection

Implement the canonical projection domain record.

Fields:

```text
projection_id
source_entity_type
source_entity_id
source_timeframe_id
target_timeframe_id
interval_start
interval_end
source_high nullable
source_low nullable
colony_id nullable
parent_projection_id nullable
created_at
```

This record represents a semantic time-container projection between timeframes for chart drill-down/evidence.

### 11.1 Validation

At minimum validate:

- IDs and semantic keys,
- timestamps,
- `intervalEnd` is strictly after `intervalStart`,
- nullable prices are finite when present,
- if both `sourceHigh` and `sourceLow` are present, high must be >= low,
- `parentProjectionId` may not equal the projection's own ID.

Do not assume Forex-only positive prices.

Do not infer source/target timeframe ordering from display labels or duration alone.

Do not calculate candle boundaries.

### 11.2 Parent/nesting validation

Provide a pure helper that can validate an explicitly supplied parent projection without TimeframeService.

At minimum it should verify:

- child's `parentProjectionId` refers to the supplied parent's ID,
- child interval is contained within the parent interval.

Do not invent broker session boundaries, week starts, DST logic or D/W/M calendar behavior.

The canonical TimeframeService will own those calculations later.

---

## 12. Area lifecycle is intentionally deferred

Although `AREA` is a Market Object role and `STATE_MACHINES.md` defines an Area runtime lifecycle, **do not implement Area runtime state in M1.3**.

Reason:

- a Market Object's semantic role is static/versioned domain meaning,
- `DORMANT → WATCHING → APPROACHING → TOUCHED → ARMED → ACTIVE` is operational runtime state,
- the canonical docs do not yet define an Area persistence entity/event model or complete re-arm/reset transition table.

Area runtime state belongs with Strategy Runtime/market evaluation work later.

Do not make `role = AREA` automatically imply `ARMED`, `ACTIVE`, or entry permission.

---

## 13. Hindsight / Area / Entry timeframe purposes are intentionally deferred

Do not add a parallel standalone timeframe-purpose assignment model in M1.3.

The canonical data model places:

- `purpose_hindsight`,
- `purpose_area`,
- `purpose_entry`,
- importance,
- execution mode

inside `StrategyMapStage`.

That belongs to the later Strategy Map milestone.

Preserve the invariant now:

> Any timeframe may later have HINDSIGHT, AREA, ENTRY, combinations, or none.

Do not hard-code Weekly/4H/5M mappings.

---

## 14. Market data is intentionally deferred

Do not implement:

- Candle entity,
- QuoteSnapshot,
- EconomicEvent,
- MT5 feed,
- TimeframeService,
- bar aggregation,
- price-touch/cross logic,
- zone-entry detection,
- source candle lookup.

Only the opaque Candle identity needed by MarketObjectVersion is in scope.

---

## 15. Historical-integrity invariants

Tests and implementation must demonstrate:

1. MarketObject identity remains stable across revision.
2. Every revision produces a new MarketObjectVersion ID supplied by the caller.
3. Version number increments exactly by one through the successor helper.
4. New version supersedes the exact prior version.
5. Prior object/version snapshots are unchanged.
6. Geometry JSON is immutable.
7. Semantic-properties JSON is immutable.
8. Versioned semantic snapshot values remain reconstructable historically.
9. Current MarketObject pointer mirrors the new version after revision.
10. Frozen references remain pinned to old versions.
11. Live-linked references follow the current version.
12. No chart/UI/library state is stored in domain objects.

---

## 16. Required tests

Add strong domain tests. All 247 frozen M0/M1.1/M1.2 tests must continue passing.

### 16.1 Identity

Test:

- `MarketObjectRelationId`
- `TimeframeProjectionId`
- opaque `CandleId`
- identity types cannot be substituted at TypeScript level where existing compile-time patterns permit testing,
- labels are not IDs.

### 16.2 MarketObject creation

Test:

- each geometry type,
- each canonical role,
- canonical semantic examples,
- custom semantic key remains allowed,
- owner type/key validation,
- nullable timeframe,
- archived/current records validate,
- no semantic inference from geometry,
- no role inference from semantic type.

Explicitly prove a RECTANGLE can be `GENERIC_ZONE`, `FVG`, etc., and an FVG can have roles such as REFERENCE or AREA.

### 16.3 Initial MarketObjectVersion

Test:

- version 1,
- null supersedes,
- currentVersion pointer alignment,
- immutable source candle IDs,
- geometry and semantic JSON deep immutability,
- invalid JSON values rejected.

### 16.4 Successor revision

Test:

- v1 → v2,
- exact increment,
- exact supersedes linkage,
- prior version unchanged,
- prior MarketObject snapshot unchanged,
- current pointer updates,
- geometry-only revision creates new version,
- semantic-properties-only revision creates new version,
- role revision creates new version,
- semantic-type revision creates new version,
- timeframe/name revision creates new version,
- stable identity/owner/instrument are not silently rewritten.

### 16.5 MarketObjectRelation

Test:

- relation creation,
- source/target IDs preserved,
- open semantic relation type,
- immutability,
- no automatic relation behavior.

### 16.6 References

Test:

- FROZEN resolves exact v1,
- after v2 creation, FROZEN still resolves v1,
- LIVE_LINKED initially resolves v1,
- after revision, LIVE_LINKED resolves v2,
- mismatched MarketObject ID rejected,
- mismatched MarketObjectVersion ownership rejected,
- missing version explicitly fails,
- resolver has no database/global-state dependency.

### 16.7 TimeframeProjection

Test:

- valid projection,
- nullable source prices,
- valid zero/negative prices,
- high >= low validation,
- reversed/equal interval rejected,
- self-parent rejected,
- valid child contained within parent,
- child outside parent rejected,
- wrong parent ID rejected,
- no candle-boundary computation or timeframe-role inference.

### 16.8 Regression/invariant tests

Prove M1.3 does not:

- alter Idea/Colony/Target transitions,
- alter Attempt/Trade/Position semantics,
- alter stacking eligibility,
- implement broker behavior,
- implement UI/chart-library types,
- implement persistence,
- infer Hindsight/Area/Entry,
- infer an Area runtime state from `role = AREA`.

---

## 17. Canonical ambiguities and required handling

Document every material ambiguity encountered.

Known ambiguities include:

1. `semantic_type` is presented with examples rather than a closed global enum.
   - Required M1.3 choice: allow validated custom semantic keys while exposing canonical built-in constants.

2. `owner_type` and relation type have no complete canonical vocabulary.
   - Required choice: validated open semantic keys.

3. Canonical MarketObject stores current semantic fields while MarketObjectVersion's short field list does not explicitly repeat them, yet historical-integrity rules require exact geometry/semantics to be reconstructable and tests say semantic updates create versions.
   - Required choice: snapshot current versioned semantic/presentation fields inside MarketObjectVersion as specified in section 7.4.

4. Geometry JSON schemas are not yet defined for each drawing shape.
   - Required choice: preserve deterministic immutable JSON without inventing chart-library coordinate schemas.

5. Deletion/archive behavior with active dependencies requires warnings later.
   - Required choice: model archive data only; do not implement active-dependency orchestration.

6. TimeframeProjection boundaries ultimately require TimeframeService.
   - Required choice: validate supplied intervals only; do not calculate them.

7. Area runtime state exists canonically but has no complete persistence/reset model yet.
   - Required choice: defer it as stated in section 12.

Do not edit canonical docs to hide these ambiguities.

---

## 18. Explicitly out of scope

Do **not** implement:

- database migrations/persistence for M1.3 entities,
- chart renderer or drawing UI,
- Lightweight Charts integration,
- chart workspaces/layers,
- pixel/screen coordinates tied to a chart library,
- TimeframeService,
- bar aggregation,
- Candle/Quote/EconomicEvent entities,
- Hindsight/Area/Entry assignments,
- StrategyMapStage,
- Strategy Encyclopedia,
- Strategy Graph,
- Strategy Runtime,
- Area runtime lifecycle,
- detectors,
- Evidence/Decision Trace,
- documents/backlinks,
- Review Scheduler,
- Watchlists,
- calendar providers,
- MT5 Agent,
- ExecutionIntent/OrderPlan/Order/Fill,
- protection engine,
- management policies,
- broker reconciliation,
- analytics,
- UI work.

Do not begin M2.

---

## 19. Acceptance criteria

M1.3 is complete only if:

1. required new opaque IDs exist,
2. MarketObject exists with canonical stable/current fields,
3. geometry type and role vocabularies are correct,
4. semantic type supports canonical built-ins plus future/custom keys,
5. MarketObjectVersion is immutable and deeply freezes JSON payloads,
6. initial version semantics are deterministic,
7. successor version semantics increment/supersede exactly,
8. geometry revisions produce a new version,
9. semantic revisions produce a new version,
10. exact historical semantic snapshot is reconstructable,
11. prior object/version values remain unchanged,
12. current MarketObject points to the successor after revision,
13. MarketObjectRelation exists,
14. FROZEN and LIVE_LINKED references are distinct explicit modes,
15. frozen historical reference remains pinned after revision,
16. live-linked reference follows the current version,
17. reference identity mismatches fail explicitly,
18. TimeframeProjection exists and validates supplied intervals,
19. parent-projection containment validation is pure,
20. no TimeframeService/boundary calculation is introduced,
21. no Area runtime state is inferred from Market Object role,
22. no Hindsight/Area/Entry timeframe mapping is introduced,
23. no chart-library types leak into domain,
24. no persistence/database work is added,
25. no broker/MT5 work is added,
26. all new behavior has tests,
27. all 247 frozen tests continue passing,
28. `pnpm typecheck` passes,
29. `pnpm lint` passes,
30. `pnpm test` passes,
31. `pnpm build` passes.

Electron E2E should be run only if the environment supports it.

If no Desktop/database/build infrastructure changed and Astra cannot launch Electron because the environment lacks a display, report that fact. Do not spend scope solving Linux GUI infrastructure for this domain-only task.

---

## 20. Deliverable

Create:

`packages/domain/M1_3_REPORT.md`

At completion report:

1. exact files changed,
2. identities added,
3. MarketObject model,
4. geometry/semantic/role handling,
5. MarketObjectVersion model and deep-immutability behavior,
6. exact revision/versioning API and historical-integrity behavior,
7. semantic snapshot decision from section 7.4,
8. MarketObjectRelation model,
9. FROZEN/LIVE_LINKED reference model and resolver,
10. TimeframeProjection model and parent validation,
11. tests added and full-suite count/result,
12. compatibility changes outside `packages/domain` if any,
13. every ambiguity encountered and implementation choice,
14. commands run and results,
15. remaining blockers,
16. recommendation on whether M1.3 and the overall M1 Domain milestone are ready to freeze.

End the report with exactly one of:

- `M1.3 FREEZE RECOMMENDED`
- `M1.3 NOT READY TO FREEZE`

Do not begin M2.
