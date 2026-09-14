# ARISE — PRODUCT_SPEC.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define what ARISE is, who it serves, the V1 product surface, core workflows, boundaries, and implementation milestones.

---

## 1. Product definition

ARISE is a **Windows trading operating system** for discretionary-guided, multi-timeframe trading.

It combines:

- higher-timeframe Ideas and Thesis,
- Colony-based campaign management,
- flexible Hindsight / Area / Entry mapping,
- persistent chart Market Objects,
- visual Strategy Graphs,
- explainable detector automation,
- fixed-size pip-first execution,
- MT5 integration,
- position protection and stacking,
- evidence capture,
- Market Review scheduling,
- knowledge management,
- trade/Colony review,
- analytics and strategy evolution.

ARISE is not merely an indicator package, journal, execution panel, charting app, or black-box trading bot.

---

## 2. Product thesis

The central problem ARISE solves is fragmentation.

A discretionary trader often separates:

```text
analysis
→ charts
→ written thesis
→ execution
→ position management
→ screenshots
→ journal
→ review
→ strategy refinement
```

across unrelated applications and manual workflows.

ARISE turns those activities into one linked system in which every important object has lineage.

---

## 3. Core operating model

```text
MARKET
  ↓
IDEA / THESIS
  ↓
COLONY
  ↓
HINDSIGHT
  ↓
AREA
  ↓
STRATEGY CASCADE
  ↓
ATTEMPT
  ↓
SCOUT
  ↓
SURVIVOR
  ↓
PROTECTED / LEG
  ↓
MATURE LEG
  ↓
TARGET / RUNNER
  ↓
REVIEW
  ↓
LESSON
  ↓
STRATEGY EVOLUTION
```

This model is intentionally broader than `signal → trade → result`.

---

## 4. Intended user

Primary V1 user:

- discretionary Forex trader,
- thinks top-down across multiple timeframes,
- wants to define HTF direction/targets manually,
- uses lower-timeframe repeatable execution logic,
- may progressively automate measurable setup components,
- values screenshots and review,
- prefers fixed position size and pip-based accounting,
- trades through MT5.

ARISE should remain general enough to support other instruments/brokers later without compromising the initial workflow.

---

## 5. Design principles

1. **Participation over prediction.**
2. **Thesis and execution remain distinct.**
3. **Timeframe roles are flexible.**
4. **Fixed-size, pip-first by default.**
5. **Every automated decision is explainable.**
6. **Historical decisions are versioned, not overwritten.**
7. **Broker reality wins during reconciliation.**
8. **Protection is separate from position state.**
9. **Evidence is part of the trading system, not an afterthought.**
10. **ARISE should become useful before full automation exists.**

---

## 6. Primary navigation

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

Persistent systems:
- Market Navigator / Watchlist
- Review Scheduler
- Economic Calendar
- Notification Center
- Workspace tabs
- Global Search / Command Palette.

---

# 7. Overview

Overview is the operational command center.

Suggested modules:

### Market Review
- next review
- due queues
- completed/remaining counts
- missed reviews.

### Active Colonies
- state
- direction
- target progress
- Scouts/Legs
- Fresh Risk.

### Market Navigator
- symbols
- active Colony context
- review freshness
- economic-event counts.

### Positions
- open Scouts/Legs
- protection status
- open/protected pips.

### Strategy Runtime
- active cascades
- waiting manual confirmations
- blocked/error nodes.

### System Health
- MT5 Agent
- broker
- quotes
- database
- calendar
- automation.

### Performance
Compact equity/pip curve and recent campaign statistics.

Overview is not intended to replace dedicated workspaces.

---

# 8. Ideas

Default Ideas view: **Colony Kanban**.

Columns can reflect:
- DRAFT/WATCHING
- ACTIVE
- IN PLAY
- TARGET APPROACHING
- COMPLETED/INVALIDATED.

Colony cards show:
- instrument
- LONG/SHORT
- thesis timeframe
- target
- target progress
- current Colony state
- active positions
- strategy-runtime state
- review freshness.

Double click opens Colony Detail.

---

# 9. Colony Detail

Tabs:

```text
THESIS
CHART
STRATEGY
POSITIONS
TIMELINE
REVIEW
```

The Colony is the central campaign container.

It links:
- IdeaVersion
- Target
- Market Objects
- StrategyMapVersion
- Runtime
- Attempts
- Trades/Positions
- management
- evidence
- notes
- reviews
- lineage.

---

# 10. Thesis Canvas

Split workspace:

```text
THESIS / DOCUMENT            CHART
```

The written Thesis supports references such as:

```text
[[Weekly BSL]]
[[D FVG #03]]
[[D Candle Sep 8]]
[[Invalidation #02]]
```

Hover:
- preview.

Click:
- focus/highlight chart object.

Chart object context action:
- Reference in Thesis.

The chart and thesis are two views of the same semantic model.

---

# 11. Market Objects

Drawing toolbar supplies geometry:
- Line
- Ray
- Rectangle
- Trendline
- Point/Candle
- Text.

Properties define meaning.

Semantic type examples:
- FVG
- Liquidity
- Range
- Target
- Invalidation
- Premium/Discount
- Generic Zone.

Role:
- REFERENCE
- AREA
- TRIGGER
- TARGET
- INVALIDATION
- PROTECTION
- CONFIRMATION
- ORIGIN.

Every important object has permanent identity and version history.

---

# 12. Chart workspaces

Workspace types:
- MASTER
- COLONY
- REVIEW.

### Master Chart
Instrument-centric view with selectable Colony layers.

### Colony Chart
Only the selected Colony's relevant objects/positions/evidence.

### Review Chart
Historical reconstruction/evidence.

Each workspace persists:
- instrument
- timeframe
- viewport
- layers
- selected context.

---

# 13. Timeframe Projection

Core study/navigation feature.

User can select a candle and:

```text
EXPAND TO → 4H / 1H / 15M / 5M / 1M
```

ARISE boxes the exact child interval.

Reverse:
`SHOW PARENT CANDLE`.

Nested breadcrumb example:

```text
D Sep 8
↳ 1H 14:00
↳ 5M FVG #392
↳ Scout #24
```

---

# 14. Trading Workspace

Primary live execution workspace.

Recommended layout:

```text
Market Navigator | Chart / Context | Execution + Colony

                 | Active Positions / Protection
```

Top context:

```text
EURUSD
[MASTER] [W LONG #05] [D SHORT #11]
```

Active timeframe bar only shows assigned timeframes:

```text
[W H] [D H+A] [1H A] [5M E] [1M E] [+]
```

Optional:
`[SINGLE] [STACK]`.

---

# 15. Execution panel

Fixed-size Gear based.

Example:

```text
LONG / SHORT
Gear G2 · 0.10
Entry Market
Stop 8.4p
Fresh Risk 0.84 position-pips
Spread 0.8p

[PLACE ORDER]
```

Money is secondary and may be globally hidden.

When partial fill exists:

```text
3/5 FILLED
[CANCEL REMAINDER]
```

The remainder action appears only while relevant.

---

# 16. Position Kanban

Columns:

```text
CANDIDATES
SCOUTS
SURVIVORS
PROTECTED
LEGS
MATURE
RUNNERS
```

Cards show:
- symbol
- direction
- Colony
- size
- open pips
- protection state
- target progress
- current strategy/management context.

Drag may organize or propose explicit state transition where allowed.

Drag must never secretly place/close a broker trade.

---

# 17. Position detail

Drawer/full page includes:
- Trade/Position IDs
- original/current Colony
- lineage
- entry
- size
- initial stop
- current stop
- pip state
- lifecycle
- management policy
- Evidence timeline
- notes
- broker state.

Quick actions:
- BE
- True BE
- BE+
- Lock Pips
- Partial
- Trail
- Close.

Every action has explicit scope.

---

# 18. Strategy workspace

Two major modes:

```text
ENCYCLOPEDIA
GRAPH
```

Encyclopedia stores:
- Strategy Definitions
- versions
- parameters
- prose
- screenshots
- tags
- automation capability
- tests/results.

Graph creates reusable multi-timeframe logic.

---

# 19. Strategy Graph

Grasshopper-like visual editor.

Node families:
- Strategy
- Logic
- Modifier
- Market Object
- State
- Action.

Simple mode:

```text
5M ENTRY
[Sweep] → [MSS] → [FVG]
```

Graph mode exposes full node network.

`EDIT` and `LIVE` are separate.

---

# 20. Strategy Runtime

LIVE graph shows:
- dormant
- armed
- watching
- triggered
- confirmed
- failed
- expired
- blocked
- manual confirmation required.

Clicking a node opens:
- detector details
- parameters
- evidence
- Decision Trace.

---

# 21. Strategy automation

Capability:
- MANUAL
- DETECTABLE
- AUTOMATABLE.

Runtime mode:
- OBSERVE
- NOTIFY
- CONFIRM
- AUTO.

Deployment:
- EXPERIMENTAL
- VALIDATED
- DEMO_APPROVED
- LIVE_APPROVED
- RETIRED.

No strategy becomes LIVE automatically.

---

# 22. MT5 integration

ARISE Desktop remains the main operating environment.

MT5 Agent handles:
- quotes
- broker orders
- positions
- broker-native protection
- deterministic delegated triggers
- reconciliation.

ARISE handles:
- Thesis
- Colonies
- strategy logic
- evidence
- review
- higher-level management.

MT5 can remain available separately for native chart inspection if desired.

---

# 23. Watchlist / Market Navigator

Persistent and collapsible.

Lists:
- Forex Majors
- FX Watch
- Active Colonies
- Today
- Favorites
- custom.

Row may show:
- symbol
- current Colony badge
- target/cascade state
- review freshness
- economic-event summary.

Hierarchy:

```text
WATCHLIST
→ INSTRUMENT
→ COLONY CONTEXT
→ TIMEFRAME
```

---

# 24. Review Scheduler

Any timeframe may have its own review queue.

Examples:
- Weekly
- Daily
- 8H
- 4H
- 1H.

Review timing comes from actual candle closes.

Topbar:

```text
NEXT REVIEW
4H · 01:42:17
```

Focused review supports Save + Next.

---

# 25. Economic Calendar

Calendar-first planning surface.

Views:
- DAY
- WEEK.

Filters:
- currencies
- impact
- watchlist
- current pair
- all.

Watchlist can summarize relevant event counts.

Charts may show event markers.

Near-event execution rules are optional and separate from broad planning awareness.

---

# 26. Knowledge

Universal document system.

Used for:
- Thesis
- Colony Notes
- Position Notes
- Trade Reviews
- Lessons
- Strategy Encyclopedia
- research
- free documents.

Supports:
- rich text/Markdown
- wiki links
- block references
- tags
- slash commands
- rich entity embeds
- backlinks
- versions.

Nested folders supported.

---

# 27. Database

Structured explorer over canonical ARISE entities.

Entity selector:
- Trades
- Positions
- Colonies
- Ideas
- Strategies
- Combos
- Lessons
- Market Objects
- Documents
- Highlights
- Targets
- Market Reviews.

Supports:
- filters
- sorting
- grouping
- saved views
- deep links.

---

# 28. Review Lab

Primary study workspace.

Navigation:
- Trades
- Colonies
- Highlights
- Lessons
- Study Queue
- Compare.

Trade Review:
- Overview
- Decision Evidence
- Timeline
- Management
- Notes
- Lessons.

Decision Evidence:
- BOARD
- DRILL-DOWN.

---

# 29. Evidence

Automatic evidence is part of strategy operation.

Default:
`Strategy Evidence + Entry`.

Capture:
- strategy confirmations
- Entry
- Survivor
- Protected
- Leg
- Mature
- Target
- Exit
- failed/expired cascades where configured.

Evidence stores both original raster and machine-readable state.

---

# 30. Lessons

Lifecycle:

```text
OBSERVATION
→ REPEATED PATTERN
→ PLAYBOOK RULE
→ MASTERED
```

A Lesson may propose a Strategy change.

Accepted proposal creates a new StrategyVersion.

Historical versions remain intact.

---

# 31. Analytics

Overview:
- compact operational metrics.

Full Analytics:
- Equity / Balance / Both
- Pips / Position-Pips / Money
- drawdown
- entry/exit markers
- lifecycle markers
- Colony attribution
- time/day/setup analysis
- strategy version comparisons.

Pip-first presentation remains default.

---

# 32. Global P&L display

Modes:
- PIP-FIRST
- PIPS + MONEY
- MONEY-FIRST
- $ HIDDEN.

`$ HIDDEN` persists globally for operational surfaces.

Money is still calculated internally.

Analytics may explicitly reveal money when user chooses.

---

# 33. Notifications

Two layers:
- in-app Notification Center
- native Windows notifications.

Per-category routing:
- In App
- Desktop
- Sound.

Examples:
- Candidate Ready
- Target Approaching
- Manual Confirmation Required
- Protection Failed
- MT5 Disconnected
- Review Due.

Critical safety events may use stronger routing.

---

# 34. System Health

Dedicated workspace.

Monitor:
- Agent
- Broker
- Quotes
- Database
- Calendar
- Automation
- active account
- runtime mode.

States:
- CONNECTED
- DEGRADED
- DISCONNECTED
- RECONNECTING
- RECONCILING
- BLOCKED.

---

# 35. Workspace model

Persistent tabs and popouts.

Examples:
- EURUSD Weekly Long #05
- EURUSD Master
- Strategy: Liquidity Reversal
- Review: Trade #1842.

Ctrl+click opens in new workspace tab where appropriate.

Workspaces restore after restart.

---

# 36. V1 scope

V1 includes:
- app shell
- Watchlist
- Ideas/Thesis
- Colony model
- Market Objects
- chart workspaces
- Timeframe Projection
- universal documents
- Review Scheduler
- Economic Calendar
- Encyclopedia
- Strategy Graph
- Strategy Runtime
- initial detector library
- Decision Trace
- Evidence
- Database
- Review/Lessons
- fixed-size pip-first accounting
- MT5 market data
- demo/live-gated execution
- individual protection
- stacking/attempt controls
- persistence/recovery
- System Health.

---

# 37. Explicit V1 non-goals

Do not block V1 waiting for:
- multi-broker portfolio aggregation
- full TradingView feature parity
- giant historical tick warehouse
- ML strategy generation
- cloud collaboration
- mobile app
- social trading
- generalized backtesting platform
- fully automatic discretionary strategy interpretation
- broad broker support
- complex netting-first architecture.

---

# 38. Build milestones

### M0 — Foundation
Repo, Electron/React, packages, typed IPC, SQLite, migrations, tests.

### M1 — Domain
Canonical entities, versions, events, state machines.

### M2 — Shell
Navigation, workspace tabs, Watchlist, settings, System Health shell.

### M3 — Thesis + Chart
Ideas, Colony, Thesis Canvas, Market Objects, Timeframe Projection.

### M4 — Knowledge + Review Scheduler
Documents, links, folders, review queues, calendar context.

### M5 — Strategy
Encyclopedia, Strategy Graph, Runtime, detector registry.

### M6 — Market Data
MT5 Agent feed, TimeframeService, canonical bars, detector events.

### M7 — Evidence
Decision Trace, EvidenceSnapshot, Board/Drill-Down.

### M8 — Execution Demo
ExecutionIntent, OrderPlan, Agent commands, reconciliation.

### M9 — Protection
Initial SL, BE/True BE, structural protection, partials, stacking.

### M10 — Review + Analytics
Trade/Colony Review, Lessons, Compare, analytics.

### M11 — Hardening
Failure injection, recovery, deployment approval, live gate.

---

# 39. Product acceptance principle

ARISE V1 succeeds if a trader can:

1. form and version a multi-timeframe Thesis,
2. visually define meaningful Market Objects,
3. map Hindsight/Area/Entry flexibly,
4. run a manual/detectable/automated Strategy cascade,
5. acquire fixed-size Scouts through MT5 safely,
6. manage multiple positions without losing individuality,
7. preserve the entire decision/evidence chain,
8. recover correctly after restart/disconnect,
9. review Trades and Colonies in context,
10. turn Lessons into explicit new strategy versions.

That complete loop is the product.
