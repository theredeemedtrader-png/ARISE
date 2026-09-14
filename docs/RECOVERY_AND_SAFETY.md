# ARISE — RECOVERY_AND_SAFETY.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define crash recovery, broker reconciliation, safety states, command durability, health monitoring, failure handling and regression requirements.

---

## 1. Governing safety rule

> If ARISE is uncertain about broker reality, it must stop creating new exposure, preserve existing protection, reconcile state, and only resume automation when reality is known.

This rule overrides convenience, strategy urgency and UI state.

---

## 2. Restart model

ARISE must be restart-safe.

On startup:

```text
Load durable local state
    ↓
Initialize database/migrations
    ↓
Connect MT5 Agent
    ↓
Verify Agent protocol version
    ↓
Verify broker account identity
    ↓
Fetch broker positions/orders/stops/delegated rules
    ↓
Reconcile
    ↓
Resolve mismatches
    ↓
Resume only if safe
```

Strategy Runtime resumes from persisted node states and must not restart the cascade from the beginning.

---

## 3. Durable local state

Persist enough operational state to reconstruct:
- Ideas / IdeaVersions
- Colonies
- Market Objects / versions
- StrategyMapVersion
- StrategyRuntime
- RuntimeNode states
- Attempts
- Trades
- Positions
- Protection rules/assignments
- delegated execution rules
- current account association
- Review state
- workspace state.

Historical event records remain immutable.

---

## 4. SQLite transaction boundaries

Use database transactions for logically atomic local writes.

Example broker fill processing may atomically create:
- ExecutionFill
- Position update
- Trade/Position association
- PositionStateEvent
- domain event
- audit entry.

A crash mid-local-write should not create half-applied domain state.

---

## 5. External broker operations are not database transactions

Never assume broker send + SQLite write are one atomic transaction.

Use durable command state:

```text
persist BrokerCommand
    ↓
send to Agent
    ↓
receive acknowledgement/event
    ↓
persist result
    ↓
update domain state
```

If ARISE crashes after send but before acknowledgement, the original idempotency key is used to determine what actually happened.

Do not blindly resend as a new order.

---

## 6. Command outbox

Maintain a durable outbound command queue.

Suggested states:
- CREATED
- SENDING
- ACKNOWLEDGED
- COMPLETED
- FAILED
- SUPERSEDED
- CANCELLED
- UNKNOWN.

Fields should include:
- command_id
- idempotency_key
- command_type
- payload
- created_at
- last_attempt_at
- attempt_count
- status.

---

## 7. Broker event inbox / deduplication

Inbound Agent/broker events may repeat.

Persist:
- broker_event_id / deduplication key
- payload hash
- first_received_at
- processed_at.

If event identity was already processed, do not repeat domain effects.

Design for at-least-once transport and effectively-once domain effects.

---

## 8. Broker reality is authoritative

ARISE owns:
- semantic intent
- Thesis/Colony identity
- Strategy Runtime
- management policies
- review/evidence.

Broker owns:
- actual open positions
- actual pending orders
- actual filled quantity
- actual entry price
- actual SL
- actual TP
- broker tickets.

When broker truth and ARISE expected state disagree, current operational state must reconcile to broker truth while preserving the discrepancy/history.

---

## 9. Reconciliation categories

At startup/reconnect classify every relevant entity:

### MATCH
ARISE and broker agree.

### BROKER_ONLY
Broker has position/order unknown to ARISE.

Action:
- track as external,
- optionally attach to Colony,
- never pretend ARISE created it.

### ARISE_ONLY
ARISE expects exposure/order but broker does not show it.

Action:
- query broker history if available,
- record likely external close/stop/expiry,
- never recreate automatically.

### QUANTITY_MISMATCH
Possible partial close/fill/manual action.

### PROTECTION_MISMATCH
SL/TP differs.

### UNKNOWN
State cannot yet be safely resolved.

UNKNOWN blocks new exposure.

---

## 10. Account mismatch

If expected account != connected account:

```text
ACCOUNT_MISMATCH
AUTOMATION BLOCKED
```

No new broker-affecting automated action until the user deliberately resolves the association.

Demo/live status must be explicit.

---

## 11. Connection state

Canonical connection states:
- CONNECTED
- DEGRADED
- DISCONNECTED
- RECONNECTING
- RECONCILING
- BLOCKED.

Track independently:
- Desktop↔Agent health
- Agent↔MT5 health
- broker health
- quote health
- database health
- calendar provider health.

---

## 12. Heartbeats

Desktop and MT5 Agent exchange heartbeats.

Example policy:
- healthy heartbeat every ~1s
- DEGRADED after configurable missed threshold
- DISCONNECTED after longer threshold.

Exact timings are configuration, not domain semantics.

Agent should know when Desktop is unavailable so delegated-rule behavior remains explicit.

---

## 13. Delegated-rule behavior during disconnect

Already-authorized deterministic delegated entry rules may continue if:
- rule remains valid,
- expiry has not passed,
- spread/price constraints pass,
- Agent/broker are healthy.

Desktop-owned strategy progression pauses.

The Agent must not invent new strategic decisions.

On reconnect, delegated rules are enumerated and reconciled.

---

## 14. Delegated-rule expiry

Every delegated entry rule requires:
- absolute expiry time,
- candle/session expiry,
- or explicit invalidation condition.

No accidental persistent entry trigger.

Expired rules become non-executable even if their condition is later observed.

---

## 15. Quote failure

If quote stream becomes stale:
- mark Market Data Health STALE,
- block new exposure,
- block new execution-sensitive management if safe evaluation is impossible,
- keep existing broker-native SL/TP untouched.

Quote recovery must be confirmed before automation resumes.

---

## 16. Missing candle/history recovery

After reconnect:
- identify last canonical candle,
- request broker history,
- fill gaps,
- validate continuity,
- tag recovered events as RECOVERED_HISTORY.

Do not execute stale recovered entry triggers unless strategy explicitly supports persistent validity and current context still satisfies it.

---

## 17. Candidate freshness after recovery

All executable Candidates/OrderPlans must be checked against:
- expiry time,
- current candle identity,
- Area validity,
- strategy-runtime validity,
- current spread/quote.

An expired Candidate cannot become fresh merely because ARISE restarted.

---

## 18. Clock integrity

Persist UTC timestamps.

Maintain broker/server time relationship separately.

Review Scheduler, timeframe boundaries, expiry and economic events must not depend on unsynchronized Windows local time alone.

Clock/offset anomalies should generate a SafetyEvent where they can affect execution.

---

## 19. Initial protection failure

If a new automated fill cannot receive verified broker-native initial protection:

```text
UNPROTECTED_POSITION
severity: CRITICAL
```

Recommended automated fallback:
1. recalculate valid protection,
2. retry,
3. if still unprotected within configured safe window, close the new Scout,
4. verify close,
5. record SafetyEvent.

This logic belongs close to the MT5 Agent.

---

## 20. Protection mismatch

If Agent reports success but refreshed broker state does not match expected stop/TP:
- do not mark VERIFIED,
- create PROTECTION_MISMATCH,
- retry/reconcile according to policy,
- notify if unresolved.

---

## 21. Manual broker changes

Detect manual/external:
- close
- partial close
- stop move
- TP move
- pending-order cancellation
- new position.

Record provenance as USER/EXTERNAL/BROKER where possible.

Do not immediately overwrite a more protective manual stop with stale ARISE state.

---

## 22. Command serialization

Serialize broker-affecting commands per Position/order scope where race conflicts are possible.

Example queue:
- Move SL
- Partial Close
- Full Close.

Once broker reports position closed, pending modifications are SUPERSEDED.

---

## 23. Race priority

Recommended precedence:

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

No lower-priority command should resurrect or contradict higher-priority broker reality.

---

## 24. Safe Mode

First-class state:

```text
SAFE_MODE
```

Allowed:
- market data
- charts
- review
- knowledge
- analytics
- broker monitoring
- existing broker-native protection.

Blocked:
- new automated exposure
- new delegated entries
- strategy-generated broker actions.

Use after:
- crash
- upgrade
- migration issue
- account mismatch
- major strategy-engine error
- database inconsistency.

---

## 25. End Session

`END SESSION` means:
- stop new Scouts,
- cancel Candidates,
- cancel pending entries as configured,
- cancel delegated entry rules,
- keep existing open positions,
- keep protection active.

It is not a flatten command.

---

## 26. Flatten

Explicit scopes:
- FLATTEN_POSITION
- FLATTEN_COLONY
- FLATTEN_INSTRUMENT
- FLATTEN_ACCOUNT.

Flatten must also cancel/reconcile related pending orders/delegated entries so no residual reversal/re-entry is possible.

Account Flatten requires stronger confirmation.

---

## 27. Recovery Required UI

When state cannot be automatically reconciled:

```text
RECOVERY_REQUIRED
```

UI must display:
- broker reality
- ARISE expected state
- exact mismatch
- affected positions/orders
- available resolution actions.

Possible actions:
- ACCEPT_BROKER_STATE
- MAP_POSITION
- TRACK_EXTERNAL
- FLATTEN
- CANCEL_PENDING
- RESOLVE_MANUALLY.

Never silently guess.

---

## 28. Audit log

Every consequential event must include:
- timestamp
- entity
- source
- previous state
- new state
- reason
- correlation ID
- linked evidence if applicable.

Sources:
- USER
- STRATEGY
- MANAGEMENT_POLICY
- MT5_AGENT
- BROKER
- RECOVERY_ENGINE
- SYSTEM.

---

## 29. SafetyEvent

Canonical types may include:
- UNPROTECTED_POSITION
- STALE_QUOTES
- ACCOUNT_MISMATCH
- BROKER_DISCONNECTED
- AGENT_DISCONNECTED
- PROTECTION_REJECTED
- PROTECTION_MISMATCH
- POSITION_MISMATCH
- ORDER_MISMATCH
- DATABASE_ERROR
- AGENT_VERSION_MISMATCH
- CLOCK_ANOMALY
- RECOVERY_REQUIRED.

Severity:
- INFO
- WARNING
- HIGH
- CRITICAL.

---

## 30. Desktop↔Agent version handshake

On connection exchange:
- app version
- protocol version
- minimum compatible version
- account info.

Protocol incompatibility:
- block broker automation,
- allow non-trading app functionality where safe,
- show clear System Health error.

---

## 31. Database backup

Recommended:
- SQLite WAL mode
- scheduled local snapshots
- retention such as daily + monthly tiers
- backup manifest linking database and evidence assets.

Exact retention is configurable.

Backups must not copy an inconsistent live database state naively; use SQLite-safe backup mechanisms.

---

## 32. Asset integrity

Evidence assets should store:
- file path
- SHA-256 hash
- size
- captured_at.

If image is missing/corrupt:
- preserve EvidenceEvent and machine-readable state,
- display explicit missing/corrupt asset state,
- never substitute an unrelated image.

---

## 33. Schema migrations

Database schema uses ordered, version-controlled migrations.

Do not perform ad-hoc runtime schema mutation based on current TypeScript models.

Migration failure should enter Safe Mode / Recovery Required rather than partially continuing.

---

## 34. Event schema versioning

Persisted event payloads should include:
- event_type
- schema_version.

Old history must remain readable after software upgrades.

---

## 35. Runtime modes

- OBSERVE
- SHADOW
- DEMO
- LIVE.

A software update or unresolved recovery condition may automatically downgrade runtime permission to SAFE_MODE/OBSERVE, but must never silently upgrade to LIVE.

---

## 36. Strategy deployment approval

Executable StrategyVersion lifecycle:
- EXPERIMENTAL
- VALIDATED
- DEMO_APPROVED
- LIVE_APPROVED
- RETIRED.

New code does not become live merely because it compiles.

A graph is limited by the least-approved executable dependency.

---

## 37. DeploymentSnapshot recovery

Active DEMO/LIVE Colony behavior must restore from its frozen DeploymentSnapshot.

After restart, current Encyclopedia edits must not alter the active runtime.

If exact code/detector version required by the snapshot is unavailable:
- block the affected automation,
- preserve positions/protection,
- surface version mismatch.

---

## 38. Fake broker / Agent harness

Testing infrastructure must simulate:
- delayed ACK
- dropped ACK
- duplicate ACK
- duplicate fill event
- partial fill
- multiple partial fills
- order rejection
- stop rejection
- spread spike
- stale quote
- Desktop crash after send
- Desktop crash after fill
- Agent restart
- MT5 restart
- manual stop move
- manual close
- broker close while disconnected
- out-of-order events
- account change
- history gap.

---

## 39. Critical regression suite

Before LIVE capability:
- no duplicate entry after reconnect
- filled quantity gets initial protection
- SL rejection fallback works
- manual close is never recreated
- duplicate strategy event creates one Scout
- Desktop crash before ACK does not duplicate
- Desktop crash after fill reconstructs position
- MT5 restart reconciles
- stale quote blocks new exposure
- account mismatch hard-blocks automation
- flatten leaves no pending reversal/re-entry
- one-position protection does not alter unrelated positions
- historical recovered trigger does not create stale entry
- active DeploymentSnapshot resumes exact versions
- unresolved broker mismatch forces Recovery Required.

---

## 40. Final safety invariant

Whenever the system cannot confidently answer:

> What exposure actually exists at the broker right now?

the only safe automated posture is:

```text
NO NEW EXPOSURE
PRESERVE PROTECTION
RECONCILE
VERIFY
RESUME
```
