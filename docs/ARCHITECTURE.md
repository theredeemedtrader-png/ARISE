# ARISE — ARCHITECTURE.md

**Status:** Canonical  
**Version:** 1.0-draft  
**Purpose:** Define ARISE's technical boundaries and dependency direction.

---

## 1. System goal

ARISE is a standalone Windows trading operating system for planning, charting, multi-timeframe strategy orchestration, evidence capture, review, and controlled MT5 execution.

The application is designed to work first as a discretionary operating system, then as an explainable strategy observer, then as a shadow/demo automation platform, and only after safety gates as a live automation platform.

---

## 2. Technology stack

### Desktop
- Electron
- React
- TypeScript

### Persistence
- SQLite
- WAL mode
- versioned migrations
- Drizzle ORM or equivalent lightweight typed database layer

### UI / graph / editor
- TradingView Lightweight Charts behind an ARISE wrapper
- React Flow for Strategy Graph
- TipTap or Lexical for universal rich-text documents
- Zustand for renderer UI state where appropriate
- Zod for runtime validation

### Testing
- Vitest
- Playwright
- dedicated fake MT5/broker harness

### Integration
- MT5 EA/Agent
- local IPC/socket protocol
- provider abstraction for economic calendar

---

## 3. Repository layout

```text
ARISE/
├── apps/
│   ├── desktop/
│   └── mt5-agent/
│
├── packages/
│   ├── domain/
│   ├── database/
│   ├── shared/
│   ├── ui/
│   ├── charting/
│   ├── strategy-engine/
│   ├── evidence/
│   ├── documents/
│   ├── calendar/
│   └── notifications/
│
├── docs/
│   ├── MILLIPEDE_PHILOSOPHY.md
│   ├── PRODUCT_SPEC.md
│   ├── UX_SPEC.md
│   ├── ARCHITECTURE.md
│   ├── DATA_MODEL.md
│   ├── STATE_MACHINES.md
│   ├── STRATEGY_ENGINE.md
│   ├── MARKET_DATA_SPEC.md
│   ├── EXECUTION_SPEC.md
│   ├── PROTECTION_SPEC.md
│   ├── RECOVERY_AND_SAFETY.md
│   ├── EVIDENCE_SYSTEM.md
│   ├── REVIEW_SYSTEM.md
│   ├── TEST_PLAN.md
│   └── ASTRA_INSTRUCTIONS.md
│
└── tests/
```

---

## 4. Dependency rule

The domain layer must not know about:

- React,
- Electron,
- SQLite,
- MT5,
- TradingView Lightweight Charts,
- React Flow,
- UI styling.

Dependency direction:

```text
Presentation
    ↓
Application / Domain Services
    ↓
Domain
    ↑
Infrastructure Adapters
```

Concrete infrastructure implements interfaces owned by the application/domain boundary.

---

## 5. Major runtime layers

```text
PRESENTATION
- App Shell
- Watchlist / Market Navigator
- Thesis Canvas
- Trading Workspace
- Position Kanban
- Strategy Graph
- Review Lab
- Knowledge
- Analytics
        ↓
APPLICATION / DOMAIN SERVICES
- Thesis Service
- Colony Service
- Market Object Service
- Review Scheduler
- Strategy Runtime
- Position State Engine
- Protection Engine
- Execution Orchestrator
- Evidence Service
- Notification Router
        ↓
DATA
- SQLite repositories
- immutable event history
- asset store
- search
        ↕
INTEGRATIONS
- MT5 Bridge
- Calendar Provider
- future broker adapters
```

---

## 6. Renderer isolation

The React renderer must never talk directly to:

- SQLite,
- MT5,
- filesystem internals,
- broker sockets.

All privileged work goes through typed Electron IPC.

```text
React Renderer
    ↓ typed request/event contracts
Electron Main / Backend
    ↓
Domain/Application Services
```

---

## 7. Canonical TimeframeService

One service owns candle identity and boundaries.

Responsibilities:

```text
getCurrentCandle()
getPreviousCandle()
getStart()
getEnd()
getNextClose()
getParentCandle()
getChildInterval()
```

It drives:

- charting,
- detector events,
- Review Scheduler,
- Timeframe Projection,
- evidence,
- economic/session alignment.

No subsystem may independently invent Daily/4H/Weekly boundaries.

Candle identity should use stable source data such as:

`instrument + timeframe + open_timestamp + data_source`

not volatile bar indexes.

---

## 8. Market data architecture

```text
MT5 / Broker
    ↓
MT5 Agent
    ↓
Market Data Adapter
    ↓
Canonical Quote/Bar Stream
    ↓
Timeframe Engine
    ↓
Event Router
    ↓
Active Detector Subscriptions
```

Core event types:

- QuoteUpdated
- BarUpdated
- BarClosed
- CandleOpened
- EconomicEventUpdated
- SessionStateChanged
- MarketObjectChanged

Execution/detectors may process high-frequency events in backend services.

React receives throttled presentation updates; raw tick flow does not pass through React.

---

## 9. Strategy architecture

Knowledge and execution are separate.

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
Detector Evaluation
        ↓
Runtime Node State Change
        ↓
Evidence / Action
```

### Capability
- MANUAL
- DETECTABLE
- AUTOMATABLE

### Execution mode
- OBSERVE
- NOTIFY
- CONFIRM
- AUTO

Capability and chosen execution mode are not the same thing.

---

## 10. Detector engine

The Strategy Graph orchestrates detectors; it does not implement their technical-analysis logic.

Detector families:

```text
liquidity/
  SweepDetector
  ExternalLiquidityDetector
  EqualHighLowDetector

structure/
  SwingDetector
  MSSDetector
  BOSDetector
  ReclaimDetector

imbalance/
  FVGDetector
  IFVGDetector
  DisplacementDetector

location/
  PremiumDiscountDetector
  ZoneInteractionDetector
  MarketObjectConditionDetector

context/
  SessionDetector
  SpreadDetector
  EconomicEventDetector
  TimeframeStateDetector
```

Standard detector input:

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

Evaluation modes:

- ON_TICK
- ON_PRICE_UPDATE
- ON_BAR_UPDATE
- ON_BAR_CLOSE
- ON_EVENT
- MANUAL

Runtime nodes persist trigger memory and survive restart.

---

## 11. Strategy Graph

Graph node families:

- STRATEGY
- LOGIC
- MODIFIER
- MARKET_OBJECT
- STATE
- ACTION

Logic nodes:
- AND
- OR
- THEN
- NOT

Action examples:
- Notify
- Arm Strategy
- Create Scout
- Cancel Pending
- Move Stop
- Partial Close
- Promote Leg
- Convert Runner
- Take Snapshot

Simple and Graph modes edit the same underlying graph.

EDIT mode defines logic.  
LIVE mode shows runtime state.

---

## 12. Market Objects

Rule:

> Drawing tools define geometry. Market Object properties define meaning.

Basic geometry:
- Line
- Ray
- Rectangle
- Trendline
- Point/Candle
- Text

Semantic types can include:
- Generic Zone
- FVG
- Order Block
- Supply/Demand
- Liquidity Zone
- Range
- Premium/Discount
- Target Zone
- Invalidation Zone
- Custom

Roles are separate:
- REFERENCE
- AREA
- TRIGGER
- TARGET
- INVALIDATION
- PROTECTION
- CONFIRMATION
- ORIGIN

Market Objects are canonical data objects, not merely chart pixels.

---

## 13. Chart architecture

```text
ARISE Chart Workspace
    ↓
Lightweight Charts
    +
ARISE Drawing Layer
    +
Market Object Layer
    +
Colony Layer System
```

Workspace types:
- MASTER
- COLONY
- REVIEW

The charting package isolates the chosen chart library. Domain entities must not depend on chart-library types.

ARISE owns:
- drawings,
- semantics,
- ownership,
- versioning,
- backlinks,
- Timeframe Projection,
- evidence references.

---

## 14. Timeframe Projection

A projection is a linked data object, not a decorative rectangle.

It stores:
- source candle/object,
- source timeframe,
- target timeframe,
- exact start/end interval,
- source high/low,
- Colony,
- parent projection where nested.

Use case:

`D candle → 1H children → 5M setup → Scout`

This powers chart drill-down and pipEASY-style evidence review.

---

## 15. Execution architecture

A strategy signal is not a broker order.

```text
Strategy Runtime
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
Broker
    ↓
Broker Event / Fill
    ↓
Protection Verification
    ↓
Position / Scout activation
```

Execution must be:
- durable,
- idempotent,
- auditable,
- reconciled,
- verified.

Broker reality is authoritative for actual positions/orders/fills/stops.

---

## 16. MT5 responsibility boundary

### ARISE Desktop backend owns
- Thesis
- Colonies
- Strategy Runtime
- detectors
- Market Objects
- evidence
- Review
- higher-level management decisions

### MT5 Agent owns
- live quote/broker access
- order submission
- broker-native SL/TP
- broker state queries
- execution acknowledgements
- delegated deterministic triggers
- close-to-broker safety behavior

ARISE must not duplicate the full Strategy Graph inside MQL5.

---

## 17. Delegated execution

ARISE may send an already-authorized deterministic rule to the MT5 Agent, for example:

```text
EURUSD LONG
trigger ASK <= 1.08462
size 0.10
SL 1.08390
max spread 1.2p
expires 10:30
one-shot
```

The Agent may execute this rule if the Desktop temporarily disconnects.

The Agent must not invent new strategic decisions.

Every delegated rule requires an expiry or invalidation condition.

---

## 18. Protection architecture

```text
Market / Strategy / Target Event
    ↓
Protection Rule
    ↓
Trigger
    ↓
Scope / Eligibility
    ↓
Protection Proposal
    ↓
Conflict Resolver
    ↓
Broker Validation
    ↓
MT5 Request
    ↓
Verification
    ↓
Position/Colony Event
```

Actions may include:
- Price BE
- True BE
- BE+
- Lock pips
- Lock money
- Move to Market Object
- Fixed trail
- Structural trail
- Partial close
- Full close
- Set/remove TP
- Convert Runner

Default automatic stop rule: never worsen protection unless an explicit advanced policy authorizes it.

---

## 19. Persistence

Use SQLite as canonical structured persistence plus local asset files for evidence images/media.

Historical decisions are immutable/versioned.

Mutable operational state includes:
- current runtime-node state,
- current Colony state,
- current Position state,
- current Watchlist/layout state.

Immutable history includes:
- fills,
- executions,
- confirmations,
- evidence,
- IdeaVersion,
- StrategyVersion,
- MarketObjectVersion,
- state events,
- reviews,
- protection events,
- broker events.

---

## 20. Documents

One universal Document + Block engine serves:
- Thesis
- Colony notes
- Position notes
- Trade reviews
- Lessons
- Strategy Encyclopedia
- research
- free notes

Relational data remains canonical for execution.

Markdown is an export/sync representation, not the live execution database.

---

## 21. Reliability architecture

Outbound broker operations:

```text
persist CommandOutbox
    ↓
send
    ↓
acknowledge
    ↓
broker event
    ↓
verify
```

Inbound broker events use deduplication.

On startup/reconnect:

```text
Load durable ARISE state
    ↓
Connect Agent
    ↓
Fetch broker state
    ↓
Reconcile
    ↓
Resolve/record discrepancies
    ↓
Resume only when safe
```

If broker state is uncertain:

`NO NEW EXPOSURE → PRESERVE PROTECTION → RECONCILE → VERIFY → RESUME`

---

## 22. Runtime modes

- OBSERVE
- SHADOW
- DEMO
- LIVE

Strategy deployment lifecycle:
- EXPERIMENTAL
- VALIDATED
- DEMO_APPROVED
- LIVE_APPROVED
- RETIRED

A graph inherits the weakest deployment permission of its executable dependencies.

Active live Colonies use a frozen **DeploymentSnapshot** of exact strategy/detector/parameter/management versions.

---

## 23. System Health

Track independently:
- Agent health
- Broker health
- Quote health
- Database health
- Calendar health
- Automation status

Connection states:
- CONNECTED
- DEGRADED
- DISCONNECTED
- RECONNECTING
- RECONCILING
- BLOCKED

System health is a first-class product surface, not a hidden log.

---

## 24. Primary navigation

```text
ARISE

OVERVIEW

PLAN
  Ideas
  Knowledge

EXECUTE
  Trading
  Positions

BUILD
  Strategy

STUDY
  Database
  Review
  Analytics

UTILITY
  System Health
  Settings
```

Persistent first-class systems:
- Market Navigator / Watchlist
- Review Scheduler
- Economic Calendar
- Notification Center
- Workspace tabs
- Global search / Ctrl+K

---

## 25. Implementation sequence

1. Repository foundation
2. Pure domain model
3. SQLite + version/event persistence
4. App shell
5. Chart + Market Objects
6. Documents + Thesis + Review Scheduler
7. Encyclopedia + Strategy Graph
8. MT5 market feed + Detector Engine
9. Decision Trace + Evidence
10. Demo execution + reconciliation/failure hardening
11. Protection + Colony automation
12. Live approval only after regression gates

ARISE should become useful as a discretionary OS before automated execution exists.

---

## 26. Architecture invariants

The following may not be violated for convenience:

- React components do not contain trading logic.
- Domain code does not import broker/UI/database implementations.
- Market Objects are not reduced to chart annotations.
- Strategy definitions are not runtime state.
- Runtime graph orchestration is not detector implementation.
- Execution intent is not broker order state.
- Position state is not management policy.
- Broker acceptance is not fill verification.
- Historical versions are not overwritten.
- Reconnect does not blindly resend exposure.
- Uncertain broker state disables new exposure.
