# ARISE — STRATEGY_ENGINE.md

**Status:** Canonical  
**Version:** 1.0-draft  
**Purpose:** Define how ARISE represents strategy knowledge, executable detector contracts, multi-timeframe graphs, runtime state, evidence, and eventual automation.

---

## 1. Governing principle

ARISE must allow the user to teach a strategy once, encode measurable portions explicitly, combine them visually, run them statefully per Colony, and preserve why each decision occurred.

The strategy engine is not a black-box AI.

Core flow:

```text
Strategy Encyclopedia
  ↓
StrategyVersion
  ↓
Executable Detector Contract
  ↓
Strategy Map / Logic Graph
  ↓
Strategy Runtime
  ↓
Market Events
  ↓
Detector Evaluations
  ↓
Runtime State Changes
  ↓
Evidence / Actions
```

---

## 2. Strategy knowledge vs executable behavior

The Encyclopedia may contain:
- prose
- images
- diagrams
- screenshots
- notes
- examples
- discretionary interpretation

None of that is executable by default.

Executable behavior requires:
- explicit StrategyVersion
- detector_key
- detector_version
- parameter schema
- measurable detector contract
- tests

Never infer live automation rules directly from descriptive prose.

---

## 3. Automation capability

Every StrategyDefinition/Version has capability:

### MANUAL
ARISE cannot reliably detect the concept.

### DETECTABLE
ARISE can propose a candidate/condition, but user confirmation remains part of the intended workflow.

### AUTOMATABLE
ARISE has an explicit measurable contract suitable for deterministic automation.

Capability is not the same as runtime execution mode.

---

## 4. Execution mode

Per graph stage/node:

- OBSERVE
- NOTIFY
- CONFIRM
- AUTO

Examples:

An AUTOMATABLE MSS detector may run in CONFIRM mode.

A DETECTABLE discretionary setup cannot be promoted beyond its supported capability without a version change.

---

# 5. Strategy hierarchy

Canonical hierarchy:

```text
STRATEGY
  ↓
COMBO
  ↓
TIMEFRAME MAP / STRATEGY MAP
  ↓
TEMPLATE
  ↓
IDEA / COLONY INSTANCE
```

### Strategy
One reusable setup/component.

Examples:
- Liquidity Sweep
- MSS
- Displacement
- FVG
- Premium/Discount
- External Liquidity Target

### Combo
Reusable sequence or combination.

Example:
`Liquidity Reversal = Sweep → Displacement → MSS → FVG Retracement`

### Strategy Map
Assigns purposes/logic across one or more timeframes.

### Template
Reusable complete configuration including map, parameters, management defaults and possibly review/evidence policies.

### Colony Instance
Runtime use of exact frozen versions and parameters.

---

# 6. Timeframe-purpose model

Fundamental structure:

```text
TIMEFRAME + PURPOSE(S) + STRATEGY/LOGIC
```

Purpose flags:
- HINDSIGHT
- AREA
- ENTRY

Each timeframe may have:
- one,
- multiple,
- none.

Each stage also includes:
- importance
- execution mode

Importance:
- REQUIRED
- OPTIONAL
- INFORMATIONAL

Do not hard-code any purpose to a particular timeframe.

---

# 7. Strategy Map examples

Example A:

```text
M    HINDSIGHT
W    HINDSIGHT
D    HINDSIGHT + AREA
4H   AREA
1H   AREA
15M  ENTRY
5M   ENTRY
1M   ENTRY
```

Example B:

```text
W    HINDSIGHT
4H   AREA
5M   ENTRY
```

Example C:

```text
D    HINDSIGHT
5M   ENTRY
```

All are valid.

---

# 8. Graph model

Node families:

### STRATEGY
References a StrategyVersion and detector contract.

### LOGIC
- AND
- OR
- THEN
- NOT

### MODIFIER
Examples:
- Require Candle Close
- Allow Intracandle
- Max Stop
- Minimum Wick
- Minimum Displacement
- London Only
- NY Only
- Within Market Object
- Discount Only
- Max Attempts
- Expiry
- Maximum Spread
- Economic News

### MARKET_OBJECT
References exact MarketObject or MarketObjectVersion.

### STATE
Examples:
- Thesis Active
- Area Armed
- Waiting
- Triggered
- Scout Active
- Leg Protected
- Target Approaching

### ACTION
Examples:
- Notify
- Arm Strategy
- Create Scout
- Cancel Pending
- Move Stop
- Partial Close
- Promote Leg
- Convert Runner
- Take Snapshot
- Create Lesson Marker

---

# 9. Simple vs Graph mode

Simple mode:

```text
5M ENTRY
[Sweep] → [MSS] → [FVG]
```

Graph mode:

```text
[Sweep] ─────┐
             [AND] → [MSS] → [FVG]
[Displacement]┘
```

Both edit the same underlying LogicGraph.

There must not be two incompatible representations.

---

# 10. EDIT vs LIVE mode

### EDIT
Defines logic, parameters, graph structure, references.

### LIVE
Displays one StrategyRuntime instance:
- node state
- trigger memory
- pass/fail
- manual wait
- last evaluation
- evidence
- downstream arming

Do not allow editing live behavior implicitly.

A version change requires a new StrategyMapVersion and explicit deployment migration.

---

# 11. Detector contract

Standard conceptual interface:

```text
evaluate(
  MarketContext,
  DetectorParameters,
  PreviousDetectorState
) -> DetectorResult
```

Detector inputs must be explicit.

Example MSS inputs:
- direction
- source timeframe
- swing algorithm
- minimum swing strength
- break rule
- close required
- wick allowed
- displacement required
- maximum bars since prior event

Outputs should include:
- result
- detected candle
- broken swing
- confirmation price
- trigger price
- MarketObject references
- diagnostics
- optional confidence
- evaluation timestamp

---

# 12. MarketContext

Canonical context includes:

```text
MarketContext {
  instrument
  timeframe
  candles
  bid
  ask
  spread
  marketObjects
  parentThesis
  colony
  session
  economicEvents
}
```

The detector should not reach into unrelated global application state.

---

# 13. Detector registry

Recommended registry keys:

```text
price_touch
price_cross
zone_entry
liquidity_sweep
external_liquidity
equal_high_low
swing
mss
bos
reclaim
displacement
fvg
ifvg
fvg_retracement
premium_discount
market_object_condition
session
spread
economic_news
timeframe_state
```

The StrategyVersion stores detector identity by key/version.

Graph files must not embed arbitrary executable code.

---

# 14. Detector families

### Liquidity
- SweepDetector
- ExternalLiquidityDetector
- EqualHighLowDetector

### Structure
- SwingDetector
- MSSDetector
- BOSDetector
- ReclaimDetector

### Imbalance
- FVGDetector
- IFVGDetector
- DisplacementDetector

### Location
- PremiumDiscountDetector
- ZoneInteractionDetector
- MarketObjectConditionDetector

### Context
- SessionDetector
- SpreadDetector
- EconomicEventDetector
- TimeframeStateDetector

---

# 15. Evaluation modes

Every detector/node declares its evaluation mode:

- ON_TICK
- ON_PRICE_UPDATE
- ON_BAR_UPDATE
- ON_BAR_CLOSE
- ON_EVENT
- MANUAL

Examples:

FVG formation:
`ON_BAR_CLOSE`

FVG retracement:
`ON_PRICE_UPDATE`

MSS requiring close:
`ON_BAR_CLOSE`

Price enters Area:
`ON_PRICE_UPDATE`

News event:
`ON_EVENT`

---

# 16. Intracandle behavior

Separate:

### CONDITION CONFIRMATION
May require a closed candle.

### EXECUTION TRIGGER
May occur intrabar after prior conditions are confirmed.

Example:

```text
5M FVG forms on candle close
  ↓
FVG is confirmed
  ↓
retracement into FVG can trigger intrabar
```

This prevents unstable HTF confirmation while supporting true lower-timeframe execution.

---

# 17. Active detector subscription

Do not evaluate every detector on every instrument/timeframe continuously.

Only armed RuntimeNodes subscribe to relevant events.

Example:

```text
RuntimeNode
Detector: FVGRetracementDetector
Instrument: EURUSD
Timeframe: 5M
Evaluation: ON_PRICE_UPDATE
```

Dormant nodes receive no evaluation traffic.

This is required for scalability.

---

# 18. Event router

Market events are routed by:
- instrument
- timeframe
- event type
- runtime dependency

Examples:
- QuoteUpdated
- BarUpdated
- BarClosed
- EconomicEventUpdated
- MarketObjectChanged
- PositionStateChanged
- TargetApproaching

The Strategy Runtime subscribes only where dependencies require it.

---

# 19. Runtime persistence

Runtime nodes persist:
- state
- armedAt
- triggeredAt
- confirmedAt
- lastEvaluatedCandle
- sourceObjectIds
- sourceCandleIds
- triggerCount
- runtime-specific memory

Restart must restore the exact cascade state.

Do not replay the graph from scratch and accidentally refire actions.

---

# 20. Duplicate-event protection

Runtime effects must be idempotent.

If the same BarClosed or detector result arrives multiple times, ARISE must not create duplicate Scouts/actions.

Design for:
- at-least-once event delivery
- effectively-once domain effects

Use event identity + RuntimeNode state + action correlation IDs.

---

# 21. Manual strategy nodes

Manual nodes pause runtime.

Possible user actions:
- CONFIRM
- REJECT
- SKIP

Every action:
- records timestamp
- records user/manual source
- creates DecisionTrace
- transitions node explicitly

Manual-only logic is a supported first-class mode, not a temporary hack.

---

# 22. Market Objects as detector inputs

Manually drawn or automatically detected Market Objects use the same canonical model.

Example:

```text
User draws D FVG
Role = AREA
Owner = Weekly Long #05
```

Graph:

```text
[Price enters D FVG]
   ↓
[Arm 1H MSS]
```

This lets discretionary HTF analysis combine with automated LTF triggers.

---

# 23. Detector-generated Market Objects

Detectors may create canonical Market Objects.

Example FVG detector:
- confirms 3-candle geometry,
- creates MarketObject Type=FVG,
- stores exact source Candle IDs,
- produces MarketObjectVersion,
- references it in DetectorEvaluation.

Downstream retracement node then references the same object.

The visual chart and algorithm must not maintain separate FVG objects.

---

# 24. Discretionary ambiguity

ARISE must not pretend discretionary concepts are universally objective.

Example swing algorithms may include:
- pivot bars
- fractal
- ZigZag
- ATR significance
- custom/manual reference

Therefore:
- detector parameters are explicit,
- StrategyVersions are immutable,
- different definitions can coexist.

Example:

```text
MSS v1
swing = pivot 2/2

MSS v2
swing = pivot 3/3
require displacement = true
```

Historical trades retain the version used.

---

# 25. Detector test contract

Each executable detector requires regression fixtures.

Example MSS tests:
- detects valid LONG MSS
- detects valid SHORT MSS
- rejects wick-only break when close required
- accepts wick when configured
- rejects stale swing beyond max age
- requires displacement when configured
- does not duplicate same structural break

FVG:
- detects valid bullish FVG
- detects valid bearish FVG
- rejects overlapping/non-gap geometry
- preserves source Candle IDs
- does not recreate same object repeatedly

Sweep:
- wick-through + reclaim
- close-through rejection where appropriate
- manually referenced liquidity object
- duplicate prevention

No detector is considered automation-ready without tests.

---

# 26. Economic news modifier

Node:
`ECONOMIC_NEWS`

Parameters:
- relevant pair currencies or custom currencies
- impact levels
- before window
- after window
- action

Actions:
- BLOCK_NEW_SCOUTS
- REQUIRE_MANUAL_CONFIRMATION
- NOTIFY_ONLY
- IGNORE

Existing positions must not auto-close due solely to news unless a separate explicit management rule says so.

---

# 27. Spread modifier

Node:
`MAXIMUM_SPREAD`

Behavior:
- WAIT
- SKIP
- REQUIRE_MANUAL_CONFIRMATION
- BLOCK

Final execution spread must also be revalidated close to broker execution.

---

# 28. Strategy runtime example

```text
Weekly Long Thesis
  ↓
D Area
  ↓
4H SSL Sweep
  ↓
1H Long MSS
  ↓
5M FVG Retracement
  ↓
Create Scout
```

Runtime:

```text
D Area
ACTIVE

4H Sweep
CONFIRMED

1H MSS
WATCHING

5M FVG
DORMANT
```

When 1H MSS confirms:

```text
1H MSS
CONFIRMED

5M FVG
ARMED → WATCHING
```

This exact state must persist across restart.

---

# 29. Decision Trace

Every meaningful runtime progression should create a readable trace.

Example:

```text
09:31:00
D Area entered
Market Object: D FVG #03

10:00:00
4H Sweep confirmed

11:00:00
1H Long MSS confirmed
Broken Swing #82

11:23:42
5M FVG retracement triggered

11:23:42
Spread rule passed

11:23:43
Create Scout action emitted
```

Decision Trace is not optional debug logging; it is a first-class review artifact.

---

# 30. Evidence integration

At node confirmation/failure/expiry, Evidence Profile determines capture.

Recommended default:
`Strategy evidence + Entry`

Evidence may include:
- exact chart timeframe
- source candles
- highlighted Market Objects
- Timeframe Projection
- node status
- Colony context
- screenshot
- machine-readable chart state

Multiple nodes on one timeframe may generate:
- per-node internal EvidenceEvents
- one Stage Summary snapshot for Review presentation

---

# 31. Failure semantics

Runtime must distinguish:

### FALSE / NOT_MET
Condition not present.

### FAILED
Strategy logic has definitively failed.

### BLOCKED
Another rule prevents progression.

### EXPIRED
Context validity ended.

### ERROR
System could not evaluate safely.

ERROR should usually suspend downstream automated action.

Never reinterpret system failure as market-condition failure.

---

# 32. Expiry and re-arm scopes

Possible re-arm/reset scopes:
- CURRENT_NODE
- CHILDREN
- CURRENT_STAGE
- ENTIRE_CASCADE

Possible expiry triggers:
- current candle ends
- session ends
- Area invalidates
- thesis invalidates
- time duration
- structural event changes
- manual cancel

These must be explicit.

---

# 33. Attempts and runtime

A `CREATE_SCOUT` action does not bypass AttemptPolicy.

Flow:

```text
Runtime action requests Scout
  ↓
Attempt/Stacking validation
  ↓
Fresh-risk validation
  ↓
ExecutionIntent
```

The graph may be valid while the Colony engine blocks a new Scout.

That is expected behavior.

---

# 34. Management graph separation

Primary Strategy Graph answers:

> How do we acquire exposure?

Management/Protection policies answer:

> What do we do with acquired exposure?

Do not overload one graph with all position management unless a future unified visual editor is deliberately designed.

Communication occurs through events:
- PositionStateChanged
- StrategyNodeConfirmed
- TargetApproaching
- TargetHit
- MarketObjectCondition
- ManualAction

---

# 35. Historical evaluation compatibility

Detector code should be event-driven and reusable with historical candle streams.

This allows future:
- replay
- setup discovery
- historical occurrences
- strategy testing
- practice mode

V1 does not require a full backtester, but architecture must not make historical reuse impossible.

---

# 36. Deployment safety

A StrategyVersion is not live simply because it compiles.

Lifecycle:
- EXPERIMENTAL
- VALIDATED
- DEMO_APPROVED
- LIVE_APPROVED
- RETIRED

Graph maximum deployment = weakest executable dependency.

Example:

```text
Sweep = LIVE_APPROVED
MSS = LIVE_APPROVED
FVG = DEMO_APPROVED
```

Graph maximum:
`DEMO`

---

# 37. DeploymentSnapshot

When a Colony runs in DEMO/LIVE, freeze:
- StrategyMapVersion
- StrategyVersions
- detector versions
- node parameters
- management policy
- protection rules
- Gear
- execution policy
- news policy

Editing Encyclopedia content later does not mutate the live runtime.

Migration is explicit and audited.

---

# 38. Initial strategy catalog

Do not build a huge catalog before the engine is stable.

V1 representative strategies:
- Price Touch / Cross
- Zone Entry
- Liquidity Sweep
- Swing
- MSS
- Displacement
- FVG
- FVG Retracement
- Premium / Discount
- External Liquidity Target
- Session
- Spread
- Economic News

Engine first. Catalog later.

---

# 39. Non-negotiable implementation rules

Astra must not:

1. Hard-code timeframe roles.
2. Infer executable behavior from prose.
3. Embed detector code inside GraphNode UI.
4. Run all detectors against all symbols continuously.
5. Lose RuntimeNode state on restart.
6. Duplicate actions from repeated events.
7. Treat detector ERROR as FALSE.
8. Create broker orders directly from detector code.
9. Skip Evidence/DecisionTrace for automated progression.
10. Mutate active runtime behavior because an Encyclopedia entry was edited.
