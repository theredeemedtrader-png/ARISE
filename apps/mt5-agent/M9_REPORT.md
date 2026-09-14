# ARISE M9 — Read-only MT5 Integration and Reconciliation Report

## Objective

M9 provides broker-truth visibility and recovery-safe reconciliation through a local read-only Agent. It deliberately stops before ExecutionIntent, OrderPlan, order submission, modification/cancellation, protection, or live execution.

## Architecture

`@arise/shared` owns the versioned protocol and UI schemas. `apps/mt5-agent` owns the localhost read-only server and fake harness. Electron main owns the socket client and reconnect loop. `Mt5Repository` owns durable message identity, immutable history, current broker-reality projections, reconciliation, and recovery state. Renderer access remains typed IPC only.

Desktop requests are limited by a discriminated schema to `HELLO`, `SNAPSHOT_REQUEST`, and `HEARTBEAT`. Agent responses provide handshake/session health, snapshots, quotes, candles, heartbeat health, or explicit errors. There is no broker mutation message in the protocol.

## Persistence and reconciliation

Migration v7 adds session state, inbox/outbox history, broker/account snapshots, symbol mappings, quotes, candles, broker position/pending-order mirrors, broker events, reconciliation runs/items, connection events, and safety events.

Inbound messages are keyed by message ID and SHA-256. Exact duplicates are no-ops; an ID/content conflict fails. Complete snapshots update the broker mirror authoritatively. Incomplete snapshots retain prior exposure as UNKNOWN. Account mismatch blocks. Broker-only exposure is classified manually; ARISE-only records are reported and never recreated.

## Agent honesty

The test transport reports `FAKE_HARNESS`. The normal Agent entry point reports `MT5_READ_ONLY` and terminal disconnected because this repository does not contain real terminal automation. No test or UI path claims a successful live MT5 connection.

## Validation

Windows acceptance on 2026-09-11:

- frozen install passed
- `pnpm check` passed with 503 substantive tests
- `pnpm build` passed
- `pnpm test:e2e` passed with 9 tests
- development Electron launch passed
- M9 Electron flows verified disconnect/UNKNOWN/reconnect, fake-harness labeling, account/symbol/quote/candle/position/order ingestion, external classification, and restart persistence

## Freeze recommendation

M9 is frozen. M10 remains unstarted.
