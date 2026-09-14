# ARISE Strategy Intelligence Foundation

Status: **Design contract frozen for implementation**

This document is the implementation contract for the first ARISE Strategy Intelligence Foundation milestone. It complements `STRATEGY_PACKAGE_SPEC.md`; it does not weaken the package security model. Strategy Packages remain declarative data. New executable detector capability must be compiled into ARISE before packages may reference it.

## 1. Taxonomy

- **Native Primitive** — objective detector compiled into ARISE.
- **Native Primitive Candidate** — approved concept awaiting trusted runtime implementation.
- **Derived Primitive** — reusable concept composed from trusted primitives/operators.
- **Market Object** — persistent, versioned market structure/zone that other logic can reference.
- **Relationship** — objective relation between an event/move and another object/event.
- **Derived Pattern** — ordered composition of several primitives/relationships.
- **Market State** — persistent interpretation derived from multiple events.
- **Evidence Layer** — strategy-specific interpretation of objective occurrences.
- **Engine Operator** — generic logical, temporal, spatial, or measurement operator.

Governing rule:

> Primitives describe what price objectively did. Strategies decide what it means. Evidence compares the competing directional arguments.

## 2. Existing beta.2 native detector keys

The current beta.2 trusted detector surface remains authoritative until deliberately upgraded:

- `price_touch`
- `price_cross`
- `zone_entry`
- `spread`
- `liquidity_sweep`
- `displacement`
- `fvg`
- `fvg_retracement`
- `mss`

`fvg_retracement` is retained for compatibility, but the long-term architecture prefers generic Retracement plus object interaction. The current `mss` detector is also retained while richer structural semantics are implemented.

## 3. Canonical primitive definitions

### Price Touch
Price reaches a specified level or Market Object boundary. No cross or acceptance is implied.

### Price Cross
Price transitions from one side of a reference to the other. Crossing does not by itself imply a confirmed Break.

### Zone Entry
Price transitions from outside a zone to inside it. Approach direction and penetration depth are objective attributes.

### Liquidity Sweep
Price trades beyond a defined liquidity reference but fails to achieve confirmed acceptance beyond it. The strict same-candle form is a wick through the reference with a close back on the original side.

### Displacement
A single candle showing unusually strong directional expansion relative to recent price action, primarily measured through relative body size and body dominance. It does not inherently require a sweep, FVG, MSS, or structure break.

### Fair Value Gap (FVG)
Standard three-candle wick-to-wick imbalance.

Bullish:

`C3.low > C1.high`

Bearish:

`C3.high < C1.low`

Strict inequality is required. The output is a persistent directional zone Market Object.

### Generic Retracement — Native Primitive Candidate
A counter-directional child move against an active parent leg. It remains a retracement until the parent direction resumes or sufficient opposing structural evidence establishes a transition/reversal.

Objective outputs include parent-leg identity, direction, current/max depth ratio, duration, distance, and structural degree.

### Directional Body Close — Native Primitive Candidate
Objective measurement of candle-body direction and where the close occurs within the total range and relative to specified references.

Key principle:

> Wick = exploration. Body close = acceptance.

### Engulfing Candle — Native Primitive Candidate
A directional candle whose body fully engulfs the body of the immediately preceding **opposite-coloured** candle.

### Signal Bar — Native Primitive Candidate
Directional candle whose close-side wick is no more than 10% of total candle range.

Bullish:

- `Close > Open`
- `upperWick / range <= 0.10`

Bearish:

- `Close < Open`
- `lowerWick / range <= 0.10`

The opposite wick is not restricted. Trend-following status is a relationship between Signal Bar direction and Structure State, not another primitive.

## 4. Leg and swing structure

ARISE must not use arbitrary left/right fractals as the primary structural model.

A **Price Leg** is a meaningful directional move bounded by confirmed structural turning points. Minor counter-movement may remain part of a larger leg until an opposing move becomes significant enough to establish the next leg.

A **Swing** is the terminal wick extreme of a meaningful directional leg.

Structural interpretation uses a dual representation:

- close-based/line-chart progression determines the structural leg;
- the associated wick determines the actual price extreme.

Swings are nested by degree:

`MICRO ⊂ INTERIOR ⊂ EXTERIOR`

A market may therefore be Exterior bullish, Interior bearish, and Micro bullish at the same time.

Confirmed swings must not repaint. Candidate swing extremes may update until the opposite leg is confirmed.

### Swing High / Swing Low — Native Primitive Candidates

- Swing High = terminal wick extreme of a completed bullish leg before a qualifying bearish leg.
- Swing Low = terminal wick extreme of a completed bearish leg before a qualifying bullish leg.

Each object should retain wick extreme, structural close, pivot/confirmation times, structural degree, parent/child relationships, and preceding/following leg references.

## 5. Structure State

Derived independently for Micro, Interior, and Exterior degree.

States:

- `UNDEFINED`
- `BULLISH`
- `BEARISH`
- `TRANSITION_BULLISH`
- `TRANSITION_BEARISH`
- `RANGE`

HH/HL/LH/LL comparisons must compare swings of the same degree.

A **Protected Low** is the relevant low whose following bullish leg produced structural progression. A **Protected High** is the bearish inverse.

### BOS
A confirmed body-close break of the continuation-side structural swing in the direction of prevailing structure at the same degree.

### CHoCH
The first confirmed body-close break of the relevant opposing structural swing against prevailing structure at the same degree. A wick-only violation is not CHoCH by default.

### Structural Order Block — Native Primitive Candidate
The final opposite-colour candle immediately preceding a qualifying directional leg that produces meaningful structural progression.

- Bullish Structural OB = last bearish/red candle before qualifying bullish progression.
- Bearish Structural OB = last bullish/green candle before qualifying bearish progression.

Not every opposite-colour candle is an Order Block. Store full wick range and body range, associated leg/swing, and structural degree.

### Future canonical MSS
A confirmed body-close break through the Structural Order Block associated with the opposing structural leg at the same degree. This is deeper structural invalidation than CHoCH.

Displacement is independent evidence and is not mandatory to define MSS.

## 6. Liquidity objects

### Equal Highs / Equal Lows — Native Primitive Candidates
Two or more distinct qualifying swing extremes within a configurable tolerance, preferably from separate swing attempts, represented as one liquidity Market Object.

Use wick extremes. Preserve member swings, tolerance envelope, touch count, and structural degree. The object itself predicts neither reversal nor continuation.

Manual HTF/Daily liquidity and bias remain in the human thesis domain for this milestone; automatic previous-day/session high/low generation is intentionally out of scope.

## 7. Imbalance family

### Volume Imbalance — Native Primitive Candidate
Adjacent-candle body-to-body non-overlap. Wicks may overlap. Output a persistent directional zone.

### Wick FVG — Native Primitive Candidate
A trend-aligned asymmetric wick treated as a persistent imbalance zone.

Qualification:

- bullish trend uses the **lower wick**;
- bearish trend uses the **upper wick**;
- trend-side wick must be at least **1.5x the candle body**;
- approximately balanced/doji-like upper/lower wick geometry must be excluded through a configurable dominance/asymmetry threshold.

Formation and subsequent respect are separate concepts.

A **Wick FVG Hold** occurs when a later retracement/tap fails to gain acceptance through the far boundary and directional delivery resumes.

A **Wick FVG Failure** occurs when the configured acceptance rule is achieved through the far boundary, defaulting to a body-close rule.

Repeated same-direction Wick FVG holds within one directional cluster are objective evidence of persistent directional delivery.

### Immediate Rebalance (IR) — Native Primitive Candidate
Two-candle directional pattern where the immediate successor retrades a configurable portion of the first candle's trend-side wick while continuing in the same directional bias.

- Bullish: C1 bullish upper wick is retraded by C2 bullish lower wick.
- Bearish: C1 bearish lower wick is retraded by C2 bearish upper wick.

Minimum overlap/rebalance depth is configurable.

### Multi-Candle FVG — Native Primitive Candidate
FVG formed across one coherent multi-candle directional displacement leg. The final confirming candle remains non-overlapping with the origin candle and preserves the imbalance interval. Downstream behavior uses the common FVG Market Object type with formation metadata.

### FVG Failure — Derived Primitive
A body close beyond the far boundary of an existing FVG. Full mitigation/fill alone is not necessarily failure.

### IFVG — Derived Pattern/Object State
A failed FVG that later moves away, is approached from the opposite side, and demonstrates inverted respect. Prefer preserving the same Market Object with changed lifecycle state/polarity rather than creating an unrelated zone.

## 8. Generic zone interaction metrics

All directional zones (FVG, OB, Wick FVG, VI, IFVG, etc.) use one normalized depth model from the expected approach side:

- `0%` = near boundary
- `50%` = midpoint / consequent encroachment
- `100%` = far boundary

Record current and maximum penetration objectively. Strategies may reference arbitrary ratios/Fibonacci levels such as 25%, 50%, 61.8%, 70.5%, 75%, and 78.6% without creating specialized detector names.

## 9. Derived price-action primitives

### Break
Price transitions through a reference and achieves a confirmed body close beyond the level/far boundary.

### Reclaim
A previously lost reference is later recovered through a confirmed body close back onto its original side.

### Rejection
Price interacts with or penetrates a reference/zone, fails to achieve acceptance through it, and subsequently closes/moves away.

### Break Failure
A previously confirmed Break later loses acceptance and closes back through the same reference.

## 10. Retest, Resumption, BRR

### Retest — Relationship
A Retracement that returns to a specific previously established/broken reference or Market Object after price has moved away.

### Resumption — Derived Market Event
Reassertion of the active parent-leg direction following Retracement. Confirmation can be configured from Directional Body Close, Signal Bar, Engulfing, Displacement, Micro BOS, or a composite rule.

### Break–Retest–Resumption (BRR) — Derived Pattern

`BREAK(Object A) -> RETRACEMENT -> RETEST(Object A) -> RESUMPTION(original direction)`

The same object/reference identity must be preserved across the sequence. A successful retest may contain Rejection. Failure path is Break -> Retest -> Break Failure/opposing Reclaim.

## 11. Directional Pressure

Directional Pressure is a **Derived Market State**, not a primitive. It expresses strength and persistence of directional delivery at a structural degree.

Potential inputs include:

- displacement frequency/density;
- BOS progression;
- retracement depth and duration;
- FVG/Wick FVG holds and failures;
- Signal Bars and directional close quality;
- ATR-normalized distance/velocity;
- opposing structural/evidence events.

Suggested qualitative states:

- `WEAK`
- `MODERATE`
- `STRONG`
- `EXTREME`

This state is essential for distinguishing a normal pullback from a precipitous move.

## 12. Evidence Engine

Evidence scoring must not be baked into primitive detectors.

Pipeline:

`Primitive Occurrence -> Evidence Assertion -> Evidence Cluster -> Directional Evidence Ledgers -> Evidence Balance -> Decision Policy`

An **Evidence Cluster** is a bounded, related local price-action narrative. Object identity and temporal/causal relationships matter.

Example bullish cluster:

`Bullish FVG -> shallow retest of same FVG -> bullish Displacement -> bullish MSS`

The bullish cluster must be evaluated relative to preceding bearish evidence. The same bullish cluster may be sufficient during a mild pullback and insufficient during extreme bearish delivery.

Events may both add evidence to their own side and damage opposing evidence. Example: a meaningful Bullish Interior MSS may add bullish evidence while invalidating part of the bearish structural ledger.

Support three strategy rule classes:

- **WEIGHT** — changes directional evidence;
- **GATE** — mandatory condition regardless of score;
- **INVALIDATOR** — invalidates the setup/cluster.

Do not label a raw Evidence Score as probability. Probability requires empirical calibration against historical outcomes and sample size.

## 13. Manual/automated boundary

Manual domain for this milestone:

- Daily/HTF thesis and directional bias;
- important HTF liquidity;
- target;
- Area;
- manually drawn contextual levels/zones.

Automated downstream domain:

- price response at/after the supplied context;
- primitives and structural interpretation;
- Evidence Clusters and directional comparison;
- strategy/Scout eligibility.

In shorthand:

> Human: "This is where I care." ARISE: "This is what buyers and sellers are objectively doing now that price is here."

## 14. Operators, not trading primitives

Logical operators: `AND`, `OR`, `NOT`, `THEN`; later `WITHIN`, `UNTIL`, `ONCE`, `RESET`.

Spatial operators: `ABOVE`, `BELOW`, `INSIDE`, `OUTSIDE`, `OVERLAPS`, `CONTAINS`, `BETWEEN`, `WITHIN_DISTANCE`.

Relationship vocabulary: `CREATED_BY`, `RETESTS`, `BREAKS`, `INVALIDATES`, `RESUMES_FROM`, `SAME_OBJECT`.

These are engine vocabulary and should not inflate the trading-primitive catalog.

## 15. Implementation order inside this milestone

Although this is one coordinated milestone, implementation and acceptance are layered:

0. **Chart/runtime UX** — real MT5 candles, live active-bar updates, drawing preview/edit/delete, usable Layers/Execution tabs.
1. **Shared Market Object + geometry foundation** — normalized zones, object relationships, structural degree/parent-child metadata.
2. **Candle/imbalance primitives** — Directional Body Close, Engulfing, Signal Bar, VI, Wick FVG, IR, Multi-Candle FVG.
3. **Leg/structure engine** — close-based legs, wick extremes, Micro/Interior/Exterior swings, HH/HL/LH/LL, protected structure.
4. **Structural intelligence** — Structural OB, BOS, CHoCH, upgraded MSS.
5. **Movement/lifecycle** — generic Retracement, Resumption, Break, Reclaim, Rejection, Failure, IFVG, BRR relationships.
6. **Evidence Engine** — clusters, directional ledgers, evidence balance, invalidation, sequence/context weighting, Directional Pressure.
7. **Strategy Package vNext exposure** — declarative configuration only; no executable code inside packages.
8. **Visual/historical acceptance** — compare detector output against manually annotated charts.
9. **MT5 demo acceptance** — real package-driven downstream strategy behavior on broker demo.

## 16. Freeze rule

Do not add new vocabulary merely because another indicator/pattern name exists. A new primitive/candidate enters only when a real strategy cannot be represented cleanly and deterministically with the frozen vocabulary above.
