# ARISE — Agent Operating Guide

**Status:** Canonical repository-level agent context  
**Applies to:** Codex in VS Code, ChatGPT coding agents, Astra, and human implementers  
**Last updated:** 2026-09-14  

This file exists so an AI coding agent can enter the repository without relying on a prior chat transcript.

## 1. What ARISE is

ARISE is a Windows trading operating system built around a Millipede-style participation model, multi-timeframe thesis workflow, visual strategy construction, explainable automation, evidence capture, and eventually controlled MT5 execution.

ARISE is **not** a generic signal bot, one-trade-per-signal strategy engine, or journal bolted onto a broker terminal.

The core operating model is:

`Idea / Thesis -> Colony -> Area / Strategy Runtime -> Attempt -> Trade -> Position -> Scout -> Survivor -> Protected -> Leg -> Mature Leg -> Runner`

A Colony may make many low-cost participation attempts. A stopped Scout does **not** automatically invalidate the parent Idea or Colony.

## 2. Mandatory startup procedure

Before changing code:

1. Read this file.
2. Read `docs/CURRENT_MILESTONE.md`.
3. Read `docs/ASTRA_INSTRUCTIONS.md`.
4. Read the canonical docs relevant to the task.
5. Inspect the implementation and tests before editing.
6. Preserve all frozen milestones unless a narrowly necessary compatibility fix is required.

When requirements conflict, use this priority:

1. Explicit current task / `docs/CURRENT_MILESTONE.md`
2. Canonical files in `docs/`
3. Frozen milestone behavior and tests
4. Existing public interfaces
5. Existing implementation
6. Agent assumptions

Do not silently resolve a canonical conflict by simplifying the model. Surface the conflict.

## 3. Frozen milestone boundary

The following milestones are frozen in the current repository:

- **M0 — Engineering Foundation**
- **M1 — Domain**
  - M1.1 Idea / Colony / Target
  - M1.2 Attempt / Trade / Position / Stacking
  - M1.3 Market Objects / References / Timeframe Projection
- **M2 — Persistence + Immutable History**
- **M3 — Application Shell**
- **M4 — Charts / Drawings / Market Objects**
- **M5 — Ideas / Thesis / Knowledge / Review**
- **M6 — Strategy Encyclopedia + Grasshopper-style Graph**
- **M7 — Strategy Runtime + Detector Engine**
- **M8 — Evidence + Decision Trace**
- **M9 — MT5 Integration / Read-only bridge / Reconciliation foundation**
- **M10 — Shadow + Demo Execution**
- **M11 — Protection + Colony Automation**
- **M12 — Analytics + Review**
- **M13 — Hardening + Final Safety Gate**

**M0–M13 are frozen.** M13 passed its automated safety gate; see `M13_REPORT.md`.

The post-roadmap **Real MT5 Demo-Terminal Acceptance Gate passed** against `Eightcap-Demo` / DEMO. Actual runtime entry, fill, verified protection, management, partial/full close, durable replay/reconnect, Desktop restart, and two-Scout Colony journeys passed through the frozen gateways. The final broker snapshot was `0` positions / `0` pending orders. Venue conditions that could not safely be induced are explicitly `NOT REPRODUCIBLE` in the acceptance report and retain deterministic harness coverage.

See `docs/CURRENT_MILESTONE.md`, `M13_REPORT.md`, and `REAL_MT5_DEMO_ACCEPTANCE_REPORT.md` for the exact state and narrow compatibility fixes. Do not enable LIVE trading, add `MT5_LIVE`, begin productization/Strategy Package work without a new milestone, mutate while permission/quote/reconciliation is unhealthy, or redesign frozen milestones.

## 4. Canonical vocabulary

Use these terms consistently:

- ARISE
- LONG / SHORT / NEUTRAL
- Idea / Thesis
- Colony
- Hindsight / Area / Entry
- Attempt
- Trade
- Candidate
- Scout
- Survivor
- Protected
- Leg
- Mature Leg
- Runner
- Target
- Market Object / MarketObjectVersion
- Strategy Definition / Strategy Version
- Combo
- Strategy Map
- Strategy Template
- Strategy Runtime / Runtime Node
- Detector
- Evidence
- Decision Trace

Do not replace canonical LONG/SHORT naming with Bull/Bear in domain/UI models unless an external API forces an internal translation.

## 5. Concepts that must remain separate

Do not collapse these concepts merely to reduce class/table count:

- Idea != IdeaVersion
- Thesis != Colony
- Target != broker TP
- Area != Entry
- Strategy Definition != Strategy Runtime
- Strategy capability != execution mode
- Strategy Graph != detector implementation
- Encyclopedia prose != executable detector contract
- Market Object != chart drawing
- MarketObject != MarketObjectVersion
- Attempt != Trade != Position != Broker Order
- ExecutionIntent != OrderPlan != Order != Fill
- Position State != Management Policy
- Survivor != Protected
- Survivor != automatic breakeven
- Leg != automatic trailing
- Individual BE != Colony BE
- Position stop != Colony stop != Thesis invalidation
- Scout stop-out != Thesis invalidation
- Current operational state != immutable history
- Not Reviewed != Neutral

## 6. Timeframe model

Never hard-code role mappings such as Weekly = Hindsight, 4H = Area, 5M = Entry.

A timeframe can be:

- HINDSIGHT
- AREA
- ENTRY
- any combination
- none

A Colony can use any number of timeframes.

Canonical candle boundaries and parent/child relationships must ultimately come from `TimeframeService`. Demo chart aggregation must not silently become the canonical broker-aware time model.

## 7. Strategy / runtime model

Canonical hierarchy:

`Strategy -> Combo -> Strategy Map -> Template -> Idea/Colony Instance -> Runtime`

The Strategy Graph is a typed graph with canonical node families:

- STRATEGY
- LOGIC
- MODIFIER
- MARKET_OBJECT
- STATE
- ACTION

Logic includes AND / OR / THEN / NOT as supported by the frozen graph model.

Automation capability and chosen runtime mode are separate.

Runtime evaluation modes include:

- ON_TICK
- ON_PRICE_UPDATE
- ON_BAR_UPDATE
- ON_BAR_CLOSE
- MANUAL

Runtime operating modes currently include OBSERVE and SHADOW as safe M7 surfaces. DEMO/LIVE remain gated for later milestones.

**SHADOW action proposals are records only. They must not create broker exposure.**

Manual/confirmation nodes support explicit:

- CONFIRM
- REJECT
- SKIP

Each decision must produce a Decision Trace and deterministic state transition.

## 8. Market Object invariant

**Drawing tools define geometry. Market Object properties define meaning.**

A rectangle is not automatically an FVG. An FVG is not automatically an Area.

Semantic Type, Role, geometry, ownership, and historical version are distinct concerns.

Important Market Objects require stable IDs and immutable revisions. Historical decisions must continue to resolve the exact versions used at the time.

## 9. Millipede / stacking invariant

Never reduce ARISE to:

`signal -> one trade -> win/loss`

ARISE supports repeated participation while a higher-level thesis remains valid.

Canonical stacking modes include:

- ANY_VALID_ENTRY
- ONLY_AFTER_SURVIVOR
- ONLY_AFTER_PROTECTED
- ONLY_AFTER_LEG
- MANUAL

Attempt budgets and stacking eligibility gate repeated participation. A losing Scout is a failed attempt, not necessarily a failed thesis.

## 10. Risk/accounting invariant

ARISE is **fixed-size and pip-first by default**.

- Fixed-lot Gears are canonical.
- Do not make % account risk the primary sizing model.
- Pips are primary operational metrics.
- R can exist as a secondary research statistic.
- Monetary values still exist internally for safety/accounting even when `$ HIDDEN` is active.
- Never delete monetary raw data merely because the UI hides dollars.

## 11. Execution safety boundary

Until later execution milestones explicitly authorize it, do not add hidden broker side effects.

The intended future chain is:

`Runtime Action -> ExecutionIntent -> Validation -> immutable OrderPlan -> idempotent MT5 command -> broker acknowledgement -> fill/partial fill -> protection verification -> Position state`

Broker reality wins during reconciliation.

Recovery principle:

`uncertainty -> no new exposure -> preserve protection -> reconcile -> verify -> resume`

M7 must remain non-executing. M8 evidence work must remain non-executing unless the current milestone explicitly changes that boundary.

## 12. Historical integrity

Never silently overwrite historical decisions.

Version or event-source behavior-changing concepts, including where applicable:

- Idea / Thesis
- Strategy
- Combo / Strategy Map / Template
- Market Object geometry/semantics
- runtime transitions
- detector evaluations
- Decision Traces
- Evidence
- reviews
- broker/execution/protection events in later milestones

Historical trades/decisions must be reconstructable against the exact versions that governed them.

## 13. Package / dependency rules

### `packages/domain`
Must not depend on React, Electron, SQLite, Drizzle, MT5/MQL, chart libraries, or UI filesystem code.

### Renderer
Must not directly access SQLite, MT5, or broker sockets. Use typed IPC/application services.

### Strategy Graph
May orchestrate detector contracts but must not become a dumping ground for TA implementations.

### MT5 Agent
Must remain execution/integration infrastructure, not the entire strategic brain.

## 14. Development workflow

Work directly in this repository. Do not create `v2`, `v3`, `v4` copies for every fix when operating locally in VS Code.

Prefer small, reviewable edits and keep tests green continuously.

Before claiming a milestone or fix complete, run the relevant gates from repo root:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
```

`pnpm check` includes typecheck/lint/unit tests according to the root scripts.

When native `better-sqlite3` ABI switching is involved, use the repository's existing Node/Electron rebuild scripts rather than installing ad-hoc copies.

Do not weaken or delete a failing test merely to make the suite green. If a test is wrong because the canonical contract changed, explain why and update the test to the canonical behavior.

## 15. Freeze protocol

A milestone may be marked frozen only when:

1. Scope/invariants are satisfied.
2. Existing frozen tests remain green.
3. New tests cover the new behavior.
4. `pnpm check` passes.
5. `pnpm build` passes.
6. Required Electron E2E tests pass on Windows.
7. Required visual/manual checks are performed.
8. No next-milestone work has leaked in.

After freeze, preserve it. Future edits to frozen behavior require a narrowly justified compatibility fix or an explicit product decision.

## 16. Canonical reading map

Start with:

- `docs/CURRENT_MILESTONE.md`
- `docs/ASTRA_INSTRUCTIONS.md`
- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/DATA_MODEL.md`
- `docs/STATE_MACHINES.md`

Then use task-specific docs:

- Strategy/runtime: `docs/STRATEGY_ENGINE.md`
- Market data/timeframes: `docs/MARKET_DATA_SPEC.md`
- Execution: `docs/EXECUTION_SPEC.md`
- Protection: `docs/PROTECTION_SPEC.md`
- Recovery: `docs/RECOVERY_AND_SAFETY.md`
- Evidence: `docs/EVIDENCE_SYSTEM.md`
- Review: `docs/REVIEW_SYSTEM.md`
- UX: `docs/UX_SPEC.md`
- Testing: `docs/TEST_PLAN.md`
- Philosophy: `docs/MILLIPEDE_PHILOSOPHY.md`

Milestone implementation reports live beside the implementation packages/apps and should be read when touching frozen work.

## 17. Current handoff rule

Do not rely on chat history for project state. `docs/CURRENT_MILESTONE.md` is the durable handoff document and must be updated when a milestone is frozen or the active milestone changes.
