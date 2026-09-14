# ARISE — Build Roadmap

**Updated:** 2026-09-12

This file is a navigation aid. Canonical behavior remains defined by the detailed specs in `/docs`.

| Milestone | Scope | State |
|---|---|---|
| M0 | Engineering Foundation | FROZEN |
| M1 | Domain Model | FROZEN |
| M1.1 | Idea / Colony / Target | FROZEN |
| M1.2 | Attempt / Trade / Position / Stacking | FROZEN |
| M1.3 | Market Objects / References / Timeframe Projection | FROZEN |
| M2 | Persistence + Immutable History | FROZEN |
| M3 | Application Shell | FROZEN |
| M4 | Charts / Drawings / Market Objects | FROZEN |
| M5 | Ideas / Thesis / Knowledge / Review | FROZEN |
| M6 | Strategy Encyclopedia + Grasshopper-style Graph | FROZEN |
| M7 | Strategy Runtime + Detector Engine | FROZEN |
| M8 | Evidence + Decision Trace | FROZEN |
| M9 | MT5 Integration / Read-only bridge / Reconciliation foundation | FROZEN |
| M10 | Shadow/Demo Execution | FROZEN |
| M11 | Protection + Colony Automation | FROZEN |
| M12 | Analytics + Review | FROZEN |
| M13 | Hardening + Final Safety Gate | FROZEN |

The M0–M13 roadmap is complete. The separate Real MT5 Demo-Terminal Acceptance Gate remains **NOT PASSED / PENDING MARKET OPEN** because terminal Algo Trading is disabled and the current EURUSD quote is stale. See `docs/CURRENT_MILESTONE.md`, `M13_REPORT.md`, and `REAL_MT5_DEMO_ACCEPTANCE_REPORT.md`.

## Development strategy

Primary development can happen directly in the local VS Code repository. Use an AI coding agent to inspect/edit/run tests in place instead of passing ZIP revisions for every small fix.

Use independent Astra/Codex audits at major architectural/safety boundaries, especially chart/runtime integration, MT5, execution, protection, reconciliation, and live-readiness hardening.

Never trade speed for broker safety. M9-M13 require progressively stronger integration, failure-injection, restart/reconciliation, and demo verification before any live approval.
