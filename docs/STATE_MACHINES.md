# ARISE — STATE_MACHINES.md

**Status:** Canonical  
**Version:** 1.0-draft  
**Purpose:** Define valid lifecycle states, transition semantics, and separation between state and management.

---

## 1. General rule

State describes what an entity **is now**.

Management describes what ARISE **does about it**.

A state transition must not silently perform broker actions unless explicitly orchestrated by another engine.

All consequential transitions must create immutable state events.

---

# 2. Position lifecycle

Canonical states:

```text
CANDIDATE
  ↓
SCOUT
  ↓
SURVIVOR
  ↓
PROTECTED
  ↓
LEG
  ↓
MATURE_LEG
  ↓
RUNNER
```

Alternate/terminal states:

```text
FAILED
CLOSED
CONSOLIDATED
```

### CANDIDATE
Potential participation opportunity not yet filled.

Candidate substatus may be represented separately:
- WAITING
- READY
- ORDER_SUBMITTED
- FILLED
- EXPIRED
- CANCELLED

### SCOUT
Newly filled low-cost participation attempt.

### SURVIVOR
Position has demonstrated meaningful favorable evidence.

Survivor does not imply:
- BE,
- protected,
- trailing,
- add another Scout.

### PROTECTED
Downside is materially secured according to the assigned protection criterion.

### LEG
Established campaign exposure.

### MATURE_LEG
Durable exposure that has survived enough structure/time/progress to be treated as higher-quality campaign exposure.

### RUNNER
Position deliberately detached from original local exit expectation and managed under a runner policy.

### FAILED
Attempt/position failed under the strategy's criteria.

### CLOSED
Broker exposure is closed.

### CONSOLIDATED
Position lineage transferred into another Colony/context while retaining full history.

---

## 3. Position transition rules

Typical forward transitions:

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

Some transitions may be policy-configurable, but terminal states must not transition back to active states without creating a new entity.

Examples invalid by default:

```text
FAILED → LEG
CLOSED → SCOUT
CONSOLIDATED → SCOUT
```

---

## 4. Position-state orchestration

A state engine may consume:
- DetectorEvaluation
- StrategyRuntime events
- MarketObject conditions
- price progress
- elapsed time
- target progress
- manual confirmation
- protection verification

But the state engine should emit:

`PositionStateChangeProposal`

then commit a transition when valid.

It must not directly move stops or place orders.

---

# 5. Protection state

Protection is deliberately separate from PositionState.

A Position can be:

```text
SURVIVOR + UNPROTECTED
```

or:

```text
SCOUT + PROTECTED
```

if policy allows.

Recommended protection operational states:

- UNPROTECTED
- PROTECTION_PENDING
- PARTIALLY_PROTECTED
- PROTECTED
- PROTECTION_ERROR

Protection state is derived from verified broker conditions and policy criteria.

---

# 6. Colony lifecycle

Canonical states:

```text
DORMANT
  ↓
BUILDING
  ↓
ESTABLISHED
  ↓
MATURE
```

Alternate states:
- DECAYING
- INVALIDATED
- COMPLETED

### DORMANT
Idea/Colony exists but has no active participation process.

### BUILDING
Active acquisition process exists; typically Candidates/Scouts/Attempts.

### ESTABLISHED
At least one established Leg or policy-defined equivalent exists.

### MATURE
Contains durable exposure or otherwise satisfies maturity policy.

### DECAYING
Thesis/structure is deteriorating but Colony is not formally invalidated.

### INVALIDATED
Thesis invalidation condition has occurred.

### COMPLETED
Campaign is intentionally finished.

---

## 7. Colony transitions

Typical:

```text
DORMANT → BUILDING
BUILDING → ESTABLISHED
ESTABLISHED → MATURE

BUILDING → DECAYING
ESTABLISHED → DECAYING
MATURE → DECAYING

DORMANT → INVALIDATED
BUILDING → INVALIDATED
ESTABLISHED → INVALIDATED
MATURE → INVALIDATED
DECAYING → INVALIDATED

BUILDING → COMPLETED
ESTABLISHED → COMPLETED
MATURE → COMPLETED
INVALIDATED → COMPLETED
```

Do not silently delete Colony state history during consolidation/promotion.

---

# 8. Thesis / Idea status

Suggested Idea lifecycle:

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

Important:

Scout stop-out is not Idea invalidation.

Idea invalidation may:
- stop new Scouts,
- cancel pending Candidates,
- disarm Strategy Runtime,
- trigger notification,
- invoke existing-position policy.

Default existing-position behavior:
`MANUAL_DECISION`

---

# 9. Area lifecycle

Canonical Area states:

```text
DORMANT
  ↓
WATCHING
  ↓
APPROACHING
  ↓
TOUCHED
  ↓
ARMED
  ↓
ACTIVE
```

Alternate:
- EXPIRED
- CONSUMED
- INVALIDATED

Definitions:

### DORMANT
Area exists but is not currently monitored.

### WATCHING
Area is relevant and monitored.

### APPROACHING
Price enters configurable proximity.

### TOUCHED
Price contacts the Area geometry.

### ARMED
Touch/context allows downstream strategy logic to activate.

### ACTIVE
Downstream entry/confirmation runtime is actively operating.

Touch does not automatically imply entry or even ARMED unless policy says so.

---

# 10. Strategy Runtime node lifecycle

Canonical node states:

```text
DORMANT
  ↓
ARMED
  ↓
WATCHING
  ↓
TRIGGERED
  ↓
CONFIRMED
  ↓
COMPLETED
```

Alternate:
- FAILED
- EXPIRED
- CANCELLED
- BYPASSED

### DORMANT
Not currently eligible for evaluation.

### ARMED
Dependencies satisfied; eligible to observe relevant market events.

### WATCHING
Actively receiving/evaluating relevant events.

### TRIGGERED
Initial condition occurred but may still need confirmation.

### CONFIRMED
Required confirmation occurred.

### COMPLETED
Node's role in current runtime sequence is complete.

### FAILED
Logical failure condition occurred.

### EXPIRED
Temporal/context validity ended.

### CANCELLED
External orchestration cancelled the node.

### BYPASSED
Manual/logic override intentionally skipped it.

Every transition should be traceable.

---

## 11. Detector results vs runtime states

Do not conflate them.

Detector results:
- NOT_MET
- PARTIAL
- TRIGGERED
- CONFIRMED
- BLOCKED
- FAILED
- EXPIRED
- ERROR

Runtime state may react to a detector result.

`ERROR` must never become `FAILED` or `NOT_MET` automatically.

---

# 12. Manual-node behavior

A manual node can enter:

```text
ARMED → WATCHING
```

and then wait for:

- CONFIRM
- REJECT
- SKIP

Results:
- CONFIRM → CONFIRMED
- REJECT → FAILED or CANCELLED depending node contract
- SKIP → BYPASSED

Manual overrides must create DecisionTrace entries.

---

# 13. Attempt lifecycle

Suggested:

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

Alternate:
- EXPIRED
- CANCELLED
- REJECTED

Attempt begins before fill.

If an entry never fills:
- result may be EXPIRED,
- pip_cost = 0.

---

# 14. Execution lifecycle

Canonical high-level statuses:

- DRAFT
- VALIDATING
- BLOCKED
- READY
- SENT
- ACKNOWLEDGED
- WORKING
- PARTIALLY_FILLED
- FILLED
- PROTECTING
- ACTIVE
- CANCEL_REQUESTED
- CANCELLED
- EXPIRED
- REJECTED
- FAILED
- UNKNOWN

### UNKNOWN
Used only when ARISE cannot safely determine broker state.

UNKNOWN triggers reconciliation and blocks new exposure.

---

# 15. Broker command lifecycle

Suggested:

```text
CREATED
  ↓
SENDING
  ↓
ACKNOWLEDGED
  ↓
COMPLETED
```

Alternate:
- FAILED
- SUPERSEDED
- CANCELLED
- UNKNOWN

Retries retain the same idempotency key.

---

# 16. Protection request lifecycle

Canonical:

```text
CREATED
  ↓
CALCULATED
  ↓
VALIDATED
  ↓
SENT
  ↓
ACCEPTED
  ↓
CONFIRMED
  ↓
VERIFIED
```

Alternate:
- BLOCKED
- REJECTED
- FAILED
- SUPERSEDED
- CANCELLED

A broker API success is not equivalent to VERIFIED.

---

# 17. Target lifecycle

Suggested:

- ACTIVE
- APPROACHING
- REACHED
- HIT
- INVALIDATED
- REASSIGNED
- COMPLETED

Definitions:

### APPROACHING
Spatial target progress exceeds configured threshold.

### REACHED
Price enters target zone.

### HIT
Specific target objective is considered consumed/satisfied.

These can be separate events.

---

# 18. Review lifecycle

Per MarketReview:

- DUE
- COMPLETED
- MISSED
- SKIPPED

Important:
- MISSED does not become NEUTRAL.
- SKIPPED preserves history.
- Catch-up may create a current review without pretending all missed reviews occurred.

---

# 19. Safety / connection state

Connection states:
- CONNECTED
- DEGRADED
- DISCONNECTED
- RECONNECTING
- RECONCILING
- BLOCKED

Automation state should be independently represented:
- READY
- PAUSED
- SAFE_MODE
- BLOCKED
- RECOVERY_REQUIRED

---

# 20. Runtime deployment state

Strategy lifecycle:
- EXPERIMENTAL
- VALIDATED
- DEMO_APPROVED
- LIVE_APPROVED
- RETIRED

Runtime modes:
- OBSERVE
- SHADOW
- DEMO
- LIVE

A runtime must never exceed the weakest deployment approval of its executable dependencies.

---

# 21. Promotion / consolidation semantics

Promotion is a lineage event, not a destructive state rewrite.

Example:

```text
Mature Leg #17
Original Colony: Daily Long #11
Current Colony: Weekly Long #05
```

The position may transition to:
`CONSOLIDATED`

within the source Colony context while a linked lineage record continues the active exposure in the target Colony model.

Implementation may choose a clean representation, but must preserve:
- original trade,
- original Colony,
- promotion event,
- current Colony,
- evidence,
- exact history.

---

# 22. State transition event requirements

Every state event should preserve:
- entity ID
- previous state
- next state
- timestamp
- reason
- source type
- source ID where available
- user/manual override flag
- correlation/trace ID where relevant

This allows Review and debugging to reconstruct why state changed.

---

# 23. Invalid state shortcuts

Astra must reject shortcuts such as:

- automatically setting PROTECTED when price moves positive,
- automatically setting SURVIVOR when stop moves to BE,
- automatically setting LEG because duration exceeded some global constant,
- automatically setting Colony MATURE merely because total lots exceed a threshold,
- automatically reopening CLOSED/FAILED entities.

All such behavior must come from explicit policy/configuration.
