# ARISE M5 Report — Ideas, Thesis, Knowledge, Review

**Baseline:** M4 frozen candidate verified on Windows
**Status:** Freeze candidate; Windows dependency-backed verification required

## Scope completed

M5 establishes the planning/knowledge/review product layer without starting Strategy Runtime, live market data, MT5, execution, protection, or analytics.

Implemented:

- canonical Idea + immutable IdeaVersion + one Colony creation flow
- Thesis Canvas with immutable thesis revisions
- exact MarketObjectVersion references for primary target and invalidation
- Idea lifecycle transitions through the canonical domain validator
- durable Knowledge documents and immutable DocumentVersion history
- stable Block identities, nested folders, wiki-style `[[Title]]` references, and backlinks
- explicit ReviewSchedule, ReviewCycle, MarketReview, and immutable ReviewEvent persistence
- manual `Queue now` review cycle creation while broker-aligned automatic timing is unavailable
- review outcomes `DUE`, `COMPLETED`, `MISSED`, and `SKIPPED`; unreviewed state is never rewritten as `NEUTRAL`
- Market Review notes as linked versioned documents
- provider-neutral Economic Calendar domain foundation and durable schema, with no provider fabricated/configured
- planning/review timeframe catalog expanded to M1/M2/M3/M5/M10/M15/M30/H1/H2/H4/H6/H8/H12/D/W/M
- Overview and Market Navigator now surface persisted Colony/Idea and Review state
- M5 Electron E2E scenario covering planning, thesis versioning, knowledge backlinks, review history, and restart persistence

## Important architectural boundaries preserved

- automatic Review timing is **not** implemented until canonical broker-aligned candle boundaries exist in TimeframeService
- the Economic Calendar has data contracts/storage only; no external provider is claimed to be connected
- execution remains locked
- live market data remains disconnected; M4 demo chart data is still explicitly demo data
- Strategy Graph / detector runtime remains out of scope
- Market Review status and direction remain separate concepts; `DUE` is created with `UNCHANGED`, not `NEUTRAL`
- Idea/Document history is append-only; edits create successor versions rather than overwriting prior decision state
- Thesis target/invalidation references store exact MarketObjectVersion IDs rather than silently following current revisions

## Persistence migration

Migration 3 adds:

- `folders`
- `documents`
- `blocks`
- `document_versions`
- `folder_items`
- `entity_links`
- `tags`
- `tag_assignments`
- `review_schedules`
- `review_cycles`
- `market_reviews`
- `review_events`
- `economic_events`
- `economic_event_revisions`

Document versions, review events, and economic-event revisions have database-level immutable-history protection. Document successor insertion enforces linear history and current-head integrity.

## UI surfaces

### Ideas

- status Kanban
- New Idea dialog
- Thesis timeframe and LONG/SHORT/NEUTRAL direction
- automatic Colony creation
- two-panel Thesis + M4 chart workspace
- target/invalidation description
- exact target/invalidation Market Object version selection
- save-as-next-version behavior
- explicit Idea state transition controls

### Knowledge

- three-pane Folder / Document / Backlink layout
- versioned text documents
- nested folder creation
- move documents between folders
- `[[wiki links]]`
- backlinks resolved by document title
- entity-backed documents appear in the same Knowledge system

### Review

- durable review schedules on the expanded timeframe catalog
- manual review-cycle queueing
- DUE / COMPLETED / MISSED / SKIPPED lanes
- focused LONG / SHORT / NEUTRAL / UNCHANGED decision capture
- review notes persisted as linked Knowledge documents
- explicit warning that automatic candle-close timing waits for TimeframeService
- economic-calendar placeholder accurately reports that no provider is configured

## Tests added

- `packages/documents/src/documents.test.ts`
- `packages/calendar/src/calendar.test.ts`
- `packages/database/src/m5-persistence.test.ts`
- `apps/desktop/e2e/planning.spec.ts`

Existing migration tests were extended for schema version 3.

## Validation performed in this environment

Because this clean execution environment cannot access npm, the real pnpm dependency tree could not be restored here.

Completed static checks using temporary local type stubs (not included in the source archive):

- desktop renderer strict TypeScript: passed
- `@arise/documents` TypeScript: passed
- `@arise/calendar` TypeScript: passed
- `@arise/shared/src/ipc.ts` strict TypeScript: passed

The implementation was also inspected against the canonical `DATA_MODEL.md`, `REVIEW_SYSTEM.md`, `UX_SPEC.md`, and frozen M4 boundaries.

## Windows freeze gate

From a fresh extraction:

```powershell
pnpm install --frozen-lockfile
pnpm check
pnpm build
pnpm test:e2e
pnpm dev
```

Expected Electron E2E count after M5: **4 tests** (M0 foundation, M3 shell, M4 chart workspace, M5 planning/knowledge/review).

Visual smoke checks:

1. Ideas → New Idea → create EURUSD D LONG Idea + Colony.
2. Edit thesis → save v2; verify version increments.
3. Open Knowledge; create documents and use `[[Document Title]]`; verify backlink context.
4. Review → create schedule → Queue now → complete review; verify it moves from DUE to COMPLETED.
5. Return to Overview / Market Navigator and verify persisted Colony and review state is reflected.
6. Restart ARISE and verify planning, Knowledge, and Review state persists.

## Files changed from M4 baseline

30 implementation/config/test files plus this report. No canonical `/docs` specification files were modified.

## Freeze recommendation

Freeze M5 after the Windows commands above pass and the visual smoke checks show the persisted planning/knowledge/review workflow operating correctly.
