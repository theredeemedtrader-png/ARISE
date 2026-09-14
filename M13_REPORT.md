# M13 — Hardening + Final Safety Gate Report

**Completed:** 2026-09-12  
**Status:** implementation complete; automated safety acceptance passed; freeze recommended  
**Boundary:** M0–M12 preserved; no LIVE transport or permission added

## Outcome

M13 hardens the existing real MT5 demo connector and broker-authoritative reconciliation paths without adding product features. Previously frozen execution/protection behavior remains intact. The complete TypeScript, SQLite, Python, and Electron regression gates pass.

M13 is distinct from the following real-terminal mutation gate. At the M13 freeze checkpoint, the installed terminal reported an eligible Eightcap DEMO account, but terminal Algo Trading was disabled and the weekend EURUSD quote was stale. Consequently, M13 could freeze while market-dependent real-demo acceptance remained pending. The later post-freeze acceptance result is recorded below and in `REAL_MT5_DEMO_ACCEPTANCE_REPORT.md`.

## Defects found and exact fixes

1. **A PREPARED command could be blindly resent after a crash.** PREPARED effects now reconcile open positions, working orders, and immutable MT5 history. If broker truth still cannot establish the outcome, automatic resend is blocked. This covers both exposure-creating and management effects.
2. **A completed entry that later closed could be mistaken for “never sent.”** Recovery now searches broker order/deal history by durable ARISE marker and magic, reconstructs deal-ticket fills, records the terminal broker outcome, and never recreates exposure.
3. **Accepted-but-not-yet-verifiable broker results were finalized too early.** They remain PREPARED/uncertain until an open Position, working order, or historical broker effect can be reconciled.
4. **Old broker ticks were timestamped as freshly received.** Snapshot `receivedAt` now preserves the authoritative broker tick time, allowing the existing five-second stale-quote gate to block mutation.
5. **Terminal/account trading disablement was discovered too late.** The TypeScript connector now treats terminal connectivity, terminal Algo Trading, external-API permission, account trading permission, and Expert permission as part of session health before invoking Python mutation. Python retains an independent guard.
6. **Ledger durability and validation were incomplete.** Atomic writes now flush and `fsync` before replace; blank ledger paths fail closed; corruption remains an explicit error.
7. **Reconciliation did not explicitly detect entry-price or TP divergence.** Automated Position entry price, quantity, SL, and TP are now compared with broker truth. Broker values win and conflicting lifecycles enter recovery-safe state with durable discrepancy/safety records.
8. **A stale snapshot could roll newer broker reality backward.** Older snapshots remain immutable audit records but are not applied over newer state. Invalid snapshot timestamps block reconciliation.
9. **One frozen E2E fixture contradicted its own fill.** Its broker snapshot entry was corrected from `1.1001` to the fake broker’s authoritative `1.1002` fill price.

## M13 adversarial matrix

| # | Scenario | Result | Evidence |
|---:|---|---|---|
| 1 | Crash before broker send | PASS | Ledger prepare is durable; prepare failure cannot call send; uncertain PREPARED is not resent. |
| 2 | Crash after send before ACK | PASS | Open/working/historical marker reconciliation; no blind resend. |
| 3 | Crash after ACK before fill | PASS | Working broker order remains PREPARED and blocks resend. |
| 4 | Crash after partial fill | PASS | Deal-ticket partial fill and actual-volume protection recovery test. |
| 5 | Crash during initial protection | PASS | Existing bounded retry/flatten tests plus PREPARED recovery. |
| 6 | Crash during stop modification | PASS | Durable UNKNOWN command and broker-state reconciliation tests. |
| 7 | Crash during partial close | PASS | Remaining broker quantity reconstructs the applied close without replay. |
| 8 | Crash during emergency flatten | PASS | Historical terminal exposure recovery and idempotent flatten harness. |
| 9 | Duplicate command send | PASS | Ledger replay, broker marker, and fake effect-count assertions. |
| 10 | Duplicate broker events | PASS | Inbox/event identity deduplication for ACK/fill/protection/close. |
| 11 | Stale/reordered broker events | PASS | Terminal lifecycle monotonicity and stale sequence tests. |
| 12 | Conflicting broker/local quantity | PASS | Broker quantity overwrites automated local projection and blocks lifecycle. |
| 13 | Conflicting entry price | PASS | Broker entry overwrites local entry and creates durable discrepancy. |
| 14 | Conflicting SL/TP | PASS | Broker SL/TP wins; protection/lifecycle becomes recovery-safe. |
| 15 | Missing broker order/unexpected Position | PASS | ARISE_ONLY/BROKER_ONLY reconciliation and no recreation/adoption tests. |
| 16 | Desktop restart with exposure | PASS | Electron execution/protection restart journeys. |
| 17 | Agent restart with exposure | PASS | Durable ledger and fake restart replay tests. |
| 18 | MT5 disconnect/reconnect | PASS | UNKNOWN → broker-truth reconciliation harness/E2E. |
| 19 | Protocol mismatch | PASS | Agent handshake rejection tests. |
| 20 | Account/server/session mismatch | PASS | Account switching, stale session, and real demo wrong-account probe. |
| 21 | Incomplete reconciliation | PASS | UNKNOWN/BLOCKED snapshot and gateway tests. |
| 22 | Stale broker snapshot | PASS | Older snapshot is audited without rolling current Position state backward. |
| 23 | Stale quote | PASS | Broker tick time preserved; Agent rejects quotes older than five seconds. |
| 24 | Excessive spread | PASS | Immutable OrderPlan and Agent/bridge spread gates. |
| 25 | Invalid volume | PASS | min/max/step validation tests. |
| 26 | Invalid stop distance | PASS | side, stop-level, and tick-distance validation tests. |
| 27 | Freeze-level violation | PASS | protection/bridge freeze-level validation tests. |
| 28 | Protection rejection | PASS | bounded fail-safe tests and durable safety events. |
| 29 | Flatten rejection/retry | PASS | bounded/idempotent flatten and terminal-state tests. |
| 30 | Database/ledger failure | PASS | IPC write failure, corrupt database/ledger, and prepare-before-send tests. |
| 31 | Manual/external isolation | PASS | Agent ownership checks, repository classification, Colony exclusion. |
| 32 | Missing/corrupt Evidence | PASS | capture failure and corrupt-asset tests remain explicit. |
| 33 | Immutable Idea/Strategy/Market Object reconstruction | PASS | canonical persistence and Electron historical reconstruction. |
| 34 | Analytics/Review restart reconstruction | PASS | repository and Electron restart journey. |

## Safety invariants verified

- Broker reality always wins and stale broker truth cannot overwrite newer truth.
- Uncertainty never creates new exposure; unresolved PREPARED commands require reconciliation/manual resolution.
- Retries are bounded and identities are durable.
- Terminal execution/protection states cannot resurrect.
- Protection cannot silently worsen or silently disappear.
- Automated exposure that cannot obtain initial protection follows bounded fail-safe flatten behavior.
- Manual/external positions remain outside automated management.
- SHADOW emits no broker mutation.
- DEMO mutation requires healthy session/account/reconciliation/quote context.
- REAL and CONTEST are rejected before ledger or broker calls.
- No `MT5_LIVE` transport or mode exists.
- Proposal or Intent alone cannot create exposure.
- Scout materialization still requires a broker-confirmed fill plus verified protection.

## Tests added or strengthened

- 11 Python bridge hardening tests: account gate, blank/corrupt/durable ledger, prepare failure, uncertain PREPARED, working order, historical terminal exposure, partial-fill recovery, partial-close recovery, and no-worsening stops.
- 5 TypeScript connector tests, including REAL, CONTEST, disabled terminal permission, valid DEMO forwarding, and uncertain bridge failure.
- SQLite reconciliation now tests stale snapshots and broker-authoritative quantity, entry, SL, and TP conflicts.
- M11 Electron fixture now uses the exact fake broker fill price and the full journey passes.

## Validation

- `pnpm install --frozen-lockfile`: PASS
- `pnpm check`: PASS — typecheck, lint, **624 tests**
- `pnpm build`: PASS
- `pnpm test:e2e`: PASS — **13 Electron journeys**
- Electron/dev smoke: PASS; process intentionally stopped after healthy launch
- MT5 Agent TypeScript suite: PASS — **38 tests**
- Python bridge compilation: PASS
- Python bridge suite: PASS — **11 tests**
- Database/recovery suite: PASS — **72 tests**
- Node `better-sqlite3` ABI restored after Electron validation

## Files changed

- `apps/mt5-agent/python/mt5_bridge.py`
- `apps/mt5-agent/python/test_mt5_bridge.py`
- `apps/mt5-agent/src/python-demo-connector.ts`
- `apps/mt5-agent/src/python-demo-connector.test.ts`
- `apps/mt5-agent/src/real-acceptance.ts`
- `apps/mt5-agent/package.json`
- `packages/database/src/mt5-repository.ts`
- `packages/database/src/mt5-repository.test.ts`
- `packages/database/src/execution-repository.test.ts`
- `apps/desktop/e2e/protection.spec.ts`
- `M13_REPORT.md`
- `REAL_MT5_DEMO_ACCEPTANCE_REPORT.md`
- `docs/CURRENT_MILESTONE.md`
- `docs/PROJECT_ROADMAP.md`
- `AGENTS.md`

## Remaining boundary

No M13 software acceptance blocker remains. The subsequent Real MT5 Demo-Terminal Acceptance Gate passed; see `REAL_MT5_DEMO_ACCEPTANCE_REPORT.md`. M13 remains frozen.

## Post-freeze real-terminal compatibility fix — 2026-09-13

An Eightcap-Demo read-only probe exposed a narrow quote-clock safety defect. The broker's tick `time_msc` was approximately three hours ahead of machine UTC, consistent with broker-server time, while the connector treated that value as local receipt time. A stopped feed could therefore remain falsely fresh.

The real connector now preserves the raw broker timestamp in `brokerTime`, but treats a quote as locally received only after observing its broker sequence advance. The first observation, unchanged sequence, reordered sequence, and an observation older than five seconds all fail closed before Python mutation. Direct connector mutation now enforces the same progression-derived freshness in addition to the frozen Agent/Desktop gates.

Regression coverage uses a future broker timestamp and proves first-observation rejection, acceptance only after sequence advancement, and rejection after five seconds without advancement. The fix changes only `apps/mt5-agent/src/python-demo-connector.ts` and its test; no execution/protection semantics or LIVE permission changed.

Post-fix validation passed: `pnpm install --frozen-lockfile`, `pnpm check` (625 tests), `pnpm build`, `pnpm test:e2e` (13 journeys), Electron smoke, Agent tests (39), Python bridge tests (11), and database/recovery tests (72). Node ABI was restored afterward. M13 remains frozen.

## Post-freeze real-mutation compatibility fixes — 2026-09-13

Actual Eightcap-Demo fills exposed two narrowly scoped connector/recovery mismatches:

1. Python initial-protection events included the execution command's `:create` segment, but the frozen repository requires the canonical OrderPlan protection identity. Python now emits `order-plan:<plan>:protect:<position>:<volume>` and the matching canonical bounded-failure flatten identity.
2. A result lost after broker application could not replay after session replacement: the real connector did not identify durable ledger entries, while reconciliation treated the marker-owned exposure as generic broker-only. The connector now recognizes only ledger-known `PREPARED`/`APPLIED` identities, and reconciliation recognizes an exact pending command marker only when account, symbol, direction, and volume also match. All connector/Python DEMO, account, quote, fingerprint, and broker-truth guards still apply.

A deliberately dropped real result then reconciled and replayed as `ALREADY_APPLIED` with the original ticket/deal and without duplicate exposure. Regression coverage was added at the Python connector, Python bridge, database reconciliation, and opt-in Electron acceptance layers.

Final validation passed: `pnpm install --frozen-lockfile`, `pnpm check` (627 tests), `pnpm build`, `pnpm test:e2e` (13 passed, one opt-in real test skipped), Electron smoke, Agent tests (40), Python tests (12), database tests (73), and all real-terminal acceptance variants. Node ABI was restored and final broker state was `0` positions / `0` pending orders. M13 remains frozen; LIVE remains unavailable.

## Recommendation

M13 FREEZE
