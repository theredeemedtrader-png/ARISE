# ARISE — EVIDENCE_SYSTEM.md

**Status:** Canonical
**Version:** 1.0-draft
**Purpose:** Define the evidence, screenshot, chart-state and timeframe-drill-down system used to explain and study ARISE decisions.

---

## 1. Governing principle

> Important trading decisions should be reconstructable both visually and structurally.

A screenshot alone is insufficient.

A database event alone is insufficient.

ARISE Evidence combines:
- immutable event identity,
- exact source entities/versions,
- machine-readable chart state,
- rendered visual snapshot,
- timeframe context,
- Decision Trace.

---

## 2. Inspiration

The desired review experience is inspired by the study process in pipEASY's Millipede material: higher-timeframe hindsight is progressively expanded into lower-timeframe detail, preserving the relationship between the selected higher-timeframe candle and its lower-timeframe children.

ARISE formalizes this into linked evidence and Timeframe Projection rather than manually assembled screenshots.

---

## 3. Evidence hierarchy

```text
Decision / Runtime Event
    ↓
EvidenceEvent
    ↓
EvidenceSnapshot(s)
    ↓
EvidenceReference(s)
```

Evidence may originate from:
- Strategy Runtime
- Detector Evaluation
- Attempt
- Trade
- Position lifecycle
- Protection action
- Market Review
- manual user capture.

---

## 4. EvidenceEvent

Represents **why** evidence was created.

Event types include:
- REVIEW
- STRATEGY_TRIGGER
- STRATEGY_CONFIRMATION
- STRATEGY_FAILURE
- STRATEGY_EXPIRY
- CANDIDATE
- ENTRY
- SURVIVOR
- PROTECTED
- LEG
- MATURE_LEG
- TARGET_APPROACHING
- TARGET_HIT
- PARTIAL_EXIT
- EXIT
- CONSOLIDATION
- RUNNER_CONVERSION
- MANUAL.

Fields:
- evidence_event_id
- source_type
- source_id
- event_type
- occurred_at
- summary
- decision_trace_id nullable.

---

## 5. EvidenceSnapshot

One EvidenceEvent may have multiple visual representations.

Fields:
- snapshot_id
- evidence_event_id
- chart_workspace_state
- image_path
- image_hash
- framing_profile
- captured_at
- capture_origin.

Capture origin:
- AUTOMATIC
- MANUAL
- REGENERATED_VIEW.

A regenerated view is never substituted for the original immutable raster.

---

## 6. Immutable original + reconstructable state

For consequential evidence, preserve both:

### Original raster
What ARISE/user actually saw/captured at that moment.

### Machine-readable state
- instrument
- timeframe
- visible interval
- candles/reference IDs
- MarketObjectVersions
- Timeframe Projections
- active strategy node
- Colony/Idea version
- annotations
- event context.

This lets ARISE later reconstruct an interactive version while preserving historical visual truth.

---

## 7. EvidenceReference

Links evidence to exact durable entities/versions.

Possible references:
- IdeaVersion
- Colony
- Target
- Candle
- MarketObjectVersion
- StrategyVersion
- StrategyMapVersion
- RuntimeNodeEvent
- DetectorEvaluation
- Trade
- Position
- ProtectionRequest
- EconomicEventRevision
- MarketReview.

Historical evidence should not resolve mutable “current” objects when a version existed at capture time.

---

## 8. Timeframe Projection

Core evidence primitive.

Example:

```text
Daily candle selected
    ↓
1H chart displays exact Daily interval
    ↓
all 1H candles inside it are boxed
    ↓
selected 1H candle expands to 5M
```

Projection stores:
- source timeframe
- target timeframe
- exact interval start/end
- source Candle ID
- source high/low
- parent projection where nested
- Colony/context.

---

## 9. Nested drill-down

ARISE should support chains like:

```text
D Sep 8
  ↳ 1H 14:00
      ↳ 5M FVG #392
          ↳ Scout #24
```

The breadcrumb itself is clickable.

This should feel like traversing the reasoning hierarchy, not opening unrelated screenshots.

---

## 10. Expand / parent interactions

Chart context actions:

```text
EXPAND TO
  4H
  1H
  15M
  5M
  1M
```

Reverse action:

```text
SHOW PARENT CANDLE
```

All use canonical TimeframeService boundaries.

---

## 11. Decision Evidence vs Entry Snapshot

These are distinct.

### Decision Evidence
Why the strategy progressed.

Examples:
- D Area reached
- 4H sweep
- 1H MSS confirmation
- 5M FVG formation.

### Entry Snapshot
Exact market/trade state at fill.

Both can exist for one Scout.

Do not replace a complete decision chain with one entry screenshot.

---

## 12. Evidence capture policy

Per Strategy/Template/Colony:

- ENTRY_ONLY
- STRATEGY_EVIDENCE_AND_ENTRY
- STRATEGY_EVIDENCE_ONLY
- CUSTOM.

Recommended default:
`STRATEGY_EVIDENCE_AND_ENTRY`.

Node-level policy may specify:
- capture on TRIGGER
- capture on CONFIRMATION
- capture on FAILURE
- capture on EXPIRY.

Confirmation is a sensible default for major nodes.

---

## 13. Stage summary

Multiple nodes can exist on the same timeframe.

Internally preserve per-node EvidenceEvents.

For presentation ARISE may produce one Stage Summary image with numbered annotations:

```text
1 Sweep
2 Displacement
3 MSS
4 FVG
```

The summary must link back to individual events.

---

## 14. Evidence framing profile

ARISE should support automatic framing rules so captures are consistent.

Profile may include:
- bars before/after event
- vertical padding
- source Market Objects to show
- parent projection visibility
- child projection visibility
- active position overlays
- economic event marker visibility
- annotation density.

Avoid arbitrary screenshots with different zoom every time.

---

## 15. Clean Evidence View

Primary study snapshot:
- exact relevant timeframe
- minimal surrounding context
- important Market Objects
- numbered setup annotations
- small metadata header
- no unnecessary trading controls.

Header example:

```text
EURUSD · W LONG #05
1H · AREA · MSS CONFIRMED
```

---

## 16. Full Context View

Secondary view can include:
- broader chart history
- other Colony layers
- watchlist context
- full annotations.

Review toggles:
- CLEAN
- CONTEXT.

The original EvidenceSnapshot remains immutable.

---

## 17. Evidence status

Display explicit state:
- CONFIRMED
- MANUALLY_CONFIRMED
- FAILED
- EXPIRED
- BLOCKED
- ERROR.

Do not use only color.

---

## 18. Inception Snapshot

At every filled Scout, automatic capture is ON by default.

Freeze:
- Trade ID
- Colony
- IdeaVersion
- StrategyMapVersion
- assigned timeframes
- exact entry
- initial stop
- initial pip risk
- fixed size/Gear
- quote snapshot
- relevant MarketObjectVersions
- chart states.

This becomes `Thesis at Trade Inception`.

---

## 19. Position lifecycle snapshots

Recommended automatic lifecycle captures:
- ENTRY
- SURVIVOR
- PROTECTED
- LEG
- MATURE_LEG
- TARGET_HIT
- EXIT
- CONSOLIDATE
- RUNNER_CONVERSION.

Not every state must always render an image, but the event must exist.

---

## 20. Failed / expired cascade evidence

Failed opportunities are important study data.

Preserve:
- where cascade failed
- exact node
- reason
- chart state
- Market Objects
- prior confirmed stages.

Do not only capture winners or filled trades.

---

## 21. Market Review evidence

During a Market Review, user may mark an important candle/object:

```text
USE AS EVIDENCE
```

This can become the root of a later drill-down chain.

Example:

```text
Weekly Review
→ selected Weekly candle
→ Daily expansion
→ 4H area
→ 5M entry
```

---

## 22. Economic-event context

Where relevant, evidence freezes the economic-event revisions known at that time.

Historical review should not show a revised later calendar value as though it was known at entry.

---

## 23. Evidence asset integrity

Store SHA-256 for original image.

If missing/corrupt:
- show explicit error
- retain machine-readable state
- retain links/references
- allow regenerated view to be labeled REGENERATED.

Never silently replace the original.

---

## 24. Evidence storage

V1:
- local filesystem assets
- SQLite metadata/indexes
- portable relative paths where possible.

Suggested directory:

```text
data/
  evidence/
    YYYY/
      MM/
        <evidence_event_id>/
```

The exact folder layout may vary but IDs must prevent collisions.

---

## 25. Board view

Review can assemble evidence into horizontal/vertical reasoning board:

```text
W Thesis
   ↓
D Area
   ↓
4H Sweep
   ↓
1H MSS
   ↓
5M Entry
   ↓
Scout
```

Each card:
- timeframe
- purpose
- node/result
- snapshot
- timestamp
- click-to-drill-down.

---

## 26. Drill-Down view

A study-note style view inspired by nested Millipede screenshots.

Structure:

```text
Higher-timeframe context
  [image]
  explanation

Selected candle expanded
  [image]
  explanation

Lower-timeframe setup
  [image]

Entry
  [image]

Management
  [image]
```

This format powers interactive Review and PDF export.

---

## 27. Evidence and Lessons

Any EvidenceSnapshot/Event may be:
- highlighted
- linked into a Trade Review
- converted to Lesson evidence
- compared against another Trade.

Lesson must link exact evidence, not copied screenshots with lost provenance.

---

## 28. Evidence and strategy change

Review flow:

```text
Evidence
→ Observation
→ Repeated Pattern
→ Lesson
→ StrategyChangeProposal
→ New StrategyVersion
```

Evidence never mutates existing StrategyVersion automatically.

---

## 29. PDF export

Evidence supports:
- Compact Trade Review
- Full Trade Dissection
- Colony Report
- Strategy Playbook
- Drill-Down Study Note.

PDFs should reference generated snapshot copies while retaining IDs in metadata/footer where practical.

---

## 30. Performance

Evidence rendering/capture must not block execution-sensitive threads.

Use asynchronous capture queues after the canonical event is persisted.

If image capture fails:
- the domain event still succeeds,
- record capture failure,
- retry asynchronously where appropriate.

Never delay broker protection waiting for a screenshot.

---

## 31. Required tests

- EvidenceEvent persists even if screenshot capture fails
- historical snapshot resolves exact MarketObjectVersion
- original raster hash validation
- nested Timeframe Projection intervals are correct
- Daily→1H→5M parent/child mapping
- Stage Summary retains per-node links
- failed cascade can produce evidence
- Inception Snapshot stores exact StrategyMapVersion
- regenerated snapshot is labeled regenerated
- economic-event revision reference remains historical
- screenshot queue cannot block execution thread
