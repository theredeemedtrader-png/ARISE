# ARISE M1.3 — Market Objects, References and Timeframe Projection

Baseline: the completed `ARISE_M1_2.zip` from this conversation, accepted as frozen by the owner. The new attachment supplies the M1.3 task, not a replacement repository. No older starter was used. The previously frozen M0/M1.1/M1.2 implementations and all 247 baseline tests remain unchanged. Historical pending-GUI notes in the M1.1 report are superseded by the owner's subsequent freeze/Windows-verification confirmation, as recorded in the M1.2 report.

The instructed canonical documents and prior reports were read before implementation. Existing specification documents remain byte-identical. The supplied task was added verbatim at `docs/ASTRA_M1_3_TASK.md`, as explicitly allowed by section 4. M2 was not started.

Continuation note: initial implementation, 427 passing tests, typecheck, lint and build were complete before interruption. On continuation, inspection found that the temporary working directory had been cleared, while validation logs and the frozen baseline remained. Completed source/tests were restored from the recorded edits in this thread, including the earlier test-only type annotations. The implementation was not redesigned. A source checkpoint was created, and the required checks were repeated against the restored deliverable. This report retains the implementation decisions and adds the restoration/verification record.

## 1. Exact files changed

Modified (additive identity declarations/exports only):

- `packages/domain/src/primitives.ts`
- `packages/domain/src/index.ts`

Added:

- `packages/domain/src/market-object-values.ts`
- `packages/domain/src/market-object.ts`
- `packages/domain/src/market-object-relation.ts`
- `packages/domain/src/market-object-reference.ts`
- `packages/domain/src/timeframe-projection.ts`
- `packages/domain/src/market-object.test.ts`
- `packages/domain/src/timeframe-projection.test.ts`
- `packages/domain/M1_3_REPORT.md`
- `docs/ASTRA_M1_3_TASK.md`

Total: **11 files: 10 domain files and the explicitly permitted task-file addition.** There are no removed files. Existing source changes do not alter the prior ID parser, timestamp parser, lifecycle graphs, factories or eligibility evaluators.

## 2. Identities added

`MarketObjectRelationId`, `TimeframeProjectionId`, and `CandleId` extend the existing `EntityId<K>` opaque branded-string mechanism. `entityId(kind, suppliedToken)` retains the caller's token exactly and rejects presentation labels using the frozen M1.1 rules. MarketObjectId and MarketObjectVersionId retain their prior types and behavior.

CandleId is only a reference: no Candle entity, data lookup, source composition, bar index conversion, ID generation, or market-data validation is introduced. Type-level tests verify branded separation and reject plain strings as typed identities. Owner/source references use `EntityId<EntityKind>` to accept existing supported entity kinds without requiring a Colony.

## 3. MarketObject model

`MarketObject` has readonly `id`, `instrumentId`, `ownerType`, `ownerId`, `geometryType`, `semanticType`, `role`, nullable `timeframeId`, `name`, `currentVersionId`, `createdAt`, and nullable `archivedAt`.

`createMarketObject(record)` validates and returns a fresh frozen, explicitly shaped current/archived snapshot. IDs and timestamps use existing domain validation; ownerType, semanticType and name require nonempty text. Supplied non-null archivedAt cannot precede original creation. The factory does not prove owner existence, delete history, scan active dependencies, infer state, or persist anything.

Current pointer consistency is established by the initial/revision pair APIs and checked when resolving the current version. A standalone hydrated record cannot prove the existence of an unsupplied version.

## 4. Geometry, semantic type and role

`MARKET_OBJECT_GEOMETRY_TYPES` is exactly LINE, RAY, RECTANGLE, TRENDLINE, POINT, CANDLE_REFERENCE and TEXT. `MarketObjectGeometryType` is its closed union.

`MARKET_OBJECT_ROLES` is exactly REFERENCE, AREA, TRIGGER, TARGET, INVALIDATION, PROTECTION, CONFIRMATION and ORIGIN. `MarketObjectRole` is its closed union.

`MARKET_OBJECT_SEMANTIC_TYPES` exposes the nine canonical examples: GENERIC_ZONE, FVG, ORDER_BLOCK, LIQUIDITY_ZONE, RANGE, PREMIUM_DISCOUNT, TARGET_ZONE, INVALIDATION_ZONE and CUSTOM. The actual semanticType remains a validated open string; future/custom keys are not restricted to those constants. Open text values are preserved, not normalized or parsed as IDs.

Geometry never implies semantics, semantics never imply role, and role never implies runtime state. Tests cover every geometry and role, all built-in semantics and a custom semantic key, including RECTANGLE + GENERIC_ZONE, RECTANGLE + FVG, FVG + REFERENCE and FVG + AREA. Nullable timeframe metadata carries no Hindsight/Area/Entry assignment.

## 5. MarketObjectVersion and deep immutability

`MarketObjectVersion` has readonly `id`, `marketObjectId`, `versionNo`, `geometryJson`, `semanticPropertiesJson`, `sourceCandleIds`, `createdAt`, nullable `supersedesVersionId`, plus the typed historical snapshot fields described in section 7 below. `sourceCandleIds` is the domain array representation of canonical `source_candle_ids_json`.

`createMarketObjectVersion(record)` validates hydrated version records and defensively copies/freezes all nested payloads. Only version 1 has null supersedes; version numbers must be positive safe integers, and self-supersession is rejected.

`MarketObjectJson` expresses readonly JSON values. `copyMarketObjectJson(value)` accepts unknown input for runtime validation, recursively copies plain objects/arrays, and freezes every container. It rejects functions, undefined, nonfinite numbers, bigint, symbol values/keys, cycles, accessors, non-enumerable object properties, exotic/class objects, array subclasses/custom prototypes, sparse arrays and all extra array properties (including hidden properties). Getters are inspected through descriptors and never executed. Plain null-prototype objects are accepted and copied to ordinary data objects. Special JSON keys such as `__proto__` are preserved as own data properties. Repeated acyclic subobjects are accepted and copied independently.

Source candles are copied to a dense frozen array of validated opaque CandleId tokens. Empty arrays are valid. Input ordering and duplicates are preserved because this task does not define source-candle set semantics or perform lookup. Neither original payloads nor caller arrays are frozen or mutated.

## 6. Exact creation/revision API and historical integrity

Public APIs:

```ts
createMarketObject(record: MarketObject): MarketObject
createMarketObjectVersion(record: MarketObjectVersion): MarketObjectVersion
createMarketObjectWithInitialVersion(input: NewMarketObject): MarketObjectWithVersion
reviseMarketObject(
  object: MarketObject,
  previous: MarketObjectVersion,
  input: MarketObjectRevision,
): MarketObjectWithVersion
validateMarketObjectVersionLink(object: MarketObject, version: MarketObjectVersion): void
```

`NewMarketObject` contains stable/current fields except currentVersionId, plus geometryJson, semanticPropertiesJson, sourceCandleIds and a caller-supplied versionId. Initial creation returns a frozen `{ marketObject, version }`, sets versionNo to 1, supersedesVersionId to null, and aligns currentVersionId with the newly created version.

`MarketObjectRevision` accepts a new version `id`, caller-supplied `createdAt`, and optional changed snapshot/payload fields. Omitted versioned fields carry forward. Explicit undefined is rejected; null can clear timeframeId. Every invocation creates a successor, including geometry-only, semantic-properties-only, metadata-only and explicitly requested unchanged-content revisions. No change-detection policy is invented.

The supplied prior version must be the object's current version, belong to that object, and agree with its mirrored current semantic fields. The successor increments versionNo exactly once, supersedes the exact prior ID, and cannot predate it. Safe-integer overflow and immediate known ID reuse are rejected. VersionNo/supersedes overrides are not revision inputs: runtime attempts to supply skipped/decremented sequences or custom supersession fail explicitly.

Only explicit versioned fields, new version identity and revision time are accepted. Revision attempts to supply instrumentId, ownerId, ownerType, marketObjectId, currentVersionId, archivedAt or other unknown/symbol/accessor fields are rejected. Stable object identity, instrument, ownership and original creation time are carried forward. Revision createdAt belongs to the new version, never the stable object's creation timestamp.

Returned current fields mirror the successor and currentVersionId advances. Prior object/version snapshots remain unchanged and independently reconstructable. All operations are pure and require supplied records; there is no persistence, clock, ID generator or mutable cache. Global uniqueness and concurrency checks across unsupplied history remain responsibilities of later application/persistence work.

## 7. Historical semantic snapshot decision

Per task section 7.4, every MarketObjectVersion stores immutable typed `geometryType`, `semanticType`, `role`, nullable `timeframeId`, and `name`, alongside geometry/semantic JSON. Current MarketObject mirrors those fields for convenience.

This explicitly resolves the short canonical version-field list's omission: a historical reference reconstructs the exact shape representation, semantic key, role, timeframe and name active in that version. A later FVG/AREA edit cannot make an old GENERIC_ZONE/REFERENCE version appear to have the new meaning. Instrument, owner and stable identity are not version-editable in this task.

## 8. MarketObjectRelation

`MarketObjectRelation` contains readonly `id`, `sourceMarketObjectId`, `targetMarketObjectId`, `relationType`, and `createdAt`. `createMarketObjectRelation(record)` validates IDs, timestamp and nonempty open relation type, returning a fresh frozen record.

Direction and all supplied identities are retained. No relation is generated automatically. No recursive traversal, cycle detection, inverse relation, cascading deletion, inferred type or ownership lookup is added. Self-relations are not arbitrarily prohibited because the open relation vocabulary supplies no universal prohibition.

## 9. FROZEN / LIVE_LINKED references and resolver

`MarketObjectReference` is an explicit discriminated union:

```ts
{ mode: 'FROZEN'; marketObjectId: MarketObjectId; versionId: MarketObjectVersionId }
| { mode: 'LIVE_LINKED'; marketObjectId: MarketObjectId }
```

`createMarketObjectReference(input)` validates and freezes the selected shape. Missing/invalid frozen version IDs and live-linked inputs carrying a versionId are rejected; nullable-ID ambiguity is not used.

`resolveMarketObjectReference(reference, marketObject, suppliedVersions)` returns a defensively copied immutable MarketObjectVersion. FROZEN selects only its exact ID; LIVE_LINKED selects only currentVersionId. Reference/object mismatch, selected version ownership mismatch, invalid selected version data, selected version predating the stable object, missing exact version and duplicate supplied matches are DomainValidationError failures. Current-version mirrored semantics must agree with the object. No available version is silently substituted.

Historical FROZEN resolution needs the historical version, not the current version record. Thus it still resolves v1 after v2 exists, even if only v1 is supplied. Live-linked resolution follows v2 after revision. Archived objects remain resolvable; active-protection warnings and orphan handling are deferred. An input collection may contain unrelated versions; only the exact requested match is selected and validated, with duplicate requested IDs rejected instead of depending on array order. There are no database/global-state dependencies.

## 10. TimeframeProjection and parent validation

`TimeframeProjection` has readonly `id`, open `sourceEntityType`, opaque `sourceEntityId`, `sourceTimeframeId`, `targetTimeframeId`, `intervalStart`, `intervalEnd`, nullable `sourceHigh`, nullable `sourceLow`, nullable `colonyId`, nullable `parentProjectionId`, and `createdAt`.

`createTimeframeProjection(record)` validates IDs, nonempty source type, immutable ISO timestamps, a strictly increasing interval, finite supplied prices, high >= low when both are present, and no self-parent. It returns a fresh frozen explicitly shaped record. Null, zero and negative prices are valid.

`validateProjectionParent(child, parent)` validates both records, requires the child's parentProjectionId to equal the supplied parent's ID, and requires child start >= parent start and child end <= parent end. Shared edges/equal containing intervals are accepted; reversed or empty intervals remain invalid.

No timeframe ordering, matching Colony policy, parent/source timeframe chain policy, recursive cycle scan, timezone, broker session, DST, week-start rule, candle boundary or bar duration is inferred. Creation time is supplied audit data, not forced to equal or follow the projected market interval. The tests retain deliberately irregular supplied timestamps unchanged and validate a three-level explicitly supplied nesting chain.

## 11. Tests added and full-suite results

**180 new tests:**

- `market-object.test.ts`: **141** tests covering opaque identity/type separation; exact vocabularies and open semantics/ownership; current/archived records; initial pointer alignment; deep copied/frozen JSON and Candle references; malformed/non-JSON data; exact successor semantics, stable identity restrictions, chronology and overflow; per-field revisions; historic snapshots; relations; explicit reference modes; pinned/live resolution; mismatches, missing versions and ambiguity failures.
- `timeframe-projection.test.ts`: **39** tests covering exact immutable fields, null/zero/negative prices, finite values/high-low ordering, timestamp and ID validation, equal/reversed intervals, self-parent rejection, contained/shared-edge children, outside children, wrong/missing parents, invalid supplied records, arbitrary timeframe identities, retained intervals and nested drill-down.

**Final full suite: 427 passed, 0 failed.**

| Suite | Passed |
| --- | ---: |
| Domain | 409 (180 new + 229 frozen) |
| Shared IPC | 8 |
| Database integration | 5 |
| Desktop IPC | 5 |
| Total | 427 |

All **247 frozen M0/M1.1/M1.2 tests** pass unchanged. Existing state-pair and participation/stacking regressions continue to verify earlier semantics. Baseline byte comparison confirms all earlier test files and implementations other than additive primitives/index exports are unchanged. New output-shape tests show no Area runtime state, timeframe-purpose assignment, broker action or UI fields. Existing architecture lint restrictions pass, and scope comparison confirms no infrastructure, persistence, charting or broker implementation was introduced.

## 12. Compatibility changes outside packages/domain

**None.** The only non-domain addition is the task Markdown file explicitly allowed by task section 4. Apps, database, charting, strategy engine, shared IPC, dependency/lockfile, root build configuration and existing canonical documents remain byte-identical to the frozen baseline. No dependency additions were needed.

## 13. Ambiguities and implementation choices

1. Semantic types are examples, not a closed universal enum: expose built-in constants and accept nonempty custom strings.
2. Owner/relation/source-entity vocabularies are unspecified: preserve validated open strings; do not invent an enum or existence lookup.
3. Short version schema omits typed semantic fields: snapshot geometry type, semantic type, role, timeframe and name as expressly required by task 7.4.
4. Shape-specific geometry schemas are undefined: accept deterministic JSON, including scalar/null payloads, without inventing chart coordinates or shape schemas.
5. Archive/delete dependency behavior is deferred: preserve archive data/history and allow references to archived objects. No warning engine, deletion behavior or blanket revision ban is invented. Revisions preserve existing archivedAt.
6. Projection boundaries belong to TimeframeService: validate supplied intervals/containment only. Same/otherwise arbitrary timeframe IDs are not prohibited; no role/order calculation is possible from opaque IDs.
7. Area runtime state lacks complete persistence/reset semantics: role AREA is static versioned meaning only; runtime lifecycle is not implemented.
8. Hindsight/Area/Entry assignments belong to StrategyMapStage: no parallel purpose model is introduced.
9. Revision input design is unspecified: accept partial versioned changes plus required new version ID/time, calculate sequence/supersession internally, reject unknown or undefined revision fields, and allow explicit no-content-change successors.
10. Global identity uniqueness/current-head concurrency cannot be established from two supplied records: reject known immediate reuse/stale current pointers; later persistence must ensure full-history uniqueness and concurrency. Hydration validates local shape; cross-record checks require supplied objects.
11. Source Candle order/duplicates are unspecified: retain exactly the dense caller-supplied array, with no sorting, deduplication, Candle entity or market-data lookup.
12. Relation self-reference/cycle semantics are unspecified for open relation types: no arbitrary graph policy is imposed. Projection self-parent is rejected as explicitly required; only immediate supplied nesting is checked.
13. Resolver collection shape is unspecified: accept an array of supplied versions, select the exact requested identity, reject duplicate requested matches, and never fetch/substitute missing data. Unrelated collection records are not resolved.
14. Projection audit-time versus interval chronology, price positivity and cross-timeframe/Colony constraints are unspecified: validate only specified timestamps, finite price ordering and containment; preserve general-instrument zero/negative prices.
15. Unknown imported record fields are not canonical: hydration returns only declared fields. Revision inputs are stricter and explicitly reject unknown fields so stable identity/ownership rewrite attempts cannot be silently accepted.
16. Frozen M1.2 JSON helper does not need alteration: a Market-Object-specific helper enforces this task's stronger complete array-property rejection without changing frozen participation-rule semantics.

No conflict required broadening scope or changing an earlier milestone.

## 14. Commands run and results

Commands used the repository's pinned **pnpm 10.15.0**, invoked as `npm exec --yes --package=pnpm@10.15.0 -- pnpm ...`.

| Command/check | Result |
| --- | --- |
| Local ZIP inspection, canonical document reads and baseline extraction | Completed; frozen M1.2 baseline confirmed |
| `pnpm install --frozen-lockfile` | Passed initially and after restoring temporary files; lockfile unchanged |
| `pnpm exec prettier --write` on the seven new TypeScript files | Passed; no unrelated formatting |
| `pnpm --filter @arise/domain typecheck` (initial) | Found two deliberately invalid test inputs needing explicit test-only annotations; corrected |
| `pnpm --filter @arise/domain test` | 409 passed, 0 failed |
| `pnpm exec prettier --write packages/domain/src/market-object.test.ts` | Passed after annotation corrections |
| `pnpm check` | Passed initially and after restoration: full repository typecheck, lint and all 427 tests |
| `pnpm typecheck` | Passed through `pnpm check`, including Desktop/main/preload/test TypeScript configurations |
| `pnpm lint` | Passed through `pnpm check`, including domain import restrictions |
| `pnpm test` | Passed through `pnpm check`: 427 tests, 0 failed |
| `pnpm build` | Passed initially and after restoration across packages and Electron main/preload/renderer production build |
| Baseline byte/scope comparison | Passed: only listed allowed changes; all frozen tests/specs/infrastructure unchanged |
| GUI capability inspection | DISPLAY unset; Xvfb unavailable |
| `pnpm test:e2e` | Not run: environment lacks a display; section 19 permits this for the unchanged Desktop/database/build foundation |
| Source checkpoint, final ZIP creation and integrity comparison | Passed; source/report/task included, dependencies/build outputs excluded |

The initial typecheck issue was confined to test annotations for intentionally invalid runtime input. No production fix or frozen-code change was needed. The final full check passes. Revalidation after restoration was necessary to verify the actual delivered files following the environment reset, not to reopen a completed milestone.

## 15. Remaining blockers

No remaining M1.3 implementation or acceptance blocker. Electron E2E could not be run in this display-less environment; the task explicitly permits this and no Desktop/database/build infrastructure changed. No Linux GUI infrastructure work was attempted. Later charts, persistence, market data, TimeframeService, runtime, evidence and broker behavior remain intentionally outside this milestone.

## 16. M1.3 and overall M1 freeze recommendation

All 31 M1.3 acceptance criteria are satisfied, with the permitted GUI exception and the explicit bounded interpretation of global identity/concurrency checks. Typecheck, lint, production build, all 180 new tests and all 247 frozen tests pass.

**Recommend freezing M1.3 and the overall M1 Domain milestone as scoped by the accepted M1.1, M1.2 and M1.3 tasks.** The new static Market Object/reference/projection foundation is complete; later runtime, persistence, charting, market-data and execution responsibilities remain deferred exactly as directed. This is a domain-milestone freeze recommendation, not a claim of broker-execution readiness. M0/M1.1/M1.2 remain frozen. M2 has not begun.

M1.3 FREEZE RECOMMENDED
