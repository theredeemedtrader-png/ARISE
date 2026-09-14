# ARISE — MILLIPEDE_PHILOSOPHY.md

**Status:** Canonical  
**Version:** 1.0-draft  
**Purpose:** Define the trading philosophy ARISE is designed to preserve. This file governs product and implementation decisions wherever the Millipede model is involved.

---

## 1. Source and attribution

ARISE is inspired in part by pipEASY / Graeme's public **“Building an equity millipede”** material.

The source material emphasizes principles over rigid techniques, low-risk participation, higher-timeframe hindsight, filtering down through smaller timeframes, diversification/stacking when there is growth, and allowing unusually successful positions to become long-lived legs.

ARISE does **not** attempt to reproduce pipEASY's system literally. It translates the principles into a modern, explicit, reviewable and automatable trading operating system.

This document distinguishes:

- **SOURCE PRINCIPLE** — directly grounded in the Millipede material.
- **ARISE EXTENSION** — a product/system concept invented or formalized for ARISE.
- **USER-SPECIFIC RULE** — a deliberate preference for this implementation.

---

## 2. Core philosophy

### 2.1 Participation over prediction

**SOURCE PRINCIPLE**

The objective is not to forecast every market move correctly. The trader forms a reasonable higher-timeframe expectation, then participates cheaply enough that being wrong is survivable.

ARISE therefore must never reduce the process to:

`prediction → entry → win/loss`

The intended model is:

`hindsight/thesis → area → low-risk participation → evidence → growth → stacking → durable legs`

A missed opportunity is acceptable. A small failed participation attempt is acceptable. The system is designed around asymmetric opportunity rather than perfect foresight.

---

### 2.2 Low-risk entry is the price of participation

**SOURCE PRINCIPLE**

A trader seeks low-risk entry into a potentially much larger move. Repeated small losses are not automatically evidence that the thesis or process is broken; they can be the cost of finding the position that survives.

**ARISE EXTENSION**

ARISE formalizes these attempts as **Attempts** and newly filled attempts as **Scouts**.

A Scout is not a declaration of certainty. It is a cheap probe.

---

### 2.3 Growth matters more than win rate

**SOURCE PRINCIPLE**

The Millipede logic is built around minimizing losses while allowing exceptional opportunities to expand. A small number of unusually persistent positions can dominate the payoff.

Therefore ARISE must not optimize the product around win rate alone.

Primary Millipede-oriented metrics include:

- realized pips,
- open pips,
- protected pips,
- scouting cost,
- attempts,
- survivors,
- longest leg,
- position-pips,
- fresh risk,
- protected exposure.

Win rate remains useful, but it is not the governing success metric.

---

## 3. Higher timeframe opportunity, lower timeframe participation

### 3.1 Hindsight establishes scale

**SOURCE PRINCIPLE**

Higher-timeframe hindsight gives the trader an expectation of the scale of opportunity. Smaller timeframes are then used to participate at lower cost.

The source explicitly describes flexible mappings such as:

- Monthly hindsight → Weekly area → 4H smaller area → 5M entries
- Weekly hindsight → 4H area → 1H entries
- 4H hindsight → 1H area → 5M entries
- Daily hindsight → 1H area → 5M entries

The method is relative; the **scale** changes.

### 3.2 ARISE must not hard-code timeframe roles

**ARISE EXTENSION**

A timeframe may be assigned:

- HINDSIGHT
- AREA
- ENTRY
- any combination of the above
- none

Any number of timeframes may participate in a Colony.

Valid examples include:

`M:H → W:H → D:H+A → 4H:A → 1H:A → 15M:E → 5M:E → 1M:E`

or:

`W:H → 4H:A → 5M:E`

or:

`D:H → 5M:E`

The software must never assume that Weekly is always hindsight, 4H always area, or 5M always entry.

---

## 4. Hindsight → Area → Entry

ARISE uses three conceptual purposes.

### HINDSIGHT

Where is price plausibly going on the scale being studied?

This becomes the directional/structural thesis.

### AREA

Where would participation become interesting?

An Area is a location/context, not an entry by itself.

### ENTRY

How can ARISE participate cheaply and specifically?

Entry logic may be manual, confirmation-based or automated.

These are **purposes**, not fixed timeframes.

---

## 5. Thesis and destination

### 5.1 One explicit idea per Colony

**USER-SPECIFIC RULE**

Each Colony begins with one explicit idea/thesis.

Typical fields:

- instrument,
- thesis timeframe,
- LONG / SHORT / NEUTRAL,
- written thesis,
- origin/context,
- primary target,
- target zone,
- invalidation,
- created time,
- thesis version.

### 5.2 Target model

**ARISE EXTENSION**

The normal destination is the next opposing external liquidity on the relevant thesis timeframe.

A Target is **not automatically a broker TP**.

It may function as:

- reference only,
- partial-exit trigger,
- full-exit trigger,
- trailing trigger,
- runner-decision point,
- manual decision point.

Target progress is spatial distance, never a probability estimate.

---

## 6. Scouts, Survivors and Legs

### 6.1 Position lifecycle

**ARISE EXTENSION**

`CANDIDATE → SCOUT → SURVIVOR → PROTECTED → LEG → MATURE_LEG → RUNNER`

Alternative terminal/transfer states:

`FAILED / CLOSED / CONSOLIDATED`

### 6.2 Meanings

**Scout**  
A newly filled low-cost participation attempt.

**Survivor**  
A Scout that has demonstrated meaningful favorable evidence. Survivor does not inherently mean break-even.

**Protected**  
A position whose downside has been materially secured according to its protection criterion.

**Leg**  
Established campaign exposure.

**Mature Leg**  
Durable exposure that has survived enough structure/time/progress to be treated as established higher-timeframe participation.

**Runner**  
A Mature Leg deliberately detached from the original local exit expectation and permitted to continue under a different management policy.

### 6.3 State does not imply management

A state transition must not silently perform management.

Examples:

- `SCOUT → SURVIVOR` must not automatically move SL.
- `SURVIVOR → PROTECTED` is not a synonym for “move to BE.”
- `LEG → MATURE_LEG` must not automatically trail.
- `MATURE_LEG → RUNNER` must not loosen protection.

Management is governed by a separate **Management Policy / Protection Engine**.

---

## 7. Stacking

### 7.1 Stack onto evidence, not hope

**SOURCE PRINCIPLE + ARISE FORMALIZATION**

The Millipede grows by adding participation when an opportunity is demonstrating growth.

ARISE must therefore separate:

- valid strategy signal,
- permission to create another Scout.

A Colony can have a Stacking Policy such as:

- ANY_VALID_ENTRY,
- ONLY_AFTER_SURVIVOR,
- ONLY_AFTER_PROTECTED,
- ONLY_AFTER_LEG,
- MANUAL.

Stacking can also be blocked by:

- thesis invalidation,
- Area invalidation,
- attempt budget exhaustion,
- fresh-risk budget,
- maximum active Scouts,
- target proximity,
- strategy deterioration,
- manual session stop.

---

## 8. Attempts and scouting cost

**ARISE EXTENSION**

An **Attempt** begins before a fill and records the process of trying to acquire exposure.

Possible outcomes:

- EXPIRED
- FAILED
- SCRATCH
- SURVIVED

A Colony may limit:

- maximum attempts,
- maximum scouting loss,
- cooldown,
- reset condition.

Possible reset conditions:

- NEW_SESSION,
- NEW_CANDLE,
- NEW_STRUCTURAL_EVENT,
- NEW_AREA_TOUCH,
- NEW_STRATEGY_SIGNAL,
- MANUAL.

The intent is disciplined repeated participation, not unlimited retrying.

---

## 9. Fixed-size, pip-first accounting

**USER-SPECIFIC RULE**

ARISE uses fixed position sizes as the primary sizing model.

Example gears:

- G1 = 0.05
- G2 = 0.10
- G3 = 0.20
- G4 = 0.50

The system must not automatically compound position size as account equity changes unless an explicit future feature is enabled.

Primary display unit: **pips**.

Money is still calculated internally for safety and accounting, but can be globally hidden.

Display modes:

- PIP-FIRST
- PIPS + MONEY
- MONEY-FIRST
- $ HIDDEN

Useful metrics:

**Open Pips** — current unrealized pip result.  
**Realized Pips** — realized pip result.  
**Scouting Cost** — losses paid to establish the Colony.  
**Protected Pips** — pip profit protected by stops/closed portions.  
**Position-Pips** — sum of pip results across position legs, not merely the underlying market move.  
**Fresh Risk** — currently exposed unprotected downside.  
**Protected Exposure** — established exposure with material downside protection.

Money hidden is presentation only. Raw fills must retain enough information to calculate money accurately.

---

## 10. Colony

**ARISE EXTENSION**

A Colony represents a campaign around one explicit thesis.

Typical hierarchy:

`MARKET → IDEA/THESIS → COLONY → AREAS → STRATEGY RUNTIME → ATTEMPTS → SCOUTS → LEGS → TARGET/RUNNER`

Colony lifecycle:

`DORMANT → BUILDING → ESTABLISHED → MATURE`

Alternative states:

`DECAYING / INVALIDATED / COMPLETED`

A Colony aggregates positions but does not erase their identities.

Each position preserves:

- Trade ID,
- Attempt ID,
- original Colony,
- current Colony,
- lineage,
- original entry,
- initial stop,
- lifecycle history,
- management history.

---

## 11. Promotion and lineage

**ARISE EXTENSION**

A successful lower-timeframe or lower-scale leg may later be promoted into a larger Colony.

Example:

`Daily Long #11 → Weekly Long #05 → Monthly Long #02`

History must never be rewritten.

Each transferred leg records:

- Original Colony,
- Current Colony,
- Colony Lineage,
- promotion event,
- evidence at promotion.

Automatic promotion is not a V1 requirement. ARISE may suggest it; the user decides.

---

## 12. Thesis invalidation is not stop-out

A Scout stop does **not** automatically invalidate a thesis.

Likewise, thesis invalidation does **not** automatically close every open position.

On thesis invalidation ARISE should:

- stop new Scouts,
- cancel pending Candidates,
- disarm relevant Strategy Runtime nodes,
- notify the user,
- apply the configured policy for existing positions.

Default V1 existing-position policy:

`MANUAL_DECISION`

---

## 13. Principles over techniques

**SOURCE PRINCIPLE**

The source explicitly distinguishes principles from rigid techniques.

ARISE must preserve this flexibility.

The Strategy Encyclopedia therefore stores strategies as versioned definitions. A setup may be:

- manual,
- machine-detectable,
- fully automatable.

The user can change technique while retaining the underlying Millipede principles.

The software must never imply that one specific pattern, timeframe mapping, swing algorithm or entry model *is* the Millipede philosophy.

---

## 14. ARISE's explicit extensions

The following are ARISE product inventions/formalizations, not claims about pipEASY's original system:

- Colony object and lifecycle,
- explicit Thesis versions,
- opposing external-liquidity Target object,
- Scout/Survivor/Protected/Leg/Mature/Runner state machine,
- fixed-size Gear UI,
- position-pips,
- fresh-risk budget,
- Strategy Encyclopedia,
- Grasshopper-like Strategy Graph,
- detector contracts,
- Market Objects,
- Timeframe Projection,
- Decision Evidence,
- immutable Evidence Snapshots,
- Review Scheduler,
- economic-calendar context,
- MT5 bridge,
- delegated deterministic execution,
- True BE / Colony BE engine,
- versioned management policies,
- crash recovery and broker reconciliation,
- SHADOW / DEMO / LIVE approval gates.

These extend the philosophy without being attributed to the original author.

---

## 15. Non-negotiable design implications

Any implementation of ARISE that does one of the following is architecturally wrong:

1. Collapses the system into signal → trade → win/loss.
2. Makes win rate the primary Millipede metric.
3. Hard-codes Hindsight/Area/Entry to particular timeframes.
4. Treats Target as synonymous with broker TP.
5. Treats Scout stop-out as thesis invalidation.
6. Treats position state as synonymous with management action.
7. Loses position/Colony lineage during consolidation.
8. Rewrites historical thesis, strategy, Market Object or evidence versions.
9. Defaults strategy sizing to % account risk instead of fixed-size pip-first operation.
10. Automatically pyramids without explicit stacking permission.
11. Hides why an automated decision occurred.
12. Allows automation to create exposure when broker state is uncertain.

---

## 16. One-sentence ARISE interpretation

**ARISE helps the trader form a higher-timeframe thesis, identify where participation matters, repeatedly acquire low-cost exposure on lower timeframes, keep failed attempts small, preserve and add to positions that demonstrate growth, and study every step with full lineage and evidence.**
