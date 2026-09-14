# ARISE — ASTRA_INSTRUCTIONS.md

**Status:** Canonical  
**Version:** 1.0-draft  
**Audience:** ChatGPT Astra / AI coding agents / human implementers  
**Purpose:** Prevent implementation drift while ARISE is built incrementally.

---

## 1. Mission

You are implementing **ARISE**, a Windows trading operating system centered on a Millipede-style participation model, multi-timeframe thesis workflow, explainable strategy automation, evidence capture, and controlled MT5 execution.

You are not building a generic trading dashboard.

You are not building a signal bot with a journal attached.

Read the relevant canonical documents before editing code.

---

## 2. Source-of-truth order

When requirements conflict, use this order:

1. Explicit current task requirements
2. Canonical ARISE docs in `/docs`
3. Existing tests and stable public interfaces
4. Existing implementation
5. Your own assumptions

If a requested change conflicts with a canonical invariant, stop and surface the conflict instead of silently “simplifying” it.

---

## 3. Mandatory vocabulary

Use:
- ARISE
- LONG / SHORT / NEUTRAL
- Idea
- Thesis
- Colony
- Hindsight / Area / Entry
- Attempt
- Candidate
- Scout
- Survivor
- Protected
- Leg
- Mature Leg
- Runner
- Market Object
- Strategy Definition
- Strategy Version
- Strategy Runtime
- Detector
- Evidence
- Decision Trace

Do not introduce Bull/Bear naming into canonical UI/domain models unless a third-party API requires it internally.

---

## 4. Do not collapse distinct concepts

These are deliberately different:

- Thesis != Colony
- Idea != IdeaVersion
- Target != broker TP
- Area != entry
- Strategy Definition != Strategy Runtime
- Strategy capability != chosen execution mode
- Strategy Graph != detector implementation
- Market Object != chart drawing
- MarketObject != MarketObjectVersion
- Trade != Broker Order
- ExecutionIntent != Order
- Order != Fill
- Scout != generic Position
- Position State != Management Policy
- Survivor != Break-Even
- Protected != Survivor
- Individual BE != Colony BE
- Scout stop-out != Thesis invalidation
- Not Reviewed != Neutral
- Current operational state != immutable history

Do not merge any of these merely to reduce table/class count.

---

## 5. Millipede invariant

Never simplify the workflow into:

`signal → trade → win/loss`

ARISE models:

`Thesis → Area → Strategy Runtime → Attempt → Scout → evidence/growth → Survivor → Protected/Leg → Mature Leg → Target/Runner`

Multiple Scouts may coexist in one Colony and may end differently.

The system is designed for repeated low-cost participation and preservation of rare durable growth.

---

## 6. Timeframe invariant

Never hard-code fixed roles such as:

- Weekly = Hindsight
- 4H = Area
- 5M = Entry

Any timeframe can have:
- HINDSIGHT,
- AREA,
- ENTRY,
- combinations,
- none.

A Colony may use any number of timeframes.

Use the canonical `TimeframeService` for candle boundaries and parent/child relationships.

---

## 7. Risk/accounting invariant

ARISE is fixed-size and pip-first by default.

Do not make % account risk the primary sizing model.

Support fixed-size Gears.

Money calculations still exist internally for safety and accounting, even when `$ HIDDEN` is active.

Do not delete monetary raw data merely because UI hides dollars.

---

## 8. Historical integrity

Never silently overwrite a historical decision.

Version:
- Idea/Thesis
- Strategy
- Combo
- Strategy Map
- Market Object geometry/semantics
- Management Policy
- Protection Rule where behavior changes

Persist immutable events for:
- state transitions,
- fills,
- detector confirmations,
- evidence,
- reviews,
- broker activity,
- protection actions,
- safety events.

A historical Trade must continue to resolve the exact versions that governed it.

---

## 9. Dependency rules

### `packages/domain`
Must not import:
- React
- Electron
- SQLite
- Drizzle
- MT5/MQL
- chart libraries
- filesystem UI code

### Renderer
Must not access:
- SQLite directly
- MT5 directly
- broker socket directly

Use typed IPC and domain/application services.

### Strategy Graph
May orchestrate detectors but must not contain technical-analysis detector implementations.

### MT5 Agent
Must not implement the entire ARISE strategic brain.

---

## 10. Market Object rule

**Drawing tools define geometry. Market Object properties define meaning.**

A rectangle is not automatically an FVG.

An FVG is not necessarily an Area.

Semantic Type and Role are separate.

Do not encode meaning only in chart styling.

All important Market Objects require permanent IDs and versionable geometry.

---

## 11. Strategy-engine rule

Knowledge prose in the Encyclopedia is not executable.

An executable StrategyVersion requires an explicit detector contract:

- detector key/version,
- parameter schema,
- measurable inputs,
- standardized result,
- regression tests.

Automation capability:
- MANUAL
- DETECTABLE
- AUTOMATABLE

Execution mode:
- OBSERVE
- NOTIFY
- CONFIRM
- AUTO

Do not infer executable rules from prose at runtime.

---

## 12. Detector rule

Every detector must produce explainable results.

A detector result should preserve enough information to answer:

> Why did ARISE say this condition occurred?

Examples:
- source candles,
- broken swing,
- Market Objects,
- trigger price,
- confirmation price,
- diagnostics,
- evaluation time.

Distinguish:
- NOT_MET / FALSE
- TRIGGERED
- CONFIRMED
- BLOCKED
- FAILED
- EXPIRED
- ERROR

`ERROR` is never equivalent to `FALSE`.

---

## 13. Runtime-state rule

Strategy Runtime is stateful and persistent.

Runtime nodes must survive application restart.

Do not repeatedly fire the same action because duplicate price/bar events arrive.

Design for:
- at-least-once message delivery,
- effectively-once domain effects.

Persist trigger memory and event identity.

---

## 14. Execution safety rule

A strategy signal is not an order.

Required chain:

`Strategy Action → ExecutionIntent → Validation → frozen OrderPlan → durable BrokerCommand → broker response → Fill → protection → verification → active Scout`

Every consequential broker command must be:
- durable,
- idempotent,
- auditable,
- acknowledged,
- reconciled,
- verified where relevant.

Do not mark a Position filled because an order was merely accepted.

---

## 15. Broker authority

ARISE owns intent and semantic state.

The broker owns actual:
- position quantity,
- fill price,
- pending orders,
- SL,
- TP,
- broker tickets.

If broker reality and ARISE disagree operationally, reconcile to broker reality and preserve the discrepancy in history.

Never recreate a missing broker position merely because ARISE expected it to exist.

---

## 16. Uncertainty rule

If broker state is uncertain:

1. create no new exposure,
2. preserve existing broker protection,
3. enter RECONCILING / BLOCKED state,
4. fetch broker truth,
5. record discrepancy,
6. verify resolution,
7. only then resume automation.

Never guess.

---

## 17. Idempotency rule

Every execution command needs a stable idempotency key.

If an acknowledgement is lost, retrying the same command must not duplicate an order.

Inbound broker events must also be deduplicated.

Write tests for this before enabling demo/live automation.

---

## 18. Partial-fill rule

A filled portion must receive protection without waiting for the remaining quantity.

Track:
- requested quantity,
- filled quantity,
- remaining quantity,
- remainder policy.

Do not use naive bracket quantity assumptions that can create reversal exposure.

---

## 19. Position scope rule

Management actions always have explicit scope.

Examples:
- THIS_POSITION
- SELECTED_POSITIONS
- ALL_SCOUTS
- ALL_SURVIVORS
- ALL_UNPROTECTED
- ALL_LEGS
- ALL_POSITIONS_IN_COLONY

Never infer “all positions” from an action intended for one position.

---

## 20. Protection rule

Position state and protection are separate.

A state transition never silently moves a stop.

Protection follows:

`Trigger → Scope → Action → Calculation → Broker Validation → Request → Verification`

Default automated stop behavior:
- never worsen protection,
- unless an explicit advanced policy authorizes loosening.

A successful API call is not verification. Refresh broker state and confirm.

---

## 21. Initial-SL safety rule

For automated Scouts, a failure to obtain valid initial protection is critical.

Expected default behavior:

`retry corrected valid SL → if still unprotected → close the new Scout`

The MT5 Agent should be capable of this close-to-broker safety sequence without depending on the renderer.

---

## 22. Delegated execution rule

The MT5 Agent may execute an already-authorized deterministic trigger while the Desktop is temporarily unavailable.

It may not create new strategic decisions.

Every delegated entry requires:
- exact trigger,
- size,
- protection,
- spread/slippage constraints where applicable,
- one-shot semantics where applicable,
- expiry/invalidation.

No accidental infinite delegated trigger.

---

## 23. Evidence rule

Automation without evidence is incomplete.

When a runtime condition advances an important strategy stage, preserve:
- DetectorEvaluation,
- RuntimeNodeEvent,
- DecisionTrace entry,
- EvidenceEvent,
- EvidenceSnapshot when capture policy requires it,
- exact referenced MarketObject/Candle versions.

Evidence should answer what ARISE saw and why it advanced.

---

## 24. UI rule

Do not put trading logic in React components.

UI requirements:
- dark-first ARISE visual language,
- calm operational trading surfaces,
- denser study/review surfaces,
- no NinjaTrader-style bottom-tab aesthetic,
- restrained blue accents,
- subtle 6–10px radii,
- one main UI font,
- tabular/mono numeric presentation where useful,
- status communicated by text/shape as well as color.

Use LONG/SHORT terminology.

---

## 25. Interaction rule

- Single click: select/inspect
- Double click: open/full context
- Right click: contextual actions
- Ctrl+K: global command/search
- Ctrl+click: open in new workspace tab where applicable
- Drag on organization/state surfaces must never secretly trade
- Consequential broker actions require explicit semantics

Prefer contextual drawers over unnecessary modal dialogs.

---

## 26. Documents rule

Use one Document + Block engine for Thesis, notes, reviews, Lessons, Encyclopedia and research.

Markdown is an export/sync representation.

Do not make `.md` files the live execution database.

Relational ARISE entities remain canonical.

---

## 27. Testing rule

No trading detector or execution component is complete without tests.

Mandatory execution failure scenarios include:
- duplicate command retry,
- duplicate broker event,
- partial fill,
- multiple partial fills,
- order rejection,
- SL rejection,
- Desktop crash after send,
- Desktop crash after fill,
- MT5 restart,
- manual broker close,
- external SL modification,
- stale quote,
- spread spike,
- account mismatch,
- out-of-order events,
- historical trigger discovered after reconnect,
- Colony flatten with no residual re-entry/reversal order.

Use a fake broker/Agent harness.

Do not test only the happy path.

---

## 28. Deployment gate

Runtime modes:
- OBSERVE
- SHADOW
- DEMO
- LIVE

Strategy lifecycle:
- EXPERIMENTAL
- VALIDATED
- DEMO_APPROVED
- LIVE_APPROVED
- RETIRED

A new or modified detector must not become LIVE automatically.

A graph's maximum deployment mode is limited by its least-approved executable dependency.

---

## 29. Active deployment snapshot

When a live/demo Colony activates a strategy, freeze the exact:
- StrategyMapVersion,
- StrategyVersion(s),
- detector versions,
- parameters,
- ManagementPolicyVersion,
- ProtectionRuleVersion(s),
- Gear,
- execution policy,
- news policy.

Editing the Encyclopedia later must not silently mutate active behavior.

Updating an active Colony requires an explicit migration event.

---

## 30. Task execution protocol

For each coding task:

### Before coding
1. Read the task.
2. Read the listed canonical docs.
3. Inspect existing relevant code and tests.
4. Identify invariants that must remain unchanged.
5. State any true conflict before editing.

### During coding
- keep scope narrow,
- reuse established abstractions,
- do not make unrelated rewrites,
- add/update tests with behavior,
- preserve migration compatibility.

### Before completion
Run:
- typecheck,
- lint,
- unit tests,
- relevant integration tests,
- relevant Playwright tests where UI changed.

Report:
- files changed,
- behavior implemented,
- tests added/run,
- unresolved issues,
- any spec ambiguity.

---

## 31. Standard Astra task template

```text
TASK
<one bounded implementation objective>

READ FIRST
/docs/<relevant files>

INVARIANTS
<rules that may not change>

FILES / PACKAGES IN SCOPE
<explicit scope>

REQUIREMENTS
<functional requirements>

ACCEPTANCE TESTS
<observable pass criteria>

OUT OF SCOPE
<what must not be added or redesigned>

DELIVERABLE
<code/tests/migration/etc.>
```

Do not treat a milestone title as one coding task. Decompose it.

---

## 32. Protected architecture

Once stabilized, changes to the following require explicit task scope and stronger regression testing:

- `packages/domain`
- database migrations
- shared Desktop↔Agent protocol
- `apps/mt5-agent`
- execution/reconciliation logic

UI can iterate relatively quickly.

Execution semantics should change deliberately.

---

## 33. Final implementation principle

When faced with a choice between:

- less code but ambiguous state, or
- more explicit code with durable, inspectable state,

prefer explicit durable state.

ARISE is intended to explain, recover, review and audit what it did.

Correctness, traceability and recovery are more important than clever compactness.
