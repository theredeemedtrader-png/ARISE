# ARISE — Current Acceptance Handoff

**Updated:** 2026-09-14  
**Frozen milestones:** M0–M13  
**Current gate:** Windows Productization Phase 1 — PASSED on `product/windows-packaging`

## Status

The roadmap, post-roadmap real MT5 demo-terminal gate, and Windows Productization Phase 1 are complete. M0–M13 remain frozen. Do not begin Productization Phase 2, Strategy Package work, or LIVE enablement without a new explicit milestone. Phase 1 is isolated on `product/windows-packaging` and is not merged or tagged.

ARISE `1.0.0-beta.1` now builds as a per-user NSIS Windows installer with official brand assets, stable `%LOCALAPPDATA%\ARISE` data paths, startup database backups, production diagnostics, and a packaged local Agent/private Python bridge. Installed-app, upgrade/data-retention, uninstall-retention, icon, renderer-isolation, and Eightcap-Demo read-only recognition checks passed. See `WINDOWS_PRODUCTIZATION_REPORT.md`.

Actual Eightcap-Demo acceptance proved real fill/protection/management, durable replay without duplicate exposure, Desktop restart reconciliation, partial close with quantity-aware SL update, TP set/remove, no-worsening rejection, and a two-Scout Colony journey. Final broker state was `0` positions / `0` pending orders.

Three narrow compatibility fixes are recorded in `REAL_MT5_DEMO_ACCEPTANCE_REPORT.md` and `M13_REPORT.md`:

1. quote freshness derives from local tick-sequence progression;
2. Python protection/flatten uses canonical OrderPlan identities;
3. exact pending-command markers and durable PREPARED/APPLIED ledger identity converge after result loss/reconnect.

## Verified environment and gates

- MT5 build `6182`; `Eightcap-Demo`; `ACCOUNT_TRADE_MODE_DEMO`
- Algo Trading enabled; `MT5_DEMO` protocol v3
- `EURUSD → EURUSD.i`; minimum/step `0.01 / 0.01`
- 627 unit/integration tests, build, and 13 standard Electron journeys: PASS
- Real runtime, recovery/partial-close, management, Colony, and rejection journeys: PASS
- Python bridge: 12 tests PASS
- Node ABI restored and database recovery tests PASS
- Final fresh broker snapshot: `0 / 0`

See `REAL_MT5_DEMO_ACCEPTANCE_REPORT.md` for exact results and explicit `NOT REPRODUCIBLE` venue cases.

Current recommendation:

WINDOWS PRODUCTIZATION PHASE 1: PASSED
