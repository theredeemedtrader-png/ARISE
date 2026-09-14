# ARISE — Real MT5 Demo-Terminal Acceptance Report

**Date:** 2026-09-13–2026-09-14 (America/New_York)  
**Gate status:** PASSED  
**Product boundary:** M0–M13 frozen; LIVE unavailable

## Outcome

ARISE completed the real MT5 demo-terminal gate against the verified Eightcap demo account. Actual market orders, fills, initial protection, stop and TP management, partial/full close, disconnect/replay recovery, Desktop restart reconciliation, and a two-Scout Colony journey ran through the frozen M10/M11 gateways. No renderer accessed MT5 directly.

The final authoritative snapshot contained **0 positions and 0 pending orders**. Every acceptance ledger entry is `APPLIED`; none remains `PREPARED` or uncertain.

## Terminal, account, and instrument

- MT5 build: **6182**; terminal company: MetaQuotes Ltd.
- Broker/server: **Eightcap-Demo**
- Account mode: **DEMO** (`ACCOUNT_TRADE_MODE_DEMO`); hedging
- Terminal connected / Algo Trading: yes / yes
- External Python API disabled: no
- Account trading / Expert permission: yes / yes
- Protocol/transport: v3 / `MT5_DEMO`
- Mapping: `EURUSD → EURUSD.i`; trade mode `FULL`
- Digits / point / tick / pip: `5 / 0.00001 / 0.00001 / 0.0001`
- Volume min / step / max: `0.01 / 0.01 / 40.00`
- Stop / freeze level: `0 / 0` points
- Final Bid/Ask: `1.15491 / 1.15492`
- Final tick sequences: `1789398885347 → 1789398888355` (advanced)
- Final positions / pending orders: **0 / 0**

The account number and full account fingerprint are intentionally omitted.

## Acceptance scenarios

`PASS` means directly demonstrated in this terminal/account. `NOT REPRODUCIBLE` means the venue condition could not legitimately be induced; deterministic failure-harness coverage remains green.

| # | Scenario | Result | Real-terminal evidence |
|---:|---|---|---|
| 1 | Market order → fill → initial SL | PASS | 0.01 and 0.02 LONG market orders returned broker order/deal/position identities; Scout materialized only after actual fill and verified SL. |
| 2 | Broker order rejection | NOT REPRODUCIBLE | No natural venue rejection occurred. Invalid requests were rejected before `order_send`; broker-rejection harness remains green. |
| 3 | Invalid volume | PASS | `0.011` rejected for min/max/step mismatch; exposure stayed zero. |
| 4 | Invalid stop | PASS | Wrong-side initial stop rejected for side/distance/freeze constraints; exposure stayed zero. |
| 5 | Excessive spread | PASS | Immutable zero-spread allowance rejected; exposure stayed zero. |
| 6 | Genuine partial fill | NOT REPRODUCIBLE | Eightcap filled all tiny orders completely. Partial-fill/protection harness remains green. |
| 7 | Stop modification | PASS | Broker snapshot verified improved SL values. |
| 8 | Worsening stop | PASS | ARISE rejected the proposal and broker SL remained unchanged. |
| 9 | Raw BE | NOT REPRODUCIBLE | Price did not move sufficiently in favor for a legal entry-price SL; no unsafe request was forced. |
| 10 | True BE | NOT REPRODUCIBLE | Favorable price and complete real cost input were unavailable; deterministic weighted-fill/cost coverage passes. |
| 11 | Partial close | PASS | 0.02 exposure reduced by 0.01 and verified at 0.01 remaining. |
| 12 | Partial close → SL update | PASS | Improved SL applied using authoritative remaining 0.01 quantity. |
| 13 | Full close | PASS | Gateway full closes were broker-verified. |
| 14 | Emergency flatten after forced protection failure | NOT REPRODUCIBLE | Initial SL always succeeded; forcing unprotected exposure was unsafe. Real full-close mechanics and deterministic bounded/idempotent flatten pass. |
| 15 | Duplicate command replay | PASS | Deliberately lost first result replayed as `ALREADY_APPLIED`, retaining the same ticket/deal and one exposure. |
| 16 | Result loss during order lifecycle | PASS | Agent socket dropped after broker application but before Desktop result; reconnect converged from marker + ledger without duplicate exposure. |
| 17 | Desktop restart with open exposure | PASS | Restart restored `MATCHED`, ticket, quantity, SL, command, and Scout lineage. |
| 18 | MT5 terminal disconnect/reconnect with exposure | NOT REPRODUCIBLE | Terminal itself was not deliberately disconnected while exposed. Actual transport disconnect/reconnect and deterministic terminal-loss coverage pass. |
| 19 | Agent process restart with exposure | NOT REPRODUCIBLE | A process kill was not forced while exposed. Durable ledger/stale-session replay and actual socket reconnect passed; restart harness remains green. |
| 20 | Conflicting local/broker quantity | PASS | After real partial close, reconciliation and next SL command used broker 0.01 as authoritative. |
| 21 | Stale/late broker result | NOT REPRODUCIBLE | No natural stale venue event occurred. Duplicate replay was monotonic; adversarial stale/late tests pass. |
| 22 | Manual MT5 position isolation | NOT REPRODUCIBLE | No manual position was created. Exact ownership guards and deterministic external-isolation tests pass. |
| 23 | External pending-order isolation | NOT REPRODUCIBLE | No manual pending order was created. Read-only import/isolation tests pass; frozen connector does not create pending orders. |
| 24 | Wrong account/session | PASS | Wrong account and stale session were rejected before mutation. |
| 25 | LIVE account attempt | PASS | Prior actual Eightcap-Live probe hard-blocked before ledger/broker effect; no `MT5_LIVE` exists. |

Also passed: unknown-symbol rejection, TP placement/removal, complete `MATCHED` reconciliation, and gateway cleanup of every diagnostic exposure.

## Required journeys

### Strategy Runtime journey — PASS

`Strategy Runtime → Action Proposal → ExecutionIntent → validation → DeploymentSnapshot → OrderPlan → MT5_DEMO command → fill → verified SL → Scout → management → close`

Evidence and Decision Trace preceded mutation; no Position existed before fill plus verified protection.

### Controlled Colony journey — PASS

- Two repeated runtime opportunities created two 0.01 Scouts in one Colony.
- Each had a distinct ticket, fill, and independently verified SL.
- Desktop restart reconciled both.
- Closing the first Scout did not disturb the second.
- The survivor received independent protection management and was closed.
- Final broker state was zero.

## Real-terminal defects and fixes

1. **Broker-server quote clock (prior preserved fix).** Quote freshness now derives from locally observed sequence progression; broker time remains evidence. First, unchanged, reordered, and stale observations fail closed.
2. **Protection identity mismatch.** Python emitted `order-plan:<id>:create:protect:...`; the frozen repository requires `order-plan:<id>:protect:...`. Python now emits canonical protection and `order-plan:<id>:flatten:<position>` identities. Regression tests cover partial-fill protection and bounded-failure flatten identity.
3. **Lost-result restart convergence.** The connector did not identify durable ledger entries, and reconciliation treated a pending marker-owned position as generic broker-only. Only ledger-known `PREPARED`/`APPLIED` identities can now enter replay, and reconciliation recognizes an exact pending marker only with matching account, symbol, direction, and quantity. Connector/Python DEMO, account, quote, fingerprint, and broker-truth checks remain mandatory. Real result-loss replay returned `ALREADY_APPLIED` with the original ticket/deal.

## Fake harness versus real terminal

- Real MT5 supplied native ticket/deal identity and actual volume/spread/stop/fill-mode behavior.
- Eightcap fully filled tiny orders; partial fill could not be induced.
- Broker-server timestamps require local sequence-based freshness.
- Real calls exposed protection-identity and restart-recovery compatibility gaps absent from the deterministic broker.
- Forced rejection, partial fill, terminal/process loss, stale/out-of-order results, and protection-failure flatten retain deterministic evidence where unsafe or unavailable on the venue.

## Files changed

Compatibility source:

- `apps/mt5-agent/python/mt5_bridge.py`
- `apps/mt5-agent/src/python-demo-connector.ts`
- `packages/database/src/mt5-repository.ts`

Tests/tooling:

- `apps/mt5-agent/python/test_mt5_bridge.py`
- `apps/mt5-agent/src/python-demo-connector.test.ts`
- `packages/database/src/mt5-repository.test.ts`
- `apps/desktop/e2e/real-mt5-acceptance.spec.ts`
- `apps/mt5-agent/src/real-rejection-acceptance.ts`
- `apps/mt5-agent/package.json`

Handoff: this report, `docs/CURRENT_MILESTONE.md`, `AGENTS.md`, and the post-freeze note in `M13_REPORT.md`.

## Final repository hygiene

- The parent Git worktree intentionally ignores this `ARISE_M7_V7_WITH_PERMANENT_CONTEXT` snapshot, so final inspection used the acceptance source/test inventory directly rather than an unavailable tracked diff.
- Temporary acceptance cleanup/diagnostic source files are absent. The Electron mutation journey and real rejection runner are intentionally retained as explicit opt-in acceptance harnesses guarded by `ARISE_RUN_REAL_MT5_ACCEPTANCE=1` and `ARISE_RUN_REAL_MT5_REJECTIONS=1`.
- The speculative acknowledgement-timeout change is fully reverted. Execution and management acknowledgement timeouts remain at the frozen `1500` ms value, and the temporary timeout test file is absent.
- Canonical protection/flatten identities, durable `PREPARED`/`APPLIED` replay recognition, exact pending-marker reconciliation, and their regression tests remain present.
- Thirteen acceptance ledgers contain 48 `APPLIED` entries, zero `PREPARED` entries, and zero entries in any other state.
- No executable source changed after the final green validation; this finalization changed durable documentation only.

## Validation

- `pnpm install --frozen-lockfile`: PASS
- `pnpm check`: PASS — typecheck, lint, **627 tests**
- `pnpm build`: PASS
- `pnpm test:e2e`: PASS — **13 passed, 1 opt-in real test skipped**
- Electron/dev smoke: PASS; all processes stopped cleanly
- MT5 Agent: **40 tests PASS**
- Python bridge: **12 tests PASS**
- Database: **73 tests PASS**
- Safe real account/transport guard: PASS
- Real six-case rejection matrix: PASS, final `0 / 0`
- Real runtime, lost-result/partial-close, management, and Colony journeys: PASS
- Node ABI restored; database recovery test passed afterward
- Final read-only snapshot (2026-09-14): complete DEMO truth, progressing tick, **0 positions / 0 pending orders**

## Final recommendation

REAL MT5 DEMO ACCEPTANCE: PASSED
