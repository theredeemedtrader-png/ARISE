# M10 — Shadow + Demo Execution Implementation Report

**Status:** Frozen; execution-safety audit passed after Windows acceptance  
**Date:** 2026-09-11

## Delivered

- Pure execution intent, validation, and immutable OrderPlan model in `packages/execution`.
- Migration v8 execution audit store plus narrow compatibility migration v9 for immutable, quantity-scoped Agent protection/flatten operations.
- Electron main-process `ExecutionGateway` with typed IPC/preload access and no renderer broker access.
- MT5 protocol v2 for idempotent execution commands plus ACK, fill, exact-quantity protection, and independently idempotent flatten facts.
- SHADOW plans that terminate before transport.
- DEMO commands gated by current M9 session/account/truth/reconciliation state.
- Bounded acknowledgement retry and durable restart recovery.
- Explicit partial-fill accounting and protection-before-Scout materialization.
- Agent-owned bounded initial protection retry with safety flatten on failure.
- Broker-authoritative reconciliation for M10 automated exposure without adopting or mutating manual/external positions.
- Strategy runtime UI support for DEMO launch, CREATE_SCOUT parameters, and explicit proposal execution.

## Honest integration status

The repository still has no real MT5 terminal automation connector. `MT5_READ_ONLY` rejects mutation commands. DEMO order lifecycle acceptance uses `FAKE_HARNESS`; the UI and protocol never present it as a live terminal. LIVE is unavailable.

## Verification

- `pnpm install --frozen-lockfile` — passed
- `pnpm check` — passed; 543 tests
- `pnpm build` — passed
- `pnpm test:e2e` — 11 passed
- `pnpm dev` — Electron/Vite shell launched successfully

The fake broker matrix covers duplicate sends, rejection, timeout, partial fill, disconnect, stale ACK, restart replay, and protection failure/flatten. Database tests prove no Position exists before verified protection, event replay is deduplicated, stale events cannot advance state, uncertain commands survive repository restart, and broker reconciliation does not silently mutate manual exposure.

## Execution-safety audit — 2026-09-11

### Defects found and fixed

- Terminal/failed execution lifecycles accepted late ACK, fill, and protection transitions. Broker messages are now stored first for audit, then ignored for state projection once the lifecycle or command is terminal; a fill also outranks a late rejection ACK.
- Protection results did not identify the exact protected quantity. Protocol v2 now carries `protectedVolume`, broker command ID, and stable idempotency key; materialization uses that exact cumulative fill and weighted fill price.
- Protection verification could implicitly follow the newest fill, over-protect, or accept a worsened stop. The repository now requires exact current broker quantity, bounded attempts, stable plan identity, and direction-aware no-worsening against both the immutable plan and prior verified stop.
- Emergency flatten shared the entry command identity. Flatten now has its own broker command ID, stable effect key, exact target quantity, durable immutable ledger row, and verified closed-quantity check.
- ACKNOWLEDGED commands were not restart-retry candidates. All nonterminal delivery stages now replay within the existing three-attempt bound; broker-effect idempotency prevents duplicate exposure.
- Final Agent mutation validation trusted Desktop-era context. The Agent now independently rejects stale session, expired plan, incomplete/unavailable truth, live or mismatched account, disconnected terminal, missing symbol/quote, stale quote, excessive spread, unsupported command type, real MT5 mutation, and external-position targets before a new effect.
- Broker quantity/protection conflicts updated only part of local operational state. Reconciliation now makes broker quantity/protection authoritative and moves the execution lifecycle to blocking UNKNOWN when they conflict.
- An unresolved execution did not globally gate another DEMO entry. Validation now blocks additional exposure until all prior execution lifecycles are terminal or reconciled.

### Adversarial proof added

Tests cover exact partial and subsequent-fill protection, weighted quantity updates, over-protection, worsened stops, out-of-order cumulative fills, late rejection after fill, terminal ACK/fill resurrection attempts, bounded retries, restart replay from ACKNOWLEDGED and other nonterminal stages, full-quantity flatten after later partial fill, duplicate flatten replay, idempotency-key collision, live/account/session/expiry/external-target isolation, real-transport read-only enforcement, and broker-authoritative quantity/protection conflict recovery.

### Audit validation

- `pnpm install --frozen-lockfile` — passed
- clean baseline `pnpm check` — passed; 518 tests before audit changes
- final `pnpm check` — passed; 543 tests
- `pnpm build` — passed
- `pnpm test:e2e` — 11 passed on Windows after removing IDE-supplied `ELECTRON_RUN_AS_NODE=1`
- `pnpm dev` — Electron/Vite process launched and remained healthy for smoke observation, then was intentionally stopped
- Node `better-sqlite3` ABI restored with `pnpm --filter @arise/desktop native:node`; final 543-test run passed

**Recommendation:** M10 AUDIT PASSED. M11 remains unstarted.

## Excluded

No advanced breakeven, trailing, Colony-wide protection, mature-leg/runner automation, general order modification/cancellation, real-terminal mutation, LIVE execution, or M11 work is included.
