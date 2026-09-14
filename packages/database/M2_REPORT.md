# ARISE M2 Persistence Report

**Status:** Freeze candidate — Windows validation required  
**Baseline:** M1.3 frozen  
**Scope:** SQLite persistence, migration, immutable history, repository boundaries, and reconstruction for domain entities implemented through M1.3.

## 1. Objective completed

M2 adds canonical SQLite persistence for the frozen M1 domain without introducing M3+ UI, strategy runtime, MT5 execution, protection, evidence, review, or analytics behavior.

The implementation preserves the architecture rule that current operational records may mutate through controlled repository operations while historical/version/event records remain immutable.

## 2. Migration strategy

- Preserves the frozen M0 starter Idea table as `legacy_ideas`.
- Adds migration version 2 and upgrades `PRAGMA user_version` to 2.
- Does **not** silently convert M0 starter Ideas into canonical M1 Ideas because the M0 record lacks canonical Instrument/Timeframe identity and immutable IdeaVersion history.
- Enables SQLite foreign-key enforcement before migrations.
- Retains WAL mode.
- All pending migration steps execute inside one SQLite transaction.
- A database newer than this ARISE build is rejected.

## 3. Canonical tables added

M2 persists:

- Instrument
- Timeframe
- Idea
- IdeaVersion
- Colony
- ColonyLineage
- ColonyStateEvent
- Target
- TargetEvent
- MarketObject
- MarketObjectVersion
- MarketObjectRelation
- TimeframeProjection
- Attempt
- Trade
- Position
- PositionStateEvent
- AttemptBudget

The legacy M0 compatibility table remains as `legacy_ideas`.

## 4. Immutable history enforcement

Database UPDATE/DELETE triggers protect these append-only tables:

- `idea_versions`
- `colony_lineage`
- `colony_state_events`
- `target_events`
- `market_object_versions`
- `market_object_relations`
- `timeframe_projections`
- `trades`
- `position_state_events`

Additional insert guards enforce linear, head-extending history for IdeaVersion and MarketObjectVersion. Market Object current-snapshot updates must point to a matching persisted current version.

## 5. Repository layer

Added repositories for:

- Instruments and Timeframes
- Canonical Ideas and immutable IdeaVersions
- Colonies, state events, and lineage
- Targets and TargetEvents
- Market Objects, revisions, relations, FROZEN/LIVE_LINKED resolution
- Timeframe Projections and parent-path reconstruction
- Attempts
- Trades
- Positions and PositionStateEvents
- AttemptBudgets

The frozen M0 `IdeaRepository` remains available for the existing desktop shell and now explicitly targets `legacy_ideas`. New code uses `CanonicalIdeaRepository`.

## 6. Atomic local writes

Repository transactions keep logically paired operations atomic, including:

- Colony current-state update + immutable ColonyStateEvent
- Target current-status update + immutable TargetEvent
- Position current-state update + immutable PositionStateEvent
- MarketObjectVersion append + current MarketObject snapshot/head update

Optimistic current-state/head checks reject stale writers rather than silently overwriting newer state.

## 7. Exact reconstruction/version behavior

M2 provides exact historical access and aggregate reconstruction for canonical Ideas, Colonies, Market Objects, and Timeframe Projections. FROZEN Market Object references remain pinned to their exact version; LIVE_LINKED references resolve to the persisted current head.

## 8. Attempt → Trade → Position separation

Persistence retains the frozen domain distinction:

`Attempt → Trade → Position`

No broker order/fill model is invented in M2. Position rows contain only the broker-facing exposure facts already defined by M1.2.

## 9. Intentional exclusions

M2 does not add or infer:

- StrategyMapVersion tables before that domain model exists
- StrategyRuntime/runtime-node persistence
- Market data or candles
- MT5 Agent/bridge
- Broker commands, orders, fills, or reconciliation
- Protection rules
- Evidence
- Review Scheduler
- Knowledge/Documents
- UI state beyond the existing M0 shell
- Analytics
- A separate durable StackingPolicy table (no canonical durable identity/schema exists yet)

These remain future milestones.

## 10. Tests added/expanded

Persistence tests cover:

- migration from M0 schema to M2
- rollback of a failed migration batch
- refusal of newer database versions
- WAL and foreign-key configuration
- legacy M0 Idea persistence across restart
- canonical Instrument/Timeframe round-trip
- immutable IdeaVersion history and head/fork rejection
- optimistic Idea status changes
- atomic Colony transition/event writes and rollback
- immutable Colony lineage
- Target progression with REACHED distinct from HIT
- Market Object revisions and stale-fork rejection
- FROZEN vs LIVE_LINKED Market Object references
- immutable Market Object relations
- nested Timeframe Projection reconstruction
- Attempt sequence uniqueness and one-time completion
- Attempt → Trade → Position persistence
- atomic Position state/event writes
- mutable AttemptBudget round-trip and optimistic replacement
- canonical data reconstruction after closing/reopening a file-backed SQLite database
- database-level immutable-history and linear-version guards

## 11. Validation performed in this environment

Performed successfully:

- Direct execution of the complete M1→M2 SQLite migration SQL using SQLite semantics.
- 19 expected application tables created.
- 21 integrity/immutability triggers created.
- `PRAGMA foreign_key_check` returned no violations on the created schema.
- Database-level IdeaVersion gap/fork guard was exercised directly and rejected invalid history.
- A TypeScript surface/type pass using temporary external-module stubs completed with strict checking except `noImplicitAny` relaxed solely because the stubs cannot model Drizzle's inferred transaction callback types.
- No temporary stubs or generated validation artifacts are included in the repository.

## 12. Validation not possible here

This environment cannot currently reach the npm registry and the clean frozen repository intentionally contains no `node_modules`. Therefore the real project dependencies could not be installed and these canonical project commands have **not yet been executed against M2** here:

- `pnpm check`
- `pnpm build`
- `pnpm test:e2e`

This is the only reason M2 is a freeze **candidate** rather than frozen.

## 13. Required Windows freeze validation

From the extracted M2 candidate repository run:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
```

M2 changes the database/migration foundation used by Electron, so Windows Electron E2E should be rerun for this milestone.

## 14. Freeze recommendation

Freeze M2 if all four Windows commands pass. If any command fails, preserve this candidate, report the exact failure, patch only the failing M2 implementation, rerun validation, and freeze only after green results.
