# ARISE — UX_SPEC.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define ARISE visual language, interaction rules, workspace behavior, information hierarchy and core screen specifications.

---

## 1. UX character

ARISE should feel:

- calm during live execution,
- structured during planning,
- dense but readable during study,
- deliberate rather than flashy,
- modern rather than like a legacy broker terminal.

The UI should not imitate NinjaTrader's bottom-tab visual language.

---

## 2. Visual language

Dark-first.

Recommended character:
- deep charcoal/navy surfaces
- restrained ARISE blue accent
- subtle steel/neutral secondary controls
- red reserved for SHORT/destructive/risk states where appropriate
- no unnecessary bright white in dark mode
- subtle 6–10px corner radii
- minimal gradients
- restrained borders
- clear depth hierarchy.

Do not communicate state by color alone.

---

## 3. Typography

Use one primary UI family across the product.

Numeric/market data can use tabular or monospaced numerals.

Prioritize:
- readable symbol names
- clear pips/prices
- compact tags
- strong information hierarchy.

Avoid excessive typography variants.

---

## 4. Density

User setting:
- COMPACT
- STANDARD
- COMFORTABLE.

Live Trading defaults Standard/Compact.

Knowledge/Review may use more comfortable spacing.

Density changes spacing, not information semantics.

---

## 5. Terminology

Canonical direction terms:
- LONG
- SHORT
- NEUTRAL.

Do not use Bull/Bear as primary ARISE terminology.

Canonical position terms:
- Candidate
- Scout
- Survivor
- Protected
- Leg
- Mature Leg
- Runner.

---

# 6. Global shell

Left navigation:

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

Persistent top region:
- workspace tabs
- current context
- Next Review
- notifications
- System Health indicator
- global search.

---

## 7. Workspace tabs

Tabs represent semantic workspaces, not just routes.

Examples:

```text
EURUSD · W LONG #05
EURUSD · MASTER
Trade #1842
Liquidity Reversal v3
```

Behavior:
- click = activate
- middle click / close = close
- Ctrl+click entity link = open new tab
- restore after restart
- unsaved document indicator where relevant.

---

## 8. Global search / Ctrl+K

Search:
- symbols
- Colonies
- Trades
- Strategies
- Market Objects
- Documents
- Lessons
- commands.

Example:

```text
> EURUSD Weekly Long
> Open Trade #1842
> Create Idea
> Go to System Health
```

Use permanent IDs internally.

---

## 9. Click model

### Single click
Select / inspect.

### Double click
Open full entity/workspace.

### Right click
Context-specific actions.

### Hover
Preview/link context.

### Ctrl+click
Open in new workspace tab.

### Esc
Close transient surface / cancel current drawing interaction.

### Space + drag
Pan chart where appropriate.

---

## 10. Drawers vs modals

Prefer right-side contextual drawers for:
- entity detail
- settings
- position detail
- Market Object properties
- detector detail.

Use modal dialogs for consequential decisions:
- account flatten
- live deployment
- destructive delete
- migration conflict
- explicit broker-critical confirmation.

---

## 11. Drag behavior

Drag is allowed for:
- Kanban organization
- folder organization
- Graph nodes
- chart geometry
- workspace reordering.

Drag must never silently:
- place an order
- close a position
- change broker size
- flatten exposure.

A state transition caused by drag must be visibly proposed/confirmed if consequential.

---

# 12. Market Navigator

Persistent collapsible left/right rail depending workspace.

List example:

```text
FX WATCH
EURUSD   W LONG #05   🔴3
GBPUSD   —            🟠2
USDJPY   D SHORT #11  ✓
```

Row selection:
- selects instrument.

Colony badge:
- opens/selects Colony context.

Same instrument can have multiple opposing Colonies.

Context control:

```text
[MASTER] [W LONG #05] [D SHORT #11] [NO COLONY]
```

---

## 13. Watchlist keyboard

Suggested:
- Alt+Up/Down → previous/next symbol
- Alt+Left/Right → previous/next active timeframe
- Ctrl+1..9 → Watchlist
- Ctrl+K → any symbol/Colony.

Each instrument remembers last selected Colony context.

---

# 14. Overview UX

Overview should answer:

```text
What needs my attention?
What Colonies are active?
What is waiting?
What is at risk?
What review is due?
Is the system healthy?
```

Do not turn Overview into an exhaustive analytics page.

Cards are clickable deep links.

---

# 15. Ideas / Colony Kanban

Card example:

```text
EURUSD
W LONG #05

Target: Weekly BSL
Progress: 68%

ESTABLISHED
2 Legs · 1 Scout
Fresh Risk 8.4p

1H MSS WATCHING
```

Status/progress should be readable without relying on color.

Double click → Colony Detail.

---

# 16. Colony Detail

Header:

```text
EURUSD · W LONG #05
ESTABLISHED
Target: Weekly BSL
```

Tabs:
- Thesis
- Chart
- Strategy
- Positions
- Timeline
- Review.

Persistent quick context:
- direction
- target progress
- open pips
- protected pips
- Fresh Risk.

---

# 17. Thesis Canvas

Two-panel default:

```text
┌─────────────────────┬──────────────────────────┐
│ THESIS              │ CHART                    │
│                     │                          │
│ Weekly structure... │ [candles]                │
│ [[W BSL]]           │ [target]                 │
│ [[D FVG #03]]       │ [area]                   │
│                     │                          │
└─────────────────────┴──────────────────────────┘
```

Panel widths resizable.

Reference hover previews chart/object.

Click reference centers/highlights object.

---

# 18. Market Object properties

Right drawer:

```text
D FVG #03

Geometry
Rectangle

Type
FVG

Role
AREA

Timeframe
D

Owner
W LONG #05

Automation
Referenceable
```

Geometry and semantic meaning shown separately.

Version history accessible.

---

# 19. Chart toolbar

Compact vertical toolbar:
- pointer
- line
- ray
- rectangle
- trendline
- candle reference
- text
- Timeframe Projection.

Semantic presets may prefill object properties but use the same underlying primitives.

---

# 20. Chart layers

Layer panel:

```text
GLOBAL
✓ Sessions
✓ Economic Events

W LONG #05
✓ Target
✓ Areas
✓ Strategy Evidence
✓ Positions

D SHORT #11
□ Objects
□ Positions
```

Master Chart can expose several Colony layers.

Colony Chart defaults only relevant Colony layers.

---

# 21. Timeframe bar

Only assigned timeframes are prominent.

Example:

```text
[W H] [D H+A] [4H A] [1H A] [5M E] [1M E] [+]
```

Badges:
- H
- A
- E
- H+A
- A+E.

Do not display every possible timeframe equally if unused.

---

# 22. Trading Workspace

Priority:
1. current instrument/Colony
2. chart
3. strategy state
4. execution
5. open positions/protection
6. secondary metrics.

Example composition:

```text
┌────────────┬─────────────────────────┬──────────────┐
│ NAVIGATOR  │ CHART                   │ COLONY       │
│            │                         │ STRATEGY     │
│            │                         │ EXECUTION    │
├────────────┴─────────────────────────┼──────────────┤
│ POSITIONS / PROTECTION              │ ALERTS       │
└─────────────────────────────────────┴──────────────┘
```

---

# 23. Execution controls

Only consequential directional actions receive strong emphasis.

Example:

```text
[LONG] [SHORT]

Gear      G2 · 0.10
Entry     Market
Stop      8.4p
Spread    0.8p

[PLACE ORDER]

[FLATTEN POSITION]
```

Flatten must not visually resemble ordinary setup controls.

---

## 24. Partial fill UX

When relevant:

```text
0.30 / 0.50 FILLED
0.20 WORKING

Protection: VERIFIED

[CANCEL REMAINDER]
```

Do not permanently occupy UI with a Cancel Remainder button when no remainder exists.

---

# 25. Position Kanban

Cards should remain compact enough for several simultaneous Scouts.

Example:

```text
EURUSD LONG
Scout #24
W LONG #05

+14.2p
SL -1.0p
Target 44%

PROTECTED
```

Open full detail on double click.

---

# 26. Protection UX

Position drawer:

```text
PROTECTION
Current SL       1.08482
True BE          1.08479
Protected        +0.3p

[PRICE BE]
[TRUE BE]
[BE +]
[LOCK PIPS]
[PARTIAL]
[TRAIL]
```

If action scope > one position, show explicit scope before send.

---

# 27. Strategy workspace

Left:
- Encyclopedia / search / tags.

Center:
- Graph canvas.

Right:
- selected node properties.

Bottom/optional:
- runtime trace / detector diagnostics.

Toggle:

```text
[SIMPLE] [GRAPH]
[EDIT]   [LIVE]
```

Simple and Graph use same model.

---

# 28. Graph visual language

Node appearance communicates family by shape/header/icon plus restrained color.

Never depend solely on node color.

Runtime state overlays:
- DORMANT
- WATCHING
- TRIGGERED
- CONFIRMED
- FAILED
- BLOCKED.

Manual node should visibly pause cascade.

---

# 29. Decision Trace UX

Click runtime node:

```text
1H LONG MSS
CONFIRMED · 11:00:00

Broken swing
1.08431

Confirmation candle
1H Sep 9 10:00

Displacement
PASS

[VIEW EVIDENCE]
```

Users should not need logs to understand why automation progressed.

---

# 30. Market Review Queue

Focused queue:

```text
DAILY REVIEW
8 / 12

EURUSD
[LONG] [SHORT] [NEUTRAL] [UNCHANGED]

Target
Weekly BSL

Notes
...

[SAVE + NEXT]
```

Avoid turning review into a giant table-editing exercise.

---

# 31. Review freshness

Use compact semantic badges:

```text
CURRENT
DUE
2 MISSED
STALE
```

Not color-only.

---

# 32. Economic Calendar

Week view default is reasonable for HTF workflow.

Rows:
- time
- currency
- impact
- event
- actual
- forecast
- previous.

Filters persistent.

Selecting current pair can highlight relevant base/quote currency events.

---

# 33. Evidence Board

Example:

```text
W HINDSIGHT      D AREA        1H MSS       5M ENTRY
[image]          [image]       [image]      [image]
LONG             TOUCHED       CONFIRMED    FILLED
```

Click card → full Evidence.

Arrow/sequence should make decision progression obvious.

---

# 34. Drill-Down Review

Vertically readable study-note format:

```text
WEEKLY THESIS
[chart]

↓ selected candle

DAILY AREA
[chart]

↓ expanded

1H CONFIRMATION
[chart]

↓ expanded

5M ENTRY
[chart]
```

This is deliberately more like a study notebook than a broker report.

---

# 35. Trade Review

Header:

```text
EURUSD · Scout #24
W LONG #05
+86 position-pips
```

Tabs:
- Overview
- Decision Evidence
- Timeline
- Management
- Notes
- Lessons.

Outcome can be hidden in Study mode.

---

# 36. Colony Review

Header emphasizes campaign:

```text
W LONG #05
12 Attempts
3 Survivors
2 Mature Legs
Scouting Cost -28p
Position-Pips +412
```

Timeline shows accumulation and management, not only final P&L.

---

# 37. Knowledge UX

Three-pane optional pattern:

```text
FOLDERS | DOCUMENT | BACKLINKS / CONTEXT
```

Universal editor supports:
- `/`
- `[[`
- tags
- entity embeds
- Evidence embeds.

Entity-backed documents look like normal documents with additional metadata, not separate editors.

---

# 38. Database UX

Notion-like table/database behavior:
- entity selector
- filters
- sort
- group
- saved views
- multi-select tags.

Double click row → full entity.

Right click → review/context actions.

---

# 39. Tags

Compact multi-select chips.

Possible strategy categories:
- Setup
- Entry
- Mistake
- Session
- Context.

Display category prefixes where useful:

```text
Entry: FVG
Setup: Sweep
Mistake: Chased
```

Avoid huge tag pills.

---

# 40. Notifications

Notification Center:
- unread/read
- severity
- linked entity
- action.

Example:

```text
1H MSS CONFIRMED
EURUSD · W LONG #05
[OPEN STRATEGY]
```

Critical:

```text
PROTECTION FAILED
Scout #24
[OPEN RECOVERY]
```

---

# 41. System Health UX

Clear status table:

```text
MT5 Agent       CONNECTED
Broker          CONNECTED
Quotes          HEALTHY
Database        HEALTHY
Calendar        HEALTHY
Automation      DEMO
Account         123456 · DEMO
```

If blocked, show exact reason and recovery action.

---

# 42. P&L hierarchy

During live trading:
- pips primary
- money secondary/optional
- win rate not prominent.

Example:

```text
Open Pips       +82
Protected Pips  +41
Scouting Cost   -18
Fresh Risk       9
```

Avoid giant flashing monetary P&L.

---

# 43. Light theme

ARISE supports light theme using the same hierarchy.

Light theme should not simply invert colors.

Maintain:
- restrained blue
- deep navy text/structural accents
- neutral surfaces
- clear chart/background separation
- same semantic hierarchy.

---

# 44. Accessibility / status semantics

Every critical state should have:
- text label
- icon/shape where useful
- color as reinforcement.

Examples:
- LONG/SHORT labels
- VERIFIED/FAILED
- DUE/MISSED
- CONNECTED/BLOCKED.

---

# 45. Responsive behavior

Primary target: desktop monitors.

Panels:
- resizable
- collapsible
- persistent.

Avoid mobile-first compromises.

Support multi-monitor and popout windows where Electron architecture permits.

---

# 46. UX invariants

1. LONG/SHORT terminology.
2. No fixed timeframe-role UI assumptions.
3. Market Object meaning visible separately from geometry.
4. Broker-critical actions explicit.
5. Drag never secretly trades.
6. Money can be globally hidden.
7. Evidence is one click from automated decisions.
8. Runtime state is readable without logs.
9. Historical review deep-links exact versions.
10. System uncertainty is visible, not concealed.
