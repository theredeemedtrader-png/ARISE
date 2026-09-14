# ARISE — EXECUTION_SPEC.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define the complete path from an authorized Strategy/Manual action to verified broker exposure through MT5.

---

## 1. Governing principle

> A strategy signal is not an order.

ARISE turns semantic intent into a frozen, validated, idempotent execution plan, sends it through the MT5 Agent, then verifies broker reality before considering exposure active.

---

## 2. Responsibility boundary

### ARISE owns
- why the trade exists,
- Colony/Thesis association,
- Strategy Runtime context,
- Attempt,
- fixed-size Gear,
- semantic entry/stop/target rules,
- execution validation,
- lifecycle/audit.

### MT5 Agent owns
- broker communication,
- broker symbol translation,
- order submission,
- fill/broker events,
- native protection requests,
- delegated deterministic triggers,
- close-to-broker safety behavior.

### Broker owns reality
- actual order state,
- actual fills,
- actual quantity,
- actual SL/TP,
- actual position state.

---

## 3. End-to-end lifecycle

```text
Strategy/Manual Action
    ↓
Attempt
    ↓
ExecutionIntent
    ↓
Pre-Trade Validation
    ↓
Frozen OrderPlan
    ↓
Durable BrokerCommand
    ↓
MT5 Agent
    ↓
Broker Acceptance
    ↓
Fill / Partial Fill
    ↓
Initial Protection
    ↓
Broker Verification
    ↓
Scout ACTIVE
```

---

## 4. ExecutionIntent

An ExecutionIntent is ARISE's semantic desire to create exposure.

Typical fields:

```text
instrument
direction LONG/SHORT
size / Gear
entry type
entry semantic rule
stop semantic rule
target semantic rule
Colony
IdeaVersion
StrategyRuntime
Attempt
createdAt
```

It is not a broker order.

A blocked/rejected Intent remains reviewable even when no order was sent.

---

## 5. Fixed-size Gears

Primary sizing is fixed lots/contracts, not % account risk.

Example configurable Gears:

```text
G1 0.05
G2 0.10
G3 0.20
G4 0.50
```

A Strategy/Template/Colony may select a default Gear.

ARISE may calculate monetary exposure internally for safety but must not silently resize the order from account-equity percentage logic.

---

## 6. Pre-trade validation

Before creating broker exposure, evaluate deterministic checks.

At minimum:

```text
Agent connected
Broker connected
Correct account
Account mode permitted
Quote fresh
Spread within policy
Instrument tradeable
Colony valid
Idea not invalidated
Runtime action still valid
Candidate not expired
Attempt budget available
Stacking permission available
Fresh-risk budget available
Session policy passed
Economic-news policy passed
Size valid for broker
Stop can be represented
No duplicate execution
Automation deployment permission valid
```

Each check produces:
- PASS
- BLOCK
- ERROR
- optional diagnostic.

`ERROR` blocks automated execution.

---

## 7. OrderPlan

After validation, freeze an immutable OrderPlan.

Example:

```text
BUY 0.10 EURUSD
Entry       MARKET
Initial SL  1.08414
Target      managed by Colony
Max Spread  1.2p
Max Slippage 0.5p
Expiry      30 sec
```

The plan freezes:
- prices,
- exact strategy/version context,
- exact MarketObjectVersions used,
- quote snapshot,
- Gear/size,
- policy parameters.

Later edits must not mutate an already-sent plan.

---

## 8. Entry types

V1 should support:
- MARKET
- LIMIT
- STOP
- delegated deterministic trigger where explicitly supported.

Additional broker order types may be added later.

---

## 9. Semantic stop calculation

Stop source may be:
- fixed pips
- explicit price
- MarketObjectVersion
- structural swing/object
- detector output
- manual price.

Example:

```text
Below [[5M Swing Low #82]]
Offset 2p
```

Execution Orchestrator resolves semantic rule into broker-valid price using:
- direction,
- Bid/Ask,
- tick size,
- digits,
- stop level,
- freeze level,
- current quote.

Historical OrderPlan stores the exact referenced version.

---

## 10. Target semantics

Target is not synonymous with broker TP.

Execution may use:
- no broker TP,
- explicit broker TP,
- partial target,
- Colony-managed target,
- reference-only destination.

The OrderPlan must state which is intended.

---

## 11. Durable outbound commands

Before transmission, persist BrokerCommand.

Fields include:
- command ID
- idempotency key
- type
- payload
- status
- attempt count.

Possible types:
- CREATE_ORDER
- CANCEL_ORDER
- MODIFY_ORDER
- MOVE_STOP
- SET_TP
- PARTIAL_CLOSE
- FULL_CLOSE
- CANCEL_DELEGATED_RULE

Do not rely on volatile in-memory send state.

---

## 12. Idempotency

Every broker-affecting operation needs a stable idempotency key.

If ACK is lost:

```text
send E-1842
connection drops
retry E-1842
```

MT5 Agent must return the already-existing result rather than create duplicate exposure.

This is mandatory.

---

## 13. Inbound broker deduplication

Broker/Agent events require unique external event keys.

If the same fill event arrives twice, domain effects occur once.

Persist event receipt/deduplication metadata.

---

## 14. Order acceptance vs fill

Do not equate:

```text
ORDER ACCEPTED
```

with:

```text
POSITION FILLED
```

Execution lifecycle should distinguish:
- SENT
- ACKNOWLEDGED
- WORKING
- PARTIALLY_FILLED
- FILLED
- PROTECTING
- ACTIVE.

A Scout exists as filled exposure only after confirmed broker fill.

---

## 15. Partial fills

Example:

```text
Requested 0.50
Filled    0.30
Remaining 0.20
```

Requirements:

1. Protect the 0.30 filled portion immediately.
2. Do not wait for the remainder before protection.
3. Track remaining order quantity explicitly.
4. Support remainder policy.
5. Reconcile later fills with current protection/position state.

Remainder policy options:
- KEEP_WORKING
- CANCEL_AFTER_DURATION
- CANCEL_AFTER_FIRST_PARTIAL
- MANUAL.

UI should expose contextual `CANCEL REMAINDER` only when remainder exists.

---

## 16. Hedging vs netting

MT5 hedging accounts are preferred for ARISE because independent Scouts/Legs map naturally to independent broker positions.

V1 stance:

```text
HEDGING  preferred/full model
NETTING  supported with explicit limitations
```

Netting compatibility must preserve internal logical Trade/PositionLeg lineage even if broker exposure is aggregated.

Do not silently treat a netted broker position as one conceptual Trade.

---

## 17. Initial protection

Every automated Scout should normally obtain broker-native catastrophic SL protection.

Sequence:

```text
fill
 ↓
calculate/validate SL
 ↓
send SL
 ↓
refresh broker state
 ↓
verify SL
```

Until verified, state is `UNPROTECTED` / `PROTECTING`, not safely active.

---

## 18. Initial-SL failure

If initial SL is rejected:

```text
UNPROTECTED_POSITION
CRITICAL
```

Recommended automated V1 fallback:

```text
recalculate broker-valid SL
    ↓
retry
    ↓
if still not protected
    ↓
close newly filled Scout
```

The MT5 Agent should be able to complete this safety path if Desktop disconnects immediately after fill.

---

## 19. Spread validation

Spread should be checked:
1. when signal/Intent is created where relevant,
2. immediately before broker execution,
3. locally by MT5 Agent for delegated triggers.

A valid earlier spread does not authorize execution into a later spread spike.

---

## 20. Slippage

Distinguish:

### PRE-EXECUTION PRICE DEVIATION
Can block an entry before sending.

### POST-FILL SLIPPAGE
Actual broker fill differs from expected price.

Post-fill slippage is recorded and may invoke an explicit exceptional-fill policy.

Never pretend a fill did not occur merely because slippage exceeded expectation.

---

## 21. Candidate expiry

Order/trigger validity must be explicit.

Examples:
- 30 seconds
- current candle
- until 10:30
- until Area invalidates
- until session end.

Expired Candidate/OrderPlan cannot execute.

---

## 22. Delegated execution

ARISE may send an already-authorized deterministic rule to the MT5 Agent.

Example:

```text
rule DR-81
EURUSD LONG
ASK <= 1.08462
size 0.10
SL 1.08390
max spread 1.2p
expires 10:30
one shot
```

Agent responsibilities:
- monitor trigger,
- enforce expiry,
- enforce local spread/price constraints,
- execute once,
- place initial protection,
- report result.

The Agent must not create new Strategy Graph decisions.

---

## 23. Desktop disconnect during delegated rule

Existing valid delegated rules may continue.

Desktop-owned strategy progression pauses.

No new strategic rule is invented by Agent.

On reconnect:
- enumerate delegated rules,
- enumerate broker positions/orders,
- reconcile before resuming Desktop automation.

---

## 24. Manual MT5 positions

If broker contains an unknown position:

```text
EXTERNAL POSITION DETECTED
```

ARISE may offer:
- ATTACH_TO_COLONY
- TRACK_AS_EXTERNAL
- IGNORE for ARISE management, while still acknowledging account exposure.

If attached, preserve source:
`EXTERNAL_MANUAL`

Never rewrite history to claim ARISE created it.

---

## 25. Explicit scopes

Execution/close commands must have explicit scope:
- POSITION
- SELECTED_POSITIONS
- COLONY
- INSTRUMENT
- ACCOUNT.

Do not infer account-wide behavior from a single-position command.

---

## 26. End Session vs Flatten

`END SESSION`:
- stop new Scouts,
- cancel Candidates,
- cancel pending entries as configured,
- cancel delegated entries,
- keep existing positions,
- keep protection active.

`FLATTEN`:
- changes broker exposure.

They are different commands.

---

## 27. Flatten semantics

Support explicit:
- FLATTEN_POSITION
- FLATTEN_COLONY
- FLATTEN_INSTRUMENT
- FLATTEN_ACCOUNT.

Flatten must also reconcile/cancel related pending orders and delegated entry rules to prevent accidental re-entry or reversal.

Account Flatten should require stronger confirmation.

---

## 28. Per-position command serialization

Commands targeting the same live position should be serialized.

Example:

```text
Position #24 queue
1 Move SL
2 Partial Close
3 Full Close
```

Once broker reality closes the position, pending modifications become `SUPERSEDED`.

Separate positions may process independently.

---

## 29. Race priority

Recommended priority:

```text
BROKER EXECUTION REALITY
>
EMERGENCY FLATTEN
>
MANUAL CLOSE
>
PROTECTIVE ACTION
>
STRATEGY ACTION
>
NEW ENTRY
```

Broker truth always wins.

---

## 30. Account mismatch

If ARISE expects one broker account but Agent reports another:

```text
ACCOUNT_MISMATCH
AUTOMATION BLOCKED
```

No new exposure until deliberate reassociation/confirmation.

Demo/live identity must be explicit.

---

## 31. Reconciliation

On startup/reconnect compare:
- account
- open positions
- pending orders
- quantity
- entry price
- SL
- TP
- broker tickets
- delegated rules.

Classify:
- MATCH
- BROKER_ONLY
- ARISE_ONLY
- QUANTITY_MISMATCH
- PROTECTION_MISMATCH
- UNKNOWN.

Do not blindly resend exposure.

---

## 32. Runtime modes

Execution modes:
- OBSERVE
- SHADOW
- DEMO
- LIVE.

### SHADOW
Creates hypothetical Intents/Plans/fills without broker commands.

### DEMO
Real broker protocol against approved demo account.

### LIVE
Requires explicit live approval and deployment permissions.

---

## 33. Audit timeline

Every Trade should expose a chronological execution trace such as:

```text
Strategy confirmed
ExecutionIntent created
Spread PASS
Quote freshness PASS
OrderPlan frozen
Command sent
Order accepted
Partial/full fill
SL requested
SL verified
Scout ACTIVE
```

Timestamps should be precise enough for execution diagnosis.

---

## 34. Required execution tests

Mandatory:
- duplicate command retry creates one order
- duplicate fill event creates one domain fill
- partial fill receives immediate protection
- remainder cancel works
- initial SL rejection fallback
- Desktop crash before ACK
- Desktop crash after broker fill
- Agent restart
- manual broker close
- external stop modification
- stale quote blocks entry
- spread spike blocks final send
- expired Candidate cannot execute
- account mismatch blocks automation
- flatten cancels residual entry orders
- one-position BE/close never changes unrelated positions
- broker-closed position is never recreated
