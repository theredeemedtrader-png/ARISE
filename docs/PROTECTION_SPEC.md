# ARISE — PROTECTION_SPEC.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define post-fill protection, management proposals, stop calculation, partial exits, structural trailing, position-state interaction, stacking controls and Colony-level management.

---

## 1. Governing principle

> Position state describes what a position has become. Management policy decides what ARISE may do about it.

Never encode automatic stop/exit behavior directly into a PositionState transition.

---

## 2. Protection architecture

```text
Market / Strategy / Position / Target Event
    ↓
Protection Rule
    ↓
Trigger Evaluation
    ↓
Scope + Eligibility
    ↓
Protection Proposal
    ↓
Conflict Resolution
    ↓
Price / Quantity Calculation
    ↓
Broker Validation
    ↓
Protection Request
    ↓
MT5 / Broker
    ↓
Verification
    ↓
Position / Colony Event
```

---

## 3. Protection state

Protection is independent of PositionState.

Operational protection states:
- UNPROTECTED
- PROTECTION_PENDING
- PARTIALLY_PROTECTED
- PROTECTED
- PROTECTION_ERROR.

Examples:

```text
SURVIVOR + UNPROTECTED
SCOUT + PROTECTED
LEG + PROTECTED
```

are all conceptually possible.

---

## 4. Protection criteria

A Position becomes `PROTECTED` only when its configured criterion is satisfied and verified.

Possible criteria:
- worst-case exit >= Price BE
- worst-case exit >= True BE
- worst-case exit >= configured negative pip tolerance
- stop beyond specified Market Object
- locked minimum pips
- manual confirmation.

No global assumption that “positive stop = protected” is allowed.

---

## 5. Trigger types

V1 trigger vocabulary:

- PRICE_TOUCH
- PRICE_CROSS
- WICK_THROUGH
- CANDLE_CLOSE_ABOVE
- CANDLE_CLOSE_BELOW
- RECLAIM
- ENTER_ZONE
- EXIT_ZONE
- STRATEGY_NODE_CONFIRMED
- POSITION_STATE_CHANGED
- TARGET_APPROACHING
- TARGET_HIT
- MANUAL.

Future/optional:
- TIME_ELAPSED
- ECONOMIC_EVENT_APPROACHING
- SESSION_END
- NEW_HTF_CANDLE.

---

## 6. Action types

Core actions:

- MOVE_TO_PRICE_BE
- MOVE_TO_TRUE_BE
- BE_PLUS_OFFSET
- LOCK_PIPS
- LOCK_MONEY
- LOCK_PERCENT_OPEN_PROFIT
- MOVE_TO_PRICE
- MOVE_TO_MARKET_OBJECT
- TRAIL_FIXED_DISTANCE
- TRAIL_MARKET_OBJECT
- TRAIL_STRUCTURE
- PARTIAL_CLOSE
- FULL_CLOSE
- REMOVE_TP
- SET_TP
- CONVERT_TO_RUNNER.

Promotion/state changes should remain explicit orchestration actions, not hidden side effects.

---

## 7. Price BE

Price BE is raw entry-price break-even.

It does not attempt to compensate for:
- commission,
- swap,
- spread/executable exit side,
- other fees.

It remains useful as a simple management reference.

---

## 8. True BE

True BE is economic break-even using actual/estimated trading costs.

Inputs may include:
- actual fill prices,
- actual size,
- executable exit side,
- commission,
- swap,
- configured broker fees.

Fee modes:
- BROKER_REPORTED
- ESTIMATED
- CUSTOM.

True BE should avoid double-counting spread.

The calculation must be covered by deterministic unit tests.

---

## 9. BE+

`BE_PLUS_OFFSET` applies an explicit pip/price offset beyond selected BE basis.

Example:
- True BE + 2p.

Do not implement BE+ as an ambiguous UI-only shortcut.

Persist exact basis and offset.

---

## 10. Lock pips / money

Support:
- POSITION_LOCK
- TRADE_LOCK
- later COLONY_LOCK.

`LOCK_PIPS` calculates a stop/exit configuration that protects a requested pip result where broker constraints allow.

`LOCK_MONEY` remains supported even in `$ HIDDEN`; hiding dollars is presentation only.

---

## 11. Scope

Every ProtectionRule declares scope.

Examples:
- THIS_POSITION
- SELECTED_POSITIONS
- ALL_SCOUTS
- ALL_SURVIVORS
- ALL_UNPROTECTED
- ALL_LEGS
- ALL_MATURE_LEGS
- ALL_POSITIONS_IN_COLONY
- POSITIONS_MATCHING_TAG.

Scope is never inferred from button placement alone.

---

## 12. Eligibility

Scope and eligibility are separate.

Example:

```text
Scope:
ALL_POSITIONS_IN_COLONY

Eligibility:
only LONG positions
only current size > 0
only not already True BE
```

This makes policies auditable and reusable.

---

## 13. ProtectionProposal

Before broker action, create a proposal containing:
- Position(s)
- ProtectionRuleVersion
- Trigger event
- current broker state
- proposed action
- proposed stop/quantity/TP
- expected effect
- diagnostics
- createdAt.

In AUTO mode the proposal may immediately continue to validation/send, but it still exists historically.

---

## 14. Conflict resolution

Multiple rules may propose actions simultaneously.

Default stop conflict policy:

> Most protective valid stop wins.

For LONG:
higher valid stop wins.

For SHORT:
lower valid stop wins.

A proposal that worsens protection is rejected by default unless an explicit advanced policy authorizes loosening.

Partial/full-close conflicts require deterministic precedence.

A FULL_CLOSE supersedes pending stop modifications for the same Position once broker close is authoritative.

---

## 15. Broker validation

Before sending stop/TP modifications validate:
- position still exists
- current quantity
- direction
- Bid/Ask
- quote freshness
- tick size
- digits
- stop level
- freeze level
- broker minimum distance
- proposed stop direction
- whether proposal worsens protection
- command not superseded.

Blocked validation produces an explicit result, never silent failure.

---

## 16. Verification

Protection lifecycle:

```text
CREATED
CALCULATED
VALIDATED
SENT
ACCEPTED
CONFIRMED
VERIFIED
```

Alternate:
- BLOCKED
- REJECTED
- FAILED
- SUPERSEDED
- CANCELLED.

`VERIFIED` requires refreshed broker state to show the expected protection.

---

## 17. Structural protection

Protection can reference Market Objects/structure.

Examples:

```text
Trail below latest confirmed 1H higher low
Move SL below D FVG #03
Trail 4H protected swing
```

The semantic rule resolves to broker-valid price through the Protection Engine.

---

## 18. Frozen vs live-linked objects

### FROZEN
Uses a specific MarketObjectVersion.

Later chart edits do not alter the rule.

### LIVE_LINKED
Follows the current version of the MarketObject.

Editing a live-linked object controlling active protection must warn the user.

Deletion/archive must not silently orphan active protection rules.

---

## 19. Structural trail recurrence

A recurring structural trail:
1. detects new qualifying structure,
2. resolves new object/reference,
3. calculates stop proposal,
4. compares to current protection,
5. only improves by default,
6. sends/validates/verifies,
7. records history.

Do not move stop on every UI redraw.

---

## 20. Impossible stop target

If requested stop cannot currently be placed because of broker distance/freeze constraints:

Default policy:
`WAIT_UNTIL_ACHIEVABLE`

Alternatives may include:
- use nearest valid price,
- manual confirmation,
- cancel rule.

Never report success before broker verification.

---

## 21. Manual MT5 stop changes

When broker stop differs from ARISE expectation:
- detect discrepancy,
- classify as external/manual where appropriate,
- update current broker truth,
- preserve previous ARISE proposal/history,
- reevaluate active management policy.

Do not immediately overwrite a more protective manual stop merely to restore stale ARISE state.

---

## 22. Partial closes

A partial close preserves Trade/Position lineage.

Store:
- original size,
- quantity closed,
- fill price,
- realized pips/money,
- remaining size,
- trigger/rule,
- broker fill.

Do not create an unrelated new trade for the remainder.

---

## 23. Runner conversion

Runner conversion:
- preserves original Colony,
- preserves original Target,
- records target history,
- records conversion event,
- assigns exact runner ManagementPolicyVersion.

Runner conversion must never automatically loosen SL.

---

## 24. Individual BE

Default V1 basket behavior is independent position protection.

Example:

```text
Scout A → True BE A
Scout B → True BE B
Leg C   → structural stop C
```

One position's BE action must not modify unrelated positions.

---

## 25. Colony BE

Colony BE is an advanced basket-level economic objective.

It calculates the combined price/protection condition at which selected Colony exposure reaches economic break-even.

Important:
- Colony BE is not automatically one shared broker stop.
- It may be display-only.
- It may propose protection allocation across positions.
- Broker hedging/netting behavior must be respected.

Modes:
- DISPLAY_ONLY
- APPLY_EQUIVALENT_BASKET_PROTECTION
- SELECTED_POSITIONS
- MANUAL.

Implement after individual protection is stable.

---

## 26. Colony Lock

Advanced future/late-V1 capability:

```text
LOCK +50 COLONY PIPS
LOCK $250 COLONY PROFIT
```

The engine calculates protection allocation while respecting:
- individual broker positions,
- minimum distances,
- existing stronger stops,
- size,
- execution costs.

Do not weaken individual protection to achieve a basket target unless explicitly authorized.

---

## 27. Position-state criteria

ManagementPolicy may define criteria for:
- Survivor
- Protected
- Leg
- Mature Leg.

Examples:
- Market Object reached
- strategy node confirmed
- structure held X candles
- pip progress
- target progress
- manual confirmation.

State transitions remain separate from the management action that may follow them.

---

## 28. StackingPolicy

A valid entry signal is not sufficient permission to add another Scout.

Modes:
- ANY_VALID_ENTRY
- ONLY_AFTER_SURVIVOR
- ONLY_AFTER_PROTECTED
- ONLY_AFTER_LEG
- MANUAL.

Additional controls:
- max active Scouts
- max fresh risk
- max attempts
- scouting-loss budget
- cooldown
- target-proximity block.

---

## 29. Fresh risk

Fresh Risk measures currently exposed downside that has not been materially secured.

It is distinct from:
- total open lots,
- total Colony exposure,
- protected exposure.

A protected Mature Leg may add large exposure but little/no Fresh Risk under the selected criterion.

Use pip-first/position-pip representations in operational UI.

---

## 30. Attempt budget

Colony AttemptBudget may define:
- max attempts
- max scouting loss pips
- cooldown
- reset condition.

Reset options:
- NEW_SESSION
- NEW_CANDLE
- NEW_STRUCTURAL_EVENT
- NEW_AREA_TOUCH
- NEW_STRATEGY_SIGNAL
- MANUAL.

When exhausted:
- thesis may remain valid,
- Strategy Runtime may continue observing,
- new Scout creation is blocked until reset/override.

---

## 31. Target approach

Target progress is spatial, not probabilistic.

Example:

```text
origin  1.07420
target  1.10240
current 1.09610
progress 78%
```

This means distance progress, not 78% probability.

For zones, progress may measure to near edge.

---

## 32. Target actions

At Target/Target Approaching, policy may:
- block new Scouts,
- move protection,
- partial close,
- full close,
- trail,
- manual decision,
- convert remainder to Runner.

Example policy:

```text
At target:
close Scouts 100%
close Legs 50%
keep Mature Legs
offer Runner conversion
```

Every action remains explicit and audited.

---

## 33. Thesis invalidation

Thesis invalidation should:
- stop new Scouts,
- cancel pending Candidates,
- disarm relevant Strategy Runtime,
- notify.

Existing positions follow configured policy:
- KEEP_MANAGING
- TIGHTEN
- MOVE_TO_PROTECTION
- CLOSE_ALL
- MANUAL_DECISION.

Default V1:
`MANUAL_DECISION`.

Do not automatically equate thesis invalidation with account flatten.

---

## 34. Management ladder

A ManagementPolicy may be represented as ordered stages, e.g.:

```text
Scout
  initial stop

Survivor
  no change

40% target progress
  True BE

1H continuation
  lock +15p

80% target progress
  trail 1H structure

Target hit
  partial 50%
  offer Runner conversion
```

This can later receive a visual editor, but must remain data-driven.

---

## 35. Strategy vs management

Primary Strategy Graph:
> How do we acquire exposure?

Management/Protection:
> What do we do with acquired exposure?

Communicate through explicit events rather than hiding management side effects in entry nodes.

---

## 36. Safety precedence

Safety/broker reality overrides management preference.

Recommended command priority:

```text
BROKER REALITY
>
EMERGENCY FLATTEN
>
MANUAL CLOSE
>
PROTECTION
>
STRATEGY ACTION
>
NEW ENTRY
```

If position is broker-closed, queued protection commands are superseded.

---

## 37. Required protection tests

Mandatory:
- Price BE calculation LONG/SHORT
- True BE with commission/costs
- no spread double-count
- BE+ offset
- most-protective conflict LONG
- most-protective conflict SHORT
- no automatic stop worsening
- broker min-distance block
- freeze-level handling
- verification mismatch
- live-linked Market Object update
- frozen Market Object does not change
- manual stronger MT5 stop preserved
- partial close lineage
- Runner conversion does not loosen stop
- one-position BE does not affect Colony peers
- AttemptBudget blocks new Scout
- StackingPolicy requires Survivor/Protected/Leg correctly
- target progress is spatial
- thesis invalidation default does not flatten
