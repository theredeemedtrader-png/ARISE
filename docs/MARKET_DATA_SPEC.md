# ARISE — MARKET_DATA_SPEC.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define how live quotes, candles, timeframes, sessions, economic events and recovered history enter ARISE and become deterministic inputs to charts, reviews, detectors and execution.

---

## 1. Governing principle

> Normalize market data once. Every ARISE subsystem consumes the same canonical market state.

No detector, chart, review scheduler or execution component may independently invent candle boundaries, spread values or symbol mappings.

---

## 2. Data flow

```text
Broker / MT5
    ↓
ARISE MT5 Agent
    ↓
Market Data Adapter
    ↓
Canonical Quote + Bar Stream
    ↓
TimeframeService / Bar Aggregator
    ↓
Market Event Router
    ├── Charts
    ├── Review Scheduler
    ├── Strategy Runtime
    ├── Detector Engine
    ├── Evidence
    └── Execution Validation
```

Raw high-frequency market traffic belongs in backend services, not React.

---

## 3. Canonical symbol mapping

ARISE uses `Instrument` as the broker-independent identity.

A broker adapter maps:

```text
ARISE: EURUSD
MT5:   EURUSD
```

or:

```text
ARISE: XAUUSD
MT5:   XAUUSD.a
```

Mapping must preserve:
- broker symbol
- canonical instrument
- digits
- tick size
- pip size
- contract properties
- minimum lot
- lot step
- maximum lot
- stop level
- freeze level where exposed

Strategies reference canonical Instrument IDs, never hard-coded broker aliases.

---

## 4. Quote model

Canonical live quote:

```text
QuoteState {
  instrumentId
  bid
  ask
  spread
  receivedAtUtc
  brokerTime
  sourceSequence?
  source
}
```

`spread` should be derived consistently from Ask - Bid using instrument pip/tick conventions.

QuoteState is ephemeral.

Persist `QuoteSnapshot` only where audit/evidence requires it, including:
- strategy signal,
- Candidate creation,
- OrderPlan creation,
- broker send,
- fill,
- protection calculation,
- exit.

---

## 5. Quote freshness

Every quote-dependent action must know quote age.

Example:

```text
Bid       1.08471
Ask       1.08479
Spread    0.8p
Quote age 42ms
```

If quote age exceeds the configured execution threshold:

```text
STALE_QUOTE
```

New exposure is blocked.

Quote-freshness thresholds may vary by execution policy/instrument, but stale state must be explicit.

Existing broker-native protection is not removed because quotes become stale.

---

## 6. Bid / Ask semantics

ARISE must model Bid and Ask explicitly.

Do not use one generic chart price for execution-sensitive logic.

Conditions may declare price source:

- BID
- ASK
- MID
- CHART_PRICE
- EITHER_SIDE

Examples:
- LONG market entry is affected by Ask.
- SHORT market entry is affected by Bid.
- stop/TP trigger semantics must follow broker reality.
- True BE must use executable exit-side economics.

---

## 7. Canonical TimeframeService

One service owns timeframe boundaries.

Responsibilities:

```text
getCurrentCandle(instrument, timeframe, time)
getPreviousCandle(...)
getCandleStart(...)
getCandleEnd(...)
getNextClose(...)
getParentCandle(...)
getChildInterval(...)
```

It is used by:
- bar aggregation,
- Review Scheduler,
- Strategy Runtime,
- Timeframe Projection,
- chart synchronization,
- evidence,
- session logic.

No duplicate 4H/D/W boundary calculation elsewhere.

---

## 8. Supported timeframes

Architecture must support arbitrary configured timeframes, including:

```text
1m 2m 3m 5m 10m 15m 30m
1h 2h 4h 6h 8h 12h
D W M
```

Not all need native MT5 bars.

Where broker-native bars are unavailable, ARISE may aggregate from a canonical lower timeframe.

Aggregation rules must be deterministic and use TimeframeService boundaries.

---

## 9. Candle identity

Canonical Candle identity:

```text
instrumentId
timeframeId
openTimestampUtc
dataSource
```

Persist a stable Candle ID.

Never make persistent references using a visual bar index such as `bar 1842`, because indexes may shift when history changes.

Human UI may display friendly numbers separately.

---

## 10. Bar lifecycle

Canonical events:

```text
CandleOpened
BarUpdated
BarClosed
```

A candle may receive many `BarUpdated` events.

Exactly one logical `BarClosed` domain effect should occur per canonical candle close, even if transport messages duplicate.

---

## 11. Evaluation event modes

Market data must support detector subscriptions for:

- ON_TICK
- ON_PRICE_UPDATE
- ON_BAR_UPDATE
- ON_BAR_CLOSE
- ON_EVENT
- MANUAL

Examples:

```text
FVG formation       ON_BAR_CLOSE
FVG retracement     ON_PRICE_UPDATE
MSS close confirm   ON_BAR_CLOSE
Area entry          ON_PRICE_UPDATE
Spread condition    ON_PRICE_UPDATE
News event          ON_EVENT
```

---

## 12. Event router

Route events by:
- instrument
- timeframe
- event type
- runtime dependency.

Only armed RuntimeNodes receive relevant events.

Dormant strategy nodes should not continuously evaluate market data.

This is required for performance when many Colonies/pairs exist.

---

## 13. Recent-bar cache

V1 should maintain enough recent history for:
- detector evaluation,
- chart rendering,
- evidence framing,
- structural references.

It should not become a full tick-history warehouse.

Illustrative cache targets may be configured, for example:
- thousands of 1m bars,
- thousands of 5m bars,
- lower counts for HTFs.

Exact retention is implementation/configuration policy, not strategy semantics.

---

## 14. Historical recovery

After a data interruption:

```text
last known canonical candle
    ↓
request broker history
    ↓
fill missing candles
    ↓
validate continuity
    ↓
mark recovered events
```

Recovered data must be distinguishable from realtime data.

Suggested origin:

- REALTIME
- RECOVERED_HISTORY
- REPLAY

---

## 15. No stale historical execution

If recovery discovers that a trigger happened while ARISE was disconnected, ARISE must not blindly execute it at reconnect time.

Example:

```text
09:35 FVG touched
09:48 ARISE reconnects
```

The 09:35 event can update historical/evidence/runtime context where valid, but cannot create a fresh 09:48 entry unless the strategy explicitly defines the condition as persistent and still valid.

Execution triggers require freshness/expiry semantics.

---

## 16. Candidate freshness

Executable conditions may define validity such as:

- 30 seconds,
- until current candle close,
- until next structural event,
- while price remains in zone,
- until session end,
- manual cancellation.

The runtime/execution layer must receive enough timestamps and candle identity to enforce this.

---

## 17. Clock model

Potential clocks:
- Windows local time
- UTC
- MT5 terminal time
- broker server time
- economic-calendar provider time
- exchange/session time

Persist canonical timestamps in UTC.

Also preserve broker/provider timestamps where audit requires them.

Presentation can convert to:
- Toronto
- New York
- London
- broker time
- user-selected timezone.

Never determine HTF candle closes from Windows local time alone.

---

## 18. Session model

Session context is canonical market context.

Examples:
- Asia
- London
- New York AM
- custom session

Session definitions should use explicit timezone + interval rules.

`SessionStateChanged` can feed Strategy Runtime and Review.

---

## 19. Economic-event data

Economic events enter through provider abstraction:

```text
EconomicCalendarProvider
  ↓
normalized EconomicEvent
  ↓
EconomicEventRevision
  ↓
Market Event Router
```

Normalize:
- currency
- title
- impact
- scheduled time
- actual
- forecast
- previous
- provider key.

Provider revisions are preserved.

---

## 20. Forex pair relevance

For Forex, event relevance normally derives from both currencies.

Example:

```text
EURUSD
→ EUR events
→ USD events
```

Custom strategy/news policy may override.

Calendar awareness is broader than a near-event execution block.

ARISE supports day/week planning context plus optional proximity rules.

---

## 21. Watchlist event summaries

Derived UI examples:

```text
EURUSD   🔴3  🟠2
GBPUSD   🔴1  🟠4
```

These are derived from normalized events in the configured horizon.

Do not store colored counts as canonical Watchlist fields.

---

## 22. Chart news markers

Charts may render High/Medium/Low event markers.

Historical EvidenceSnapshot should preserve the event revisions/context that were known at the time where relevant.

---

## 23. Timeframe Projection data

Projection is based on exact canonical candle interval.

Example:

```text
Daily Candle
start 00:00
end   next Daily boundary
```

When expanded to 5m, all child candles whose intervals belong to the source interval can be highlighted.

Nested projections must use canonical timeframe boundaries, not visual estimation.

---

## 24. Market data health

Track independently:
- Agent connected
- broker connected
- quotes fresh
- bars continuous
- calendar provider health
- clock/broker-time availability.

Possible market-data health:
- HEALTHY
- DEGRADED
- STALE
- DISCONNECTED
- RECOVERING

---

## 25. UI throttling

Detector/execution services may consume all relevant backend updates.

Renderer updates should be throttled/coalesced to a reasonable presentation rate.

Do not make React render once per raw broker tick.

UI throttling must not change detector or execution semantics.

---

## 26. Persistence boundaries

Persist:
- canonical candles needed by current/recent system state,
- QuoteSnapshots at consequential moments,
- economic event revisions,
- evidence-linked market data,
- review-linked candles,
- source metadata.

Do not make V1 a general-purpose institutional historical-data warehouse.

---

## 27. Market data tests

Required tests include:
- stable candle identity
- duplicate BarClosed deduplication
- 4H/8H aggregation boundary correctness
- D/W parent-child mapping
- quote freshness transition
- bid/ask spread calculation
- recovered-history tagging
- missing-bar repair
- no stale recovered trigger execution
- session boundary correctness
- economic-event timezone normalization
- symbol alias mapping
- renderer throttling does not affect backend detector event count

---

## 28. Non-negotiable rules

1. One canonical TimeframeService.
2. Bid/Ask are first-class.
3. Stale quotes block new exposure.
4. Recovered historical triggers are not automatically fresh triggers.
5. Candle IDs do not depend on visual indexes.
6. React does not process the raw tick stream.
7. Economic-calendar data uses provider abstraction.
8. Custom/non-native timeframes use deterministic aggregation.
