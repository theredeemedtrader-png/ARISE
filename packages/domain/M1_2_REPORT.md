# ARISE M1.2 — Participation Domain

Baseline: `ARISE_M1_1.zip` from the completed prior handoff in this conversation. The owner and the supplied `ASTRA_M1_2_TASK(1).md` confirm M1.1 is frozen and Windows-verified, including all 116 tests and Electron E2E. That confirmation supersedes the historical pending-GUI note in the unchanged M1.1 report.

The newly uploaded attachment contains the M1.2 task, not another repository archive. It was executed against the completed M1.1 archive, not the older M1.1 starter. Canonical docs were read first and remain unchanged. No M1.3 or M2 work was started.

## 1. Exact files changed

Modified:

- `packages/domain/src/primitives.ts` — extends the existing identity-kind union and adds eight identity aliases; existing ID parsing and timestamp behavior are unchanged.
- `packages/domain/src/index.ts` — exports new domain modules.

Added:

- `packages/domain/src/participation-values.ts` — opaque broker key, numeric/boolean guards, immutable JSON rule copying and decision value helpers.
- `packages/domain/src/attempt.ts` — Attempt record, result vocabulary and separate pure lifecycle validator.
- `packages/domain/src/trade.ts` — Trade and explicit parent/provenance validation.
- `packages/domain/src/position.ts` — Position exposure record, exact lifecycle graph and immutable state events.
- `packages/domain/src/attempt-budget.ts` — AttemptBudget and evaluator.
- `packages/domain/src/stacking.ts` — StackingPolicy and evaluator.
- `packages/domain/src/participation-fixtures.ts` — deterministic fixtures shared by the two new test suites.
- `packages/domain/src/participation.test.ts` — 74 identity/entity/lifecycle/history tests.
- `packages/domain/src/eligibility.test.ts` — 57 rule/budget/stacking tests.
- `packages/domain/M1_2_REPORT.md` — this report.

Total: 12 files, all within `packages/domain`. Byte comparisons against the baseline verify all prior tests, canonical docs, M1.1 lifecycle implementations, database files, renderer/main/preload files, build configuration and dependency files remain unchanged.

## 2. Identity types added

`AttemptId`, `TradeId`, `PositionId`, `PositionStateEventId`, `AttemptBudgetId`, `StrategyRuntimeId`, `StrategyMapVersionId` and `BrokerAccountId` reuse M1.1's branded opaque string identity mechanism. Callers supply stable IDs; the domain does not generate IDs, convert sequence numbers to IDs, query a database, or use labels as identity.

`BrokerPositionKey` is a separately branded provider-owned string. Its parser checks nonempty text but does not normalize or parse provider syntax as an MT5 ticket. Provenance/uniqueness remain caller responsibilities. It is not interchangeable with PositionId or BrokerAccountId.

## 3. Attempt model and lifecycle

Attempt contains exactly: id, colonyId, nullable strategyRuntimeId, sequenceNo, startedAt, nullable completedAt, nullable result and nullable pipCost. Creation accepts an explicit Colony and derives its ID. The caller supplies a positive safe-integer sequence number, scoped to that Colony; uniqueness requires later persistence.

Result vocabulary is exactly EXPIRED, FAILED, SCRATCH and SURVIVED. A non-null terminal result requires completedAt, which cannot precede startedAt. An unfilled expired Attempt can record zero pip cost. A completed record may have null result to avoid inventing a result for CANCELLED or REJECTED. Pip cost may be null or a finite signed number because no canonical sign convention exists; no abs(), R conversion or account-percent calculation is performed.

AttemptState and `transitionAttemptState` are separate from the stored record. No persisted state field or AttemptStateEvent entity was invented. The following explicit defaults implement the suggested lifecycle:

| From | Allowed destinations |
| --- | --- |
| CREATED | WAITING, EXPIRED, CANCELLED |
| WAITING | READY, EXPIRED, CANCELLED |
| READY | ORDER_SUBMITTED, EXPIRED, CANCELLED |
| ORDER_SUBMITTED | FILLED, EXPIRED, CANCELLED, REJECTED |
| FILLED | SURVIVED, FAILED, SCRATCH |
| SURVIVED, FAILED, SCRATCH, EXPIRED, CANCELLED, REJECTED | None |

Self-transitions, backward transitions, skipped forward stages and terminal reopenings are rejected. This validator neither updates Attempt.result nor submits/cancels an order.

## 4. Trade model

Trade preserves its own ID, nullable Attempt ID, Colony ID, exact IdeaVersion ID, nullable StrategyMapVersion ID, direction, creation time and source type. All four canonical sources are supported without rewriting provenance: ARISE_AUTO, ARISE_MANUAL, EXTERNAL_MANUAL and IMPORTED. LONG, SHORT and NEUTRAL remain accepted.

Creation validates supplied Colony/IdeaVersion/Attempt objects. The IdeaVersion must belong to the Colony's Idea, and an attached Attempt must belong to the same Colony. A successor IdeaVersion may be referenced explicitly; the factory never substitutes the Colony's original version. Creation time cannot precede supplied parent creation/start/version times. No countertrend permission policy or strategy-map implementation is inferred.

## 5. Position model and exact transition table

The exposure record preserves id, tradeId, brokerAccountId, brokerPositionKey, originalColonyId, currentColonyId, direction, originalSize, currentSize, entryPrice, currentState, openedAt and nullable closedAt. Creation takes a Trade and derives original Colony, Trade identity and direction. Current Colony remains explicit and may differ from the original; the factory does not perform promotion or rewrite Trade history.

Original size must be finite and positive; current size finite and nonnegative. No current-size-versus-original-size upper bound is imposed because the task does not define netting/add-to-position semantics. Entry price is finite, including zero/negative values for general instruments. Times are M1.1 immutable ISO timestamps.

The pure PositionState graph contains all ten canonical states and exactly these 20 edges:

| From | Allowed destinations |
| --- | --- |
| CANDIDATE | SCOUT |
| SCOUT | SURVIVOR, FAILED, CLOSED |
| SURVIVOR | PROTECTED, LEG, FAILED, CLOSED |
| PROTECTED | LEG, MATURE_LEG, CLOSED |
| LEG | MATURE_LEG, RUNNER, CLOSED, CONSOLIDATED |
| MATURE_LEG | RUNNER, CLOSED, CONSOLIDATED |
| RUNNER | CLOSED, CONSOLIDATED |
| FAILED, CLOSED, CONSOLIDATED | None |

CANDIDATE is supported by `transitionPositionState` and PositionStateEvent. An actual Position exposure record uses `ExposurePositionState`, excluding CANDIDATE, because the canonical record requires actual opening/broker facts that do not yet exist pre-fill. This avoids inventing nullable persisted broker fields or fake tickets/prices. Later orchestration can validate CANDIDATE→SCOUT and create the exposure record from observed facts. No Candidate substatus or PositionLeg implementation was needed.

`transitionPosition` returns a new frozen Position and event. It never changes quantity, entry price, broker identity or Colony lineage. To declare CLOSED, the supplied Position must already report currentSize = 0; the helper records the caller-supplied occurredAt as closedAt. It cannot manufacture a broker close by zeroing size. FAILED and CONSOLIDATED do not imply zero exposure or set closedAt. Their broker exposure may later be reported closed independently of lifecycle; their lifecycle remains terminal.

## 6. PositionStateEvent

The immutable event contains id, positionId, fromState, toState and the existing M1.1 TransitionContext: reason, sourceType, nullable sourceId, occurredAt, manualOverride and nullable correlationId. Factories validate IDs, exact graph edges and audit metadata. Manual-override metadata never bypasses the graph.

Event creation performs no persistence. Position transitions return `{ position, event }` for future atomic writes. Prior Position, Trade, Attempt, Colony and Idea objects remain untouched. State changes do not assign BE, move stops, set/remove TP, place orders, stack, take partials, or invalidate parents.

## 7. AttemptBudget model and evaluator

AttemptBudget contains id, colonyId, nullable maxAttempts, nullable maxScoutingLossPips, nullable cooldownRule, required resetRule, currentPeriodKey and updatedAt. Caps are nonnegative, maxAttempts is an integer, null means unlimited and zero means exhausted. Rule payloads are opaque JSON values, copied recursively and frozen; functions, undefined, nonfinite numbers, accessors, sparse arrays, cycles and non-JSON objects are rejected.

`evaluateAttemptBudget` accepts supplied Colony/period identity, consumed Attempt count, nonnegative scouting-loss consumption and a cooldown-satisfied fact. It neither computes calendar boundaries nor resets/increments counters. Cooldown is enforced only when configured. The returned frozen decision includes allowed, reasons, budgetId, colonyId and periodKey.

Supported budget reasons, in deterministic order:

1. `COLONY_CONTEXT_MISMATCH`
2. `PERIOD_CONTEXT_MISMATCH`
3. `MAX_ATTEMPTS_REACHED`
4. `MAX_SCOUTING_LOSS_PIPS_REACHED`
5. `BUDGET_COOLDOWN_NOT_SATISFIED`

Equality with either cap blocks another attempt. All applicable reasons are retained. Malformed facts fail with DomainValidationError rather than being coerced to permit participation.

## 8. StackingPolicy, evaluator and rejection reasons

StackingPolicy is a small immutable value object, with mode, nullable maxActiveScouts, nullable maxFreshRiskPositionPips, nullable cooldownRule, targetProximityBlock and nullable strategyStateConstraints. No durable ID/version architecture is added.

| Mode | Evidence/approval required |
| --- | --- |
| ANY_VALID_ENTRY | No mode-specific evidence; all global guards still pass |
| ONLY_AFTER_SURVIVOR | Explicit hasSurvivorOrLater fact |
| ONLY_AFTER_PROTECTED | Explicit hasQualifyingProtection fact |
| ONLY_AFTER_LEG | Explicit hasLegOrLater fact |
| MANUAL | Explicit manualApproval |

`evaluateStackingEligibility` receives a Colony ID and already-known facts. It never detects an entry, calls a runtime, creates an Attempt/Trade/Position or issues a broker action. It accepts explicit entry validity and participation permission (the higher layer's thesis/Area/session guard), counts/risk, evidence, cooldown, proximity, strategy-constraint satisfaction and optional budget+budget context.

Qualifying protection is independent from lifecycle labels and Survivor/Leg evidence: even a lifecycle label of PROTECTED cannot substitute for the supplied protection fact. Conversely, a Scout can qualify via independent protection facts. Mode approval never bypasses global guards.

Fresh risk is checked against both existing and proposed additional position-pips. Existing risk at/above the cap blocks; a proposal that exceeds the cap blocks; a proposal exactly reaching the cap from below is allowed. Scout count is evaluated for one additional participation: count below the cap is available, count at/above it is blocked. Null caps are unlimited; zero caps block. Cooldown, target proximity and strategy constraints apply when configured.

The optional AttemptBudget is evaluated directly rather than trusting a supplied boolean. Foreign-Colony budget facts are blocked even if internally consistent. Nested budgetDecision preserves specific budget reasons.

All supported stacking reasons, in stable evaluation order:

1. `ENTRY_NOT_VALID`
2. `PARTICIPATION_BLOCKED`
3. `SURVIVOR_EVIDENCE_REQUIRED`
4. `QUALIFYING_PROTECTION_REQUIRED`
5. `LEG_EVIDENCE_REQUIRED`
6. `MANUAL_APPROVAL_REQUIRED`
7. `MAX_ACTIVE_SCOUTS_REACHED`
8. `MAX_FRESH_RISK_POSITION_PIPS_REACHED`
9. `STACKING_COOLDOWN_NOT_SATISFIED`
10. `TARGET_PROXIMITY_BLOCKED`
11. `STRATEGY_STATE_CONSTRAINTS_NOT_SATISFIED`
12. `ATTEMPT_BUDGET_COLONY_MISMATCH`
13. `ATTEMPT_BUDGET_BLOCKED`

Only the applicable mode-specific reason can occur in one evaluation. Outputs, reason arrays and nested budget decisions are frozen. Repeated evaluation does not consume a budget; higher layers must pass updated counts/risk after real participation.

## 9. Tests added and results

131 new tests: 74 participation tests and 57 eligibility tests. Coverage includes all 121 Attempt state pairs, all 100 Position state pairs and all 20 canonical Position edges/events; opaque identity type separation; signed/null Attempt cost and completion rules; Trade source/direction/version/parent integrity; Position lineage and closure facts; terminal reopening rejection; unchanged parents; immutable events; absence of management outputs; deep JSON immutability and invalid payloads; every budget/stacking mode/guard; deterministic reason ordering; repeated participation; cap equality, projected overshoot, invalid numerics, overflow, missing facts, stale periods and foreign budget context.

Final full-suite result: **247 passed, 0 failed** — 229 domain (131 new + 98 existing), 8 shared IPC, 5 database and 5 Desktop IPC. All 116 frozen M0/M1.1 tests pass unchanged.

## 10. Compatibility changes outside packages/domain

None. No SQL, migrations, schema, shared IPC, Desktop, MT5 placeholder, dependency, lint configuration, build or renderer changes. Existing M1.1 IDs retain their syntax/branding behavior; primitives only gains new identity kinds and aliases. Existing Idea/Colony/Target lifecycles and the legacy M0 Idea path are unchanged.

## 11. Canonical ambiguities and minimal choices

- Attempt lifecycle is suggested, with terminal result stored separately: lifecycle validation is independent; no new persisted state/history entity.
- Alternate Attempt edges are unspecified: expiry/cancellation are permitted at each pre-fill stage; rejection only after ORDER_SUBMITTED; FILLED proceeds only to SURVIVED/FAILED/SCRATCH. All extra convenience edges are rejected.
- CANCELLED/REJECTED lack result equivalents: completedAt may be populated with null result; no invented enum value or fabricated FAILED/EXPIRED result.
- Pip-cost sign is unspecified: any finite signed pip cost is retained. Budget scouting-loss consumption is explicitly a separate nonnegative loss magnitude supplied by the caller, not signed net P&L.
- Pre-fill CANDIDATE conflicts with mandatory actual broker/opening fields: use the full pure lifecycle/event API for Candidate and the exposure record only after opening facts exist. No canonical schema nullability is changed and no fake broker fields are generated.
- FAILED/CONSOLIDATED are lifecycle-terminal but not necessarily broker-flat: retain size and nullable closure facts. CLOSED requires an already-zero exposure fact. No implicit close, reconciliation or consolidation is implemented.
- Current size versus original size is unspecified for future netting: validate signs/finite values without enforcing an invented netting model. Entry prices retain general-instrument finite values rather than imposing Forex-only positivity.
- Direction is not narrowed: Trade and Position both preserve LONG/SHORT/NEUTRAL. Trade direction is not forced to equal thesis direction; this does not grant countertrend execution permission, which remains outside this task.
- Trade snapshot version need not equal Colony's original version: accept an explicitly supplied version of the same Idea and retain its exact ID.
- StackingPolicy's fields/versioning are optional recommendations: use a minimal frozen value object with the listed caps/guards, no identity/version orchestrator.
- Cooldown/reset/strategy rule vocabularies are incomplete: retain validated opaque immutable JSON. Already-computed facts drive eligibility; no wall clock, TimeframeService, session calculations or detectors.
- Qualifying Survivor-or-later/Leg-or-later/protection criteria are not defined here: the caller supplies separate factual booleans. No broker protection is inferred from a state label.
- Projected fresh risk and threshold boundaries need an explicit decision: exhausted caps block; proposed risk may reach but cannot exceed the cap. The domain consumes finite numeric pip/exposure values, not monetary or percent-risk sizing.
- ParticipationAllowed summarizes higher-layer thesis/Area/session permission. This task does not implement those guards or infer them from state transitions. Scope/period IDs prevent mixing Colony budget contexts.
- PositionLeg and Candidate substatus are optional: neither is needed for this tranche and neither is implemented.
- Factories can construct supplied historical/current snapshots; they do not prove external reference existence, global ID or per-Colony sequence uniqueness, broker truth, event deduplication or full historical chronology. Those require future application/persistence/integration layers. Transition timestamps are checked against entity opening, not an unavailable prior-event stream.
- Later persistence milestone numbering differs between the task and PRODUCT_SPEC. This has no impact here: M1.3/M2 and all persistence expansion are excluded.

## 12. Commands run and results

Commands use pnpm 10.15.0 via `npm exec --yes --package=pnpm@10.15.0 -- pnpm ...`.

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed; existing native dependencies installed, lockfile unchanged |
| `pnpm --filter @arise/domain typecheck` | Passed |
| `pnpm --filter @arise/domain test` | 229 domain tests passed (131 new + 98 existing) |
| `pnpm exec prettier --write <new/extended domain files>` | Passed; no unrelated formatting changes |
| `pnpm check` | Typecheck passed; first lint run found one unused test-only type import; it was removed before final lint/tests |
| `pnpm lint` after correction | Passed |
| `pnpm test` | Passed: 247 tests, 0 failed |
| `pnpm build` | Passed: all packages and Electron main/preload/renderer production build |
| Baseline byte/scope comparison | Passed; changes confined to domain, all prior tests and infrastructure unchanged |
| GUI environment inspection | DISPLAY unset; Xvfb unavailable |
| `pnpm test:e2e` | Not run: GUI unavailable, and no Desktop/database/build infrastructure changed; task section 22 explicitly permits retaining the frozen Windows baseline |

## 13. Remaining blockers

No remaining implementation or acceptance blocker for this domain-only task. GUI E2E is unavailable in this environment; under the explicit M1.2 acceptance rule this does not reopen or block the previously verified Windows foundation when infrastructure is unchanged.

## 14. Freeze recommendation

All 22 required acceptance criteria are satisfied with the documented Candidate/exposure boundary and other minimal ambiguity choices above. Typecheck, lint, all 247 tests and production build pass. The display-limited E2E exception in task section 22 applies because no Desktop/database/build infrastructure changed. M0/M1.1 remain frozen. M1.3 and M2 have not been started.

M1.2 FREEZE RECOMMENDED
