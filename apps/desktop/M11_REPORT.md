# M11 — Protection + Colony Automation Report

**Completed:** 2026-09-12  
**Status:** implementation complete; Windows acceptance passed; freeze recommended  
**Boundary:** M0–M10 preserved; M12 not started

## Outcome

M11 adds deterministic protection, management, stacking, thesis-invalidation, Target-progress, and Runner behavior around broker-confirmed Positions. It extends the frozen M10 execution gateway rather than creating a second broker path.

The implemented broker path is:

`immutable trigger → ProtectionRuleVersion → calculated/scoped proposal → broker validation → durable management command → M10 transport → Agent validation → broker result → verification/projection → broker-authoritative reconciliation`

## Implementation

### Protection engine

- All canonical M11 triggers, actions, and scopes are explicit types.
- Action calculation covers price BE, true/economic BE, offsets, pip/money/open-profit locks, exact/Market Object/structure stops, fixed/object/structure trailing, partial/full close, TP set/removal, and Runner conversion.
- Weighted entries use actual fills. Economic BE uses recorded costs and executable exit prices; spread is not added twice.
- Scope selection excludes ARISE manual and MT5 external Positions from Colony automation.
- Conflict resolution gives full close priority and selects the direction-aware most protective stop.
- Broker validation covers current ownership/quantity, Bid/Ask, quote freshness, tick alignment, stops level, freeze level, minimum lot, volume step, account/session/protocol/reconciliation health, live isolation, and no worsening.
- Position lifecycle remains frozen and independent from the M11 protection projection.

### Durable management and recovery

- Migration v10 adds immutable rule versions, trigger events, request events, command events, broker results, verifications, cost facts, partial/full-close fills, Runner conversions, stacking versions, and Colony automation events.
- Current protection and Colony automation state are mutable projections rebuilt/overridden from immutable facts and broker snapshots.
- Commands are serialized per Position, bounded to three attempts, and keyed by rule version + trigger + broker Position + action + sequence.
- Full close supersedes queued lower-priority effects and remains idempotent.
- Duplicate and late broker events are stored/deduplicated and cannot regress terminal or newer protection state.
- Reconnect reconciles SENDING/UNKNOWN commands from broker reality before any retry; matching effects complete, conflicts are superseded and recovery-blocked.
- Broker quantity updates ARISE state for partial close and for quantity changes observed during a stop/trail result.
- A missing/worsened stop or inconsistent close/TP result produces explicit protection error/UNKNOWN state and a safety event.

### Agent and renderer boundaries

- Protocol v3 adds only allow-listed management commands and results.
- The real MT5 adapter remains read-only; the fake harness is the only M11 mutation surface.
- The Agent independently rechecks demo/live account, session, expiry, terminal, complete snapshot, symbol, fresh quote, ARISE ownership marker, exact expected quantity, stop validity/no-worsening, and partial-close constraints.
- Typed IPC exposes rule registration, immutable trigger capture, SHADOW/DEMO proposal execution, policy assignment, cooldown/reset, thesis invalidation, and read-only M11 workspace queries.
- SHADOW records the calculated request and stops before command creation.

### Colony, Target, and Runner behavior

- All five frozen stacking modes are enforced from actual persisted facts for configured Colonies.
- Attempt limits, failed-Scout pip-cost cap, cooldown, explicit reset period, and concurrent-Position cap gate entry.
- Failed Scouts consume budget but do not invalidate the parent Idea/Colony.
- Countertrend automation is disabled in both schema and evaluator.
- Thesis invalidation disarms entry and cancels an unsent Scout command. Restart replay also respects the disarmed Colony.
- All five invalidation policies map to explicit outcomes. Mutation policies require an exact rule version; absence/mismatch is audited and blocked. `MANUAL_DECISION` remains the default.
- Target `APPROACHING`, `REACHED`, and `HIT` remain distinct. All seven frozen Target management modes remain intact.
- Runner conversion requires verified independent protection and preserves Position, Colony, Target, and event lineage.

## Adversarial tests added or strengthened

- 31 pure M11 protection/automation tests cover all actions, scopes, price/true BE, weighted fills/costs, no-worsening, conflict priority, Bid/Ask and broker-distance rules, partial-close sizing, Target progression, all stacking modes, all invalidation policies, cooldown/budget/cost/exposure gates, countertrend blocking, and failed-Scout independence.
- 14 M11 repository tests cover SHADOW no-command behavior, retry identity, restart persistence, command serialization, full-close supersession, duplicate/stale results, partial close followed by stop update, broker-worsening and effect-mismatch failure, broker-authoritative reconciliation, UNKNOWN-command convergence, Runner lineage, invalidation race cancellation, cooldown/reset history, manual/external isolation, and immutable history.
- Fake broker/Agent tests cover duplicate stop effects, identity collision, partial close then quantity-aware trail, timeout/reconnect replay, disconnect, stale ACK, worsening broker response, idempotent full close, live account, external/manual ownership, broker quantity drift, and Agent-side worsening rejection.
- The new Electron E2E flow covers M10 Scout establishment → reconciliation → M11 price-BE DEMO command/result → verified projection → SHADOW zero-effect request → Desktop restart, with exactly one broker management effect.
- Existing frozen milestone suites remain green.

## Acceptance results

- `pnpm install --frozen-lockfile` — passed
- `pnpm check` — passed: typecheck, lint, **598 tests**
- `pnpm build` — passed
- `pnpm test:e2e` — **12 passed** on Windows
- `pnpm dev` — Electron/Vite process launched and remained healthy; intentionally stopped after smoke observation
- `pnpm --filter @arise/desktop native:node` — passed after Electron validation
- post-restore `pnpm --filter @arise/database test` — **66 passed**

## Files changed

- `AGENTS.md`
- `docs/CURRENT_MILESTONE.md`
- `docs/PROJECT_ROADMAP.md`
- `apps/desktop/M11_REPORT.md`
- `packages/execution/src/index.ts`
- `packages/execution/src/protection.ts`
- `packages/execution/src/protection.test.ts`
- `packages/shared/src/mt5.ts`
- `packages/shared/src/mt5.test.ts`
- `packages/shared/src/ipc.ts`
- `packages/database/src/index.ts`
- `packages/database/src/migrations.ts`
- `packages/database/src/migrations.test.ts`
- `packages/database/src/schema.ts`
- `packages/database/src/protection-repository.ts`
- `packages/database/src/protection-repository.test.ts`
- `packages/database/src/execution-repository.ts`
- `packages/database/src/execution-repository.test.ts`
- `packages/database/src/mt5-repository.ts`
- `apps/mt5-agent/src/server.ts`
- `apps/mt5-agent/src/server.test.ts`
- `apps/mt5-agent/src/execution-harness.test.ts`
- `apps/desktop/src/main/protection-gateway.ts`
- `apps/desktop/src/main/mt5-client.ts`
- `apps/desktop/src/main/execution-gateway.ts`
- `apps/desktop/src/main/main.ts`
- `apps/desktop/src/main/ipc.ts`
- `apps/desktop/src/preload/preload.ts`
- `apps/desktop/e2e/protection.spec.ts`

## Limitations

- No real-terminal mutation or LIVE permission was added. Production MT5 remains read-only.
- There is no bespoke visual rule/automation editor in M11; the complete typed application/IPC surface is available for a later UI pass.
- Economic BE across non-account-currency instruments needs authoritative conversion facts from a future real Agent.
- Basket/Colony BE is intentionally not implemented or inferred.
- M12 review/analytics work is excluded.

## Recommendation

**M11 FREEZE**
