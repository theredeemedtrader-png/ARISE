# ARISE — TEST_PLAN.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define ARISE testing layers, fixtures, failure injection, release gates and acceptance requirements.

---

## 1. Testing philosophy

ARISE is trading software.

A passing happy-path UI demo is not sufficient.

The test strategy prioritizes:

1. deterministic domain behavior,
2. historical integrity,
3. no duplicate exposure,
4. protection correctness,
5. restart/recovery,
6. explainability,
7. regression resistance.

Execution and protection changes require stronger testing than ordinary UI changes.

---

## 2. Test layers

### Unit
Pure domain logic, calculations, detectors, state transitions.

### Contract
Desktop↔MT5 Agent protocol and provider adapters.

### Integration
SQLite + services + event routing + fake Agent.

### End-to-end
Electron/React workflows through Playwright where practical.

### Failure injection
Disconnects, duplicates, partial fills, broker errors, crashes.

### Manual exploratory
Chart interaction, visual Graph UX, multi-monitor, broker demo validation.

---

# 3. Domain unit tests

Cover:
- state machines
- transition guards
- target progress
- pip calculations
- Fresh Risk
- AttemptBudget
- StackingPolicy
- scope/eligibility
- version resolution
- lineage.

No UI/database dependencies.

---

## 4. State-machine tests

Position:
- Candidate→Scout
- Scout→Survivor
- Survivor→Protected
- Protected→Leg
- Leg→Mature
- Mature→Runner
- terminal state restrictions.

Verify:
- Survivor does not imply BE
- Protected is separate from PositionState logic
- Closed cannot reopen.

Colony:
- Dormant→Building→Established→Mature
- invalidation
- completion
- decay.

Runtime:
- Dormant→Armed→Watching→Triggered→Confirmed
- failure
- expiry
- bypass
- manual confirmation.

---

# 5. Timeframe tests

Canonical TimeframeService:
- 1m/5m/1H boundaries
- 4H
- 6H
- 8H
- 12H
- Daily
- Weekly
- Monthly
- DST/session handling where applicable
- parent/child mapping
- next-close calculation.

No subsystem-specific alternative timeframe calculation.

---

## 6. Timeframe Projection tests

Fixtures:
- Daily→1H
- Daily→5M
- 4H→15M
- Weekly→Daily
- nested D→1H→5M.

Verify exact interval membership and parent breadcrumb.

---

# 7. Pip/accounting tests

LONG/SHORT:
- open pips
- realized pips
- position-pips
- protected pips
- scouting cost.

Partial close:
- correct remaining size
- realized pips
- lineage preserved.

`$ HIDDEN` must not change calculations.

---

# 8. True BE tests

Test:
- LONG
- SHORT
- commission
- swap
- broker-reported fee
- estimated fee
- custom fee
- partial fills
- multiple fill prices
- executable exit side
- no spread double-count.

True BE must be deterministic.

---

# 9. Market Object tests

- create/version
- geometry update creates version
- semantic update creates version
- historical reference resolves old version
- live-linked reference resolves current version
- frozen reference remains old version
- deletion/archive warning for active dependency.

---

# 10. Document/link tests

- `[[Market Object]]` resolution
- Trade/Colony/Strategy links
- backlinks
- block links
- folder move
- entity-backed document
- Markdown export preserves supported links/metadata.

---

# 11. Detector tests

Every executable detector gets fixture-based regression tests.

Minimum initial detectors:

### Price Touch/Cross
- touch
- cross
- price-source Bid/Ask
- duplicate prevention.

### Zone Entry
- enter
- remain
- exit
- re-entry policy.

### Sweep
- LONG/SHORT
- wick-through
- reclaim
- invalid close-through
- manual liquidity object.

### Swing
- selected algorithm
- deterministic pivot identity.

### MSS
- valid LONG/SHORT
- close-required
- wick-allowed
- displacement-required
- stale swing
- duplicate break.

### Displacement
- threshold behavior
- direction.

### FVG
- bullish/bearish
- invalid geometry
- source Candle IDs
- object creation once.

### FVG Retracement
- intrabar trigger
- expired FVG
- correct MarketObject reference.

### Spread
- pass/block.

### Economic News
- relevant currency
- impact
- before/after window.

---

# 12. Strategy Graph tests

- AND
- OR
- THEN
- NOT
- modifier
- manual node
- action node
- multi-timeframe stage
- multiple purposes on one timeframe
- no fixed H/A/E assumptions.

Verify Simple and Graph representations serialize to same model.

---

# 13. Runtime persistence tests

Scenario:
1. D Area confirmed
2. 4H Sweep confirmed
3. 1H MSS WATCHING
4. close ARISE
5. restart
6. runtime restores at 1H MSS WATCHING.

Verify:
- upstream actions do not refire
- trigger count preserved
- exact StrategyMapVersion restored.

---

# 14. Duplicate event tests

Send same:
- Quote event
- BarClosed
- DetectorEvaluation
- Broker fill
- Agent ACK.

Verify domain effect occurs once where required.

---

# 15. Evidence tests

- EvidenceEvent persists before image capture
- capture failure does not roll back trading event
- original raster hash
- exact IdeaVersion
- exact StrategyMapVersion
- exact MarketObjectVersion
- Stage Summary links per-node evidence
- failed cascade evidence
- regenerated view labeled regenerated.

---

# 16. Review tests

Market Review:
- due cycle
- complete
- missed
- skipped
- Save+Next
- arbitrary timeframe
- review freshness.

Verify:
`MISSED != NEUTRAL`.

Trade Review:
- inception context
- evidence board
- management timeline
- Lesson links.

Study mode:
- outcome/future candles hidden until reveal.

---

# 17. Database migration tests

For every migration:
- fresh database applies all migrations
- previous supported schema upgrades
- data preserved
- migration version correct
- failure does not leave partial usable state.

Use fixtures from representative prior schema versions once releases exist.

---

# 18. Desktop↔Agent contract tests

Verify:
- protocol handshake
- version mismatch
- account identity
- quote stream
- bar/history request
- create order
- cancel order
- move SL
- partial close
- full close
- delegated rule create/cancel
- broker-state snapshot.

Schema validation mandatory.

---

# 19. Fake broker harness

Must simulate:
- normal fill
- delayed ACK
- dropped ACK
- duplicate ACK
- partial fill
- multiple partial fills
- rejected order
- rejected stop
- stale quote
- spread spike
- manual broker action
- broker disconnect
- Agent disconnect
- out-of-order events
- history gap
- account change.

---

# 20. Idempotency tests

Critical scenario:

```text
send execution E-1842
broker creates order
ACK lost
ARISE retries E-1842
```

Expected:
- one broker order
- one ARISE execution
- retry resolves existing result.

Repeat for:
- Move Stop
- Partial Close
- Full Close
- Cancel Order.

---

# 21. Partial-fill tests

Example:
- requested 0.50
- fill 0.30
- remainder 0.20.

Verify:
- 0.30 receives protection immediately
- UI/domain shows 0.30/0.50
- remainder policy honored
- later 0.20 fill integrates correctly
- Cancel Remainder cancels only pending remainder
- no opposite/reversal position created.

---

# 22. Initial protection tests

Simulate:
1. fill
2. SL request rejected
3. recalculation
4. retry.

Case A:
retry succeeds → VERIFIED.

Case B:
retry fails → Agent closes Scout → close VERIFIED → critical SafetyEvent.

No filled automated Scout may silently remain unprotected.

---

# 23. Protection conflict tests

LONG:
- current stop 1.0800
- proposal A 1.0820
- proposal B 1.0810
→ choose 1.0820.

SHORT:
- current 1.0900
- A 1.0880
- B 1.0890
→ choose 1.0880.

Verify stop-worsening proposal rejected by default.

---

# 24. Individual scope tests

Three positions in one Colony.

Apply:
`TRUE BE THIS_POSITION` to Scout B.

Verify:
- B changes
- A unchanged
- C unchanged.

This protects against historical bracket/quantity-style cross-position bugs.

---

# 25. Flatten tests

### Flatten Position
Only selected position closes.

### Flatten Colony
All Colony positions close and related pending entries/delegated rules cancel.

### Flatten Instrument
All instrument exposure closes per explicit scope.

### Flatten Account
All account exposure closes after strong confirmation.

Verify no pending entry can reopen/reverse after flatten.

---

# 26. Recovery tests

### Crash before send
No broker order.

### Crash after send before ACK
Reconnect/idempotency resolves existing order; no duplicate.

### Crash after fill before local state update
Reconciliation reconstructs broker position.

### Crash after fill before SL verification
Agent safety path protects/closes as configured.

### Broker closes while Desktop offline
Reconnect records broker close; never recreates.

---

# 27. Account mismatch tests

Expected account A, Agent reports B.

Verify:
- automation BLOCKED
- no new exposure
- clear SafetyEvent
- user must explicitly resolve.

---

# 28. Stale data tests

Quote exceeds freshness threshold.

Verify:
- new execution blocked
- existing native SL untouched
- runtime may continue non-execution observation where safe
- health state STALE.

Recovered historical trigger:
- evidence/history may update
- no stale entry created.

---

# 29. Deployment tests

Strategy versions:
- Sweep LIVE_APPROVED
- MSS LIVE_APPROVED
- FVG DEMO_APPROVED.

Graph maximum:
DEMO.

Verify LIVE launch rejected.

After FVG new LIVE-approved version:
- old active Colony remains on frozen DeploymentSnapshot
- new deployment can use new version
- explicit migration required for active Colony.

---

# 30. Safe Mode tests

Trigger:
- database migration failure
- protocol mismatch
- unresolved reconciliation.

Verify:
- chart/knowledge/review remain usable where safe
- no new automated broker exposure
- System Health shows cause.

---

# 31. UI E2E tests

Playwright scenarios:
- create Idea
- create Colony
- draw Market Object
- reference object in Thesis
- configure timeframe purposes
- create Strategy Map
- open LIVE runtime view
- complete Market Review
- inspect Evidence
- convert Highlight to Lesson
- open Trade from Database
- restore workspace tabs.

Do not use E2E tests as substitute for domain unit tests.

---

# 32. Visual regression

Use targeted screenshots for:
- Overview
- Thesis Canvas
- Trading Workspace
- Position Kanban
- Strategy Graph
- Review Board
- System Health.

Focus on layout regressions, not pixel-perfect anti-aliasing.

---

# 33. Performance tests

Measure:
- many Watchlist symbols
- multiple active Colonies
- active detector subscriptions
- chart with many Market Objects
- evidence capture queue
- React renderer under high tick rate.

Raw tick throughput must not force equivalent React render throughput.

---

# 34. Evidence performance

Simulate capture delay/failure during:
- strategy confirmation
- fill
- initial SL.

Verify:
- trading/protection flow continues
- EvidenceEvent remains
- capture retries asynchronously.

---

# 35. Review data integrity

Historical Trade Review must continue to resolve:
- original IdeaVersion
- StrategyMapVersion
- StrategyVersions
- MarketObjectVersions
- Evidence.

Editing current Thesis/Strategy/Object must not change historical review.

---

# 36. Release gates

### Alpha
- domain/state tests pass
- persistence stable
- no broker execution required.

### Shadow
- detector/runtime tests pass
- evidence/Decision Trace stable
- hypothetical execution only.

### Demo
- fake broker critical suite passes
- MT5 Agent contract passes
- reconciliation passes
- initial protection passes.

### Live
Requires:
- Demo soak period
- zero unresolved critical execution defects
- full recovery suite
- flatten suite
- idempotency suite
- protection suite
- explicit strategy LIVE_APPROVED
- explicit user live enablement.

---

# 37. Definition of done for trading code

A trading-related change is not done until:
- implementation complete
- typecheck passes
- lint passes
- unit tests pass
- relevant integration tests pass
- failure path tested
- Decision Trace/audit impact considered
- recovery impact considered
- docs updated if semantics changed.

---

# 38. Bug severity

### P0
Could create unintended exposure, reversal, unprotected position, duplicate order, or fail emergency close.

### P1
Incorrect position/protection state, reconciliation error, lost historical lineage.

### P2
Incorrect detector/review/evidence behavior without immediate exposure risk.

### P3
UI/visual/usability issue.

P0 blocks Demo/Live release.

---

# 39. Required regression scenarios before every broker-facing release

1. duplicate execution retry
2. partial fill
3. SL rejection
4. manual close
5. manual stop move
6. Desktop crash
7. Agent restart
8. broker disconnect
9. stale quote
10. spread spike
11. account mismatch
12. Colony flatten
13. one-position BE isolation
14. recovered historical trigger
15. DeploymentSnapshot restore.

---

# 40. Final testing invariant

The most important question is not:

> Does ARISE work when everything goes right?

It is:

> When messages duplicate, connections disappear, fills are partial, users intervene manually, and ARISE restarts, can it still reconstruct broker truth without creating unintended exposure?

The test suite must prove that answer before LIVE automation is trusted.
